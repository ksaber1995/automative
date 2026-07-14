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
import { CompanyService } from '../../core/services/company.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import {
  StudentCardData, currentAcademicYear, loadCardImages, renderCardBackPng, renderStudentCardPng,
} from '../students/card-render.util';
import { CardTemplate } from '../students/card-theme';

/** The serial as printed on the card — padded, so a stack of them lines up. */
export function serialLabel(serial: number): string {
  return `#${String(serial).padStart(5, '0')}`;
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

  freeCount = computed(() => this.cards().filter((c) => !c.studentId).length);
  linkedCount = computed(() => this.cards().filter((c) => !!c.studentId).length);

  visible = computed(() => {
    const f = this.filter();
    const all = this.cards();
    if (f === 'free') return all.filter((c) => !c.studentId);
    if (f === 'linked') return all.filter((c) => !!c.studentId);
    return all;
  });

  // Print/export progress — a thousand cards is a long render.
  exporting = signal(false);
  exportDone = signal(0);
  exportTotal = signal(0);
  exportPercent = signal(0);

  label = serialLabel;

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
      const template = design?.template as CardTemplate | undefined;
      const images = await loadCardImages(design);   // decoded once for the batch

      const zip = new JSZip();
      const origin = window.location.origin;
      const companyName = this.authService.getCompanyName();
      const year = currentAcademicYear();
      const canvas = document.createElement('canvas');
      await document.fonts.ready;   // Arabic must shape before we rasterise

      let done = 0;
      for (const card of pool) {
        // The academy's real template — but with every student field blank. The
        // serial goes where the student code normally prints, so a card can be
        // found in a box of a thousand.
        const data: StudentCardData = {
          companyName,
          name: '',
          code: this.label(card.serial),
          level: '',
          group: '',
          year,
          subject: '',
          qrUrl: `${origin}/p/s/${card.token}`,
        };
        const png = await renderStudentCardPng(data, canvas, template, images);
        zip.file(`${this.label(card.serial)}.png`, png, { base64: true });

        this.exportDone.set(++done);
        this.exportPercent.set(Math.round((done / pool.length) * 100));
        // Yield so the progress bar repaints instead of freezing the tab.
        if (done % 5 === 0) await new Promise((r) => setTimeout(r));
      }

      // The shared back face ships once, as it does for the student export.
      if (design) {
        try {
          zip.file('card-back.png', await renderCardBackPng(design, canvas), { base64: true });
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
