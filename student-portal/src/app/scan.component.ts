import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18nService } from './i18n.service';
import { StudentAuthService } from './auth/student-auth.service';

/**
 * The card scan that starts a claim (first visit) or a password reset.
 *
 * The camera flow is a trimmed copy of the staff app's proven one
 * (frontend/.../camera-scan-dialog.component.ts): html5-qrcode loaded on
 * demand, the same raw-value dedup against per-frame re-decodes, and the same
 * `/p/s/<token>` URL parsing (case-insensitive, lower-cased) as
 * GlobalScanService.extractToken. QR only, though — a student card's barcode
 * carries the printed code, which only the staff API can resolve.
 *
 * After a successful claim-start the student must CONFIRM the name on screen —
 * a mis-scan of someone else's card must never set that person's password.
 */
@Component({
  selector: 'app-scan',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="card">
      <h1>{{ i18n.t('SCAN.HEADING') }}</h1>

      @if (!confirmName()) {
        <p class="muted">{{ i18n.t('SCAN.HINT') }}</p>
        <div id="portal-scan-region" class="scan-region"></div>
        @if (starting()) { <p class="muted" style="text-align:center; margin-block-start:8px;">{{ i18n.t('SCAN.STARTING') }}</p> }
        @if (checking()) { <p class="muted" style="text-align:center; margin-block-start:8px;">{{ i18n.t('SCAN.CHECKING') }}</p> }
      } @else {
        <div style="text-align:center; padding-block: 20px;">
          <p class="muted">{{ i18n.t('SCAN.IS_THIS_YOU') }}</p>
          <h2 style="font-size:1.4rem;">{{ confirmName() }}</h2>
          <button type="button" class="btn" (click)="confirm()">{{ i18n.t('SCAN.YES_ME') }}</button>
          <button type="button" class="btn ghost" (click)="rescan()">{{ i18n.t('SCAN.NOT_ME') }}</button>
        </div>
      }

      @if (error()) { <div class="error">{{ error() }}</div> }

      <a routerLink="/" class="link" style="display:block; text-align:center; margin-block-start:16px;">{{ i18n.t('SCAN.BACK') }}</a>
    </div>
  `,
})
export class ScanComponent implements OnInit, OnDestroy {
  i18n = inject(I18nService);
  private auth = inject(StudentAuthService);
  private router = inject(Router);

  starting = signal(false);
  checking = signal(false);
  error = signal('');
  confirmName = signal('');

  private html5Qr: any;
  // Suppress the rapid repeat decodes html5-qrcode fires for one physical scan.
  private lastScan = '';
  private lastScanAt = 0;
  private readonly DEDUP_MS = 2500;

  ngOnInit(): void {
    void this.start();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  confirm(): void {
    // claim-start already stashed the ticket in the auth service.
    this.router.navigate(['/claim']);
  }

  rescan(): void {
    this.auth.claim.set(null);
    this.confirmName.set('');
    this.error.set('');
    this.lastScan = '';
    void this.start();
  }

  private async start(): Promise<void> {
    if (this.html5Qr) return;
    this.starting.set(true);
    try {
      // Loaded on demand — html5-qrcode is the heaviest thing in this app and
      // only this screen needs it.
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      this.html5Qr = new Html5Qrcode('portal-scan-region');
      await this.html5Qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 }, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] },
        (decodedText: string) => this.handle(decodedText),
        // Per-frame decode failures are normal (no code in view) — ignore.
        () => {},
      );
    } catch {
      this.html5Qr = undefined;
      this.error.set(this.i18n.t('SCAN.CAMERA_FAILED'));
    } finally {
      this.starting.set(false);
    }
  }

  private stop(): void {
    const qr = this.html5Qr;
    this.html5Qr = undefined;
    if (!qr) return;
    // stop() rejects if it already stopped; swallow it.
    qr.stop().then(() => qr.clear()).catch(() => {});
  }

  /** A scanned profile URL or bare value → the raw QR token, lower-cased. */
  private extractToken(text: string): string {
    const raw = (text || '').trim();
    const m = raw.match(/\/p\/s\/([^/?#]+)/i);
    return (m ? m[1] : raw).toLowerCase();
  }

  private handle(decodedText: string): void {
    const raw = (decodedText || '').trim();
    if (!raw || this.checking()) return;
    const now = Date.now();
    if (raw === this.lastScan && now - this.lastScanAt < this.DEDUP_MS) return;
    this.lastScan = raw;
    this.lastScanAt = now;

    const token = this.extractToken(raw);
    if (!/^[a-f0-9]{16,64}$/.test(token)) {
      this.error.set(this.i18n.t('ERRORS.STUDENT_AUTH.CARD_NOT_FOUND'));
      return;
    }

    this.checking.set(true);
    this.error.set('');
    this.auth.claimStart(token).subscribe({
      next: (r) => {
        this.checking.set(false);
        this.stop();
        this.confirmName.set(r.studentName);
      },
      error: (err) => {
        this.checking.set(false);
        this.error.set(this.i18n.fromError(err));
      },
    });
  }
}
