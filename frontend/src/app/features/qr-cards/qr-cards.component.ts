import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { QrCard, QrCardRequest, QrCardService } from './qr-card.service';
import { formatStudentCode } from '../../core/utils/student-code.util';
import { NotificationService } from '../../core/services/notification.service';

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
 * The VENDOR mints and prints the batches now — the academy sees its pool, hands
 * cards to students (linking happens on the student page), and asks for more via
 * a card request that the vendor accepts or refuses from the admin console.
 * Downloading, minting and print tracking all moved to the vendor side with that
 * change; this page keeps only what the academy itself acts on.
 *
 * Linking does not take the student's own QR away: both resolve to them, so a
 * card printed the old way keeps working.
 */
@Component({
  selector: 'app-qr-cards',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TableModule, TagModule,
    InputTextModule, TextareaModule, DialogModule, TooltipModule, ConfirmDialogModule, TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './qr-cards.component.html',
})
export class QrCardsComponent implements OnInit {
  private service = inject(QrCardService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);
  private confirm = inject(ConfirmationService);

  cards = signal<QrCard[]>([]);
  loading = signal(false);

  filter = signal<'all' | 'free' | 'linked' | 'unprinted' | 'printed'>('all');
  /** Find one card in a box of a thousand: by its number, or by who holds it. */
  search = signal('');

  freeCount = computed(() => this.cards().filter((c) => !c.studentId).length);
  linkedCount = computed(() => this.cards().filter((c) => !!c.studentId).length);

  /** Cards the vendor has not yet sent to a printer — informational only here. */
  unprintedCards = computed(() => this.cards().filter((c) => !c.printed && !c.studentId));
  unprintedCount = computed(() => this.unprintedCards().length);

  /** Serial range of the pending run, for the badge tooltip. */
  unprintedRange = computed(() => {
    const rows = this.unprintedCards();
    if (!rows.length) return '';
    const serials = rows.map((c) => c.serial);
    return `${serialLabel(Math.min(...serials))} – ${serialLabel(Math.max(...serials))}`;
  });

  visible = computed(() => {
    const f = this.filter();
    const q = this.search().trim().toLowerCase();
    let rows = this.cards();
    if (f === 'free') rows = rows.filter((c) => !c.studentId);
    if (f === 'linked') rows = rows.filter((c) => !!c.studentId);
    if (f === 'unprinted') rows = rows.filter((c) => !c.printed && !c.studentId);
    if (f === 'printed') rows = rows.filter((c) => c.printed);
    if (q) {
      rows = rows.filter((c) =>
        serialLabel(c.serial).toLowerCase().includes(q)
        || (c.studentName ?? '').toLowerCase().includes(q)
        || formatStudentCode(c.studentCode).toLowerCase().includes(q));
    }
    return rows;
  });

  // ── Card requests — the tenant's asks and the vendor's answers ────────────
  requests = signal<QrCardRequest[]>([]);
  requestsLoading = signal(false);
  requestDialogOpen = signal(false);
  requestCount = 100;
  requestNotes = '';
  requesting = signal(false);

  /** One PENDING ask at a time — the button waits for the vendor's answer. */
  hasPendingRequest = computed(() => this.requests().some((r) => r.status === 'PENDING'));

  label = serialLabel;
  code = formatStudentCode;

  ngOnInit(): void {
    this.load();
    this.loadRequests();
  }

  load(): void {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (rows) => { this.cards.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),   // interceptor toasts the server error
    });
  }

  loadRequests(): void {
    this.requestsLoading.set(true);
    this.service.listRequests().subscribe({
      next: (rows) => { this.requests.set(rows); this.requestsLoading.set(false); },
      error: () => this.requestsLoading.set(false),
    });
  }

  openRequestDialog(): void {
    this.requestCount = 100;
    this.requestNotes = '';
    this.requestDialogOpen.set(true);
  }

  sendRequest(): void {
    const n = Math.floor(Number(this.requestCount));
    if (!Number.isFinite(n) || n < 1 || n > 2000) {
      this.notify.error(this.translate.instant('QR_CARDS.BAD_COUNT'));
      return;
    }
    this.requesting.set(true);
    this.service.requestCards(n, this.requestNotes.trim() || null).subscribe({
      next: () => {
        this.requesting.set(false);
        this.requestDialogOpen.set(false);
        this.notify.success(this.translate.instant('QR_CARDS.REQUEST_SENT'));
        this.loadRequests();
      },
      // The interceptor toasts the translated reason (e.g. REQUEST_PENDING).
      error: () => this.requesting.set(false),
    });
  }

  requestStatusSeverity(status: QrCardRequest['status']): 'warn' | 'success' | 'danger' {
    return status === 'PENDING' ? 'warn' : status === 'ACCEPTED' ? 'success' : 'danger';
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
}
