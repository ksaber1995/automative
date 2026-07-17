import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressBarModule } from 'primeng/progressbar';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { QrCard, QrCardService } from './qr-card.service';
import { formatStudentCode } from '../../core/utils/student-code.util';
import { CompanyService } from '../../core/services/company.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { canExportCustom, loadCardImages, renderAgnosticBackPng, renderAgnosticCardPng } from '../students/card-render.util';
import { AgnosticCardData, AgnosticTemplate } from '../students/card-agnostic.util';

/**
 * The serial as printed on the card: "A5", not "A-100005".
 *
 * The number is STORED in the reserved range (100005) so it can never collide
 * with a student's own code — but nobody wants to read six digits off a card, so
 * the printed form drops the base and keeps the "A", which is what makes it
 * unmistakably a card. Typing "A5" resolves back to 100005; see
 * normalizeStudentCode.
 */
export function serialLabel(serial: number): string {
  return formatStudentCode(serial);
}

/**
 * A POOL of pre-printed QR cards.
 *
 * The academy prints a batch of blank cards up front — the academy's own template,
 * with the student's fields left empty and a serial printed on it. Nobody owns them
 * yet. A card is handed to a student and linked by scanning it on their page.
 *
 * Linking does not take the student's own QR away: both resolve to them, so a card
 * printed the old way keeps working.
 */
@Component({
  selector: 'app-qr-cards',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TableModule, TagModule,
    InputTextModule, TooltipModule, ProgressBarModule, ConfirmDialogModule, TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './qr-cards.component.html',
})
export class QrCardsComponent implements OnInit {
  private service = inject(QrCardService);
  private companyService = inject(CompanyService);
  private authService = inject(AuthService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);
  private confirm = inject(ConfirmationService);

  cards = signal<QrCard[]>([]);
  loading = signal(false);
  generating = signal(false);
  count = 100;

  filter = signal<'all' | 'free' | 'linked'>('all');
  /** Find one card in a box of a thousand: by its number, or by who holds it. */
  search = signal('');

  freeCount = computed(() => this.cards().filter((c) => !c.studentId).length);
  linkedCount = computed(() => this.cards().filter((c) => !!c.studentId).length);

  visible = computed(() => {
    const f = this.filter();
    const q = this.search().trim().toLowerCase();
    let rows = this.cards();
    if (f === 'free') rows = rows.filter((c) => !c.studentId);
    if (f === 'linked') rows = rows.filter((c) => !!c.studentId);
    if (q) {
      rows = rows.filter((c) =>
        serialLabel(c.serial).toLowerCase().includes(q)
        || (c.studentName ?? '').toLowerCase().includes(q)
        || formatStudentCode(c.studentCode).toLowerCase().includes(q));
    }
    return rows;
  });

  // Print/export progress — a thousand cards is a long render.
  exporting = signal(false);
  exportDone = signal(0);
  exportTotal = signal(0);
  exportPercent = signal(0);

  label = serialLabel;
  code = formatStudentCode;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (rows) => { this.cards.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),   // interceptor toasts the server error
    });
  }

  generate(): void {
    const n = Math.floor(Number(this.count));
    if (!Number.isFinite(n) || n < 1) {
      this.notify.error(this.translate.instant('QR_CARDS.BAD_COUNT'));
      return;
    }
    this.generating.set(true);
    this.service.generate(n).subscribe({
      next: (rows) => {
        this.generating.set(false);
        this.notify.success(this.translate.instant('QR_CARDS.GENERATED', { count: rows.length }));
        this.load();
      },
      error: () => this.generating.set(false),
    });
  }

  confirmUnlink(card: QrCard): void {
    this.confirm.confirm({
      header: this.translate.instant('QR_CARDS.UNLINK_TITLE'),
      message: this.translate.instant('QR_CARDS.UNLINK_MSG', {
        serial: this.label(card.serial),
        name: card.studentName,
      }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.service.unlink(card.id).subscribe({
          next: () => {
            this.notify.success(this.translate.instant('QR_CARDS.UNLINKED'));
            this.load();
          },
          error: () => {},
        });
      },
    });
  }

  /**
   * Download the blank cards as printable PNGs.
   *
   * Only the FREE ones — a card already in a student's hand doesn't need
   * reprinting, and printing it twice is how two people end up scanning as one.
   */
  async downloadZip(): Promise<void> {
    const pool = this.cards().filter((c) => !c.studentId);
    if (!pool.length) {
      this.notify.warning(this.translate.instant('QR_CARDS.NONE_FREE'));
      return;
    }

    this.exporting.set(true);
    this.exportDone.set(0);
    this.exportTotal.set(pool.length);
    this.exportPercent.set(0);

    try {
      const design = await firstValueFrom(this.companyService.getCardDesign()).catch(() => null);
      const template = design?.agnosticTemplate as AgnosticTemplate | undefined;

      // 'custom' prints the academy's OWN artwork, and a missing side renders a
      // placeholder that says so. Refuse the batch instead: this ZIP goes to an
      // outside printer, and a thousand cards with a blank face is not something
      // anybody recovers from once they are printed.
      if (template === 'custom' && (!design || !canExportCustom(design))) {
        this.notify.error(this.translate.instant('QR_CARDS.CUSTOM_ART_MISSING'));
        return;
      }

      const images = await loadCardImages(design);   // decoded once for the batch

      const zip = new JSZip();
      const origin = window.location.origin;
      const companyName = this.authService.getCompanyName();
      const canvas = document.createElement('canvas');
      await document.fonts.ready;   // Arabic must shape before we rasterise

      let done = 0;
      for (const card of pool) {
        // An AGNOSTIC card: nothing on it belongs to a student, because nobody owns
        // it yet. Only its own QR and the serial printed under it — which is how it
        // gets found in a box of a thousand, and how it gets linked.
        const data: AgnosticCardData = {
          companyName,
          code: this.label(card.serial),
          qrUrl: `${origin}/p/s/${card.token}`,
        };
        const png = await renderAgnosticCardPng(data, canvas, template, images, design);
        zip.file(`${this.label(card.serial)}.png`, png, { base64: true });

        this.exportDone.set(++done);
        this.exportPercent.set(Math.round((done / pool.length) * 100));
        // Yield so the progress bar repaints instead of freezing the tab.
        if (done % 5 === 0) await new Promise((r) => setTimeout(r));
      }

      // Both faces are agnostic, so the back is identical for the whole batch and
      // ships once rather than a thousand times.
      if (design) {
        try {
          zip.file('card-back.png', await renderAgnosticBackPng(design, companyName, canvas, images), { base64: true });
        } catch {
          console.warn('Card back skipped — could not render the design.');
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'qr-cards.zip');
      this.notify.success(this.translate.instant('QR_CARDS.DOWNLOADED', { count: pool.length }));
    } catch {
      this.notify.error(this.translate.instant('QR_CARDS.DOWNLOAD_FAILED'));
    } finally {
      this.exporting.set(false);
    }
  }
}
