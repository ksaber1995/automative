import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { CardPoolStatus, QrCardService } from '../../features/qr-cards/qr-card.service';

/**
 * "You are nearly out of QR cards — ask us for more."
 *
 * Same shape as SubscriptionService: a root service loaded once by the layout,
 * exposing computed signals the layout renders from. The rule itself lives on
 * the server (`warn` folds together the per-tenant on/off switch, the per-tenant
 * threshold and the remaining count), so nothing here re-derives it — a client
 * that guessed the threshold would start nagging tenants the vendor never
 * switched the nudge on for.
 *
 * The dialog is shown at most once a day per tenant. A modal that reappears on
 * every page load stops being read within an hour, and this one is asking the
 * academy to go and place an order, which is not a thing they do twice a day.
 */
@Injectable({ providedIn: 'root' })
export class CardPoolService {
  private cards = inject(QrCardService);
  private auth = inject(AuthService);

  status = signal<CardPoolStatus | null>(null);

  /** Dismissed (or already shown) today — kept per tenant, see storageKey(). */
  private dismissed = signal(false);

  /** The server's verdict. Never recomputed from remaining/threshold here. */
  warn = computed(() => this.status()?.warn === true);
  remaining = computed(() => this.status()?.remaining ?? 0);
  threshold = computed(() => this.status()?.threshold ?? 0);

  showDialog = computed(() => this.warn() && !this.dismissed());

  /**
   * Per tenant, so the debug login hopping between tenants — and any shared
   * office browser — does not carry one academy's dismissal to another.
   */
  private storageKey(): string {
    return `netrofit.cardLowNotice.${this.auth.currentUser()?.companyId ?? 'unknown'}`;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  load(): void {
    // The pool is sold per academy and the flag rides on the login payload, so a
    // tenant who has no pool at all costs no request. Whether the NUDGE is on is
    // the server's business — that answer needs the call.
    if (this.auth.currentUser()?.qrCardsEnabled !== true) return;

    try {
      this.dismissed.set(localStorage.getItem(this.storageKey()) === this.today());
    } catch {
      // Private mode / blocked storage: show it rather than swallow it.
      this.dismissed.set(false);
    }

    this.cards.poolStatus().subscribe({
      next: (s) => this.status.set(s),
      // Quiet on purpose: this is a nudge, and a failure here must never put an
      // error in front of whatever the user actually opened.
      error: () => {},
    });
  }

  dismiss(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(this.storageKey(), this.today());
    } catch {
      // Not persisting is fine — it reappears on the next load, no worse than
      // before, and never blocks the dialog from closing.
    }
  }
}
