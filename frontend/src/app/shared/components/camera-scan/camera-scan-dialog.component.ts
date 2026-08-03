import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { GlobalScanService } from '../../../core/services/global-scan.service';
import { NotificationService } from '../../../core/services/notification.service';
import { cameraScanConfig } from '../../../core/utils/scanner-formats.util';

/** What the host reports back about the student who was just scanned. */
export interface CameraScanFeedback {
  name: string;
  alreadyPresent: boolean;
}

/**
 * Camera check-in for phones. Every scanning flow in this app assumes a
 * USB/keyboard-wedge reader — it types the code and the app-wide handler catches
 * it — and a phone has no such reader.
 *
 * This owns the camera and nothing else: it emits the resolved TOKEN and lets
 * the host decide what that means. A card QR and a barcode of the printed code
 * both resolve here (via GlobalScanService), so hosts never learn the difference.
 *
 * It stays open between reads so a queue of students can be worked through one
 * after another.
 */
@Component({
  selector: 'app-camera-scan-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule, TranslateModule],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="$event ? null : close()"
      [modal]="true"
      [draggable]="false"
      [dismissableMask]="true"
      [style]="{ width: '22rem', maxWidth: '95vw' }"
      [header]="'SESSION_ATTENDANCE.SCAN_TITLE' | translate"
    >
      <div class="space-y-2">
        <div [id]="regionId" class="w-full rounded-lg overflow-hidden bg-black/90 min-h-[240px]"></div>
        @if (starting()) {
          <p class="text-center text-sm text-gray-500">
            <i class="pi pi-spin pi-spinner me-1"></i>{{ 'SESSION_ATTENDANCE.SCAN_STARTING' | translate }}
          </p>
        } @else {
          <p class="text-center text-xs text-gray-500">{{ 'SESSION_ATTENDANCE.SCAN_HINT' | translate }}</p>
        }
        @if (feedback) {
          <div class="rounded-md px-3 py-2 text-sm text-center"
            [class.bg-green-50]="!feedback.alreadyPresent" [class.text-green-700]="!feedback.alreadyPresent"
            [class.bg-gray-100]="feedback.alreadyPresent" [class.text-gray-600]="feedback.alreadyPresent">
            <i class="pi" [class.pi-check-circle]="!feedback.alreadyPresent" [class.pi-info-circle]="feedback.alreadyPresent"></i>
            {{ feedback.name }}
            @if (feedback.alreadyPresent) { · {{ 'SESSIONS_DASHBOARD.PRESENT' | translate }} }
          </div>
        }
      </div>

      <ng-template pTemplate="footer">
        <p-button [label]="'SESSION_ATTENDANCE.SCAN_DONE' | translate" icon="pi pi-check" (onClick)="close()"></p-button>
      </ng-template>
    </p-dialog>
  `,
})
export class CameraScanDialogComponent {
  private globalScan = inject(GlobalScanService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  /** Unique per host: two of these on one page would fight over the element. */
  @Input() regionId = 'camera-scan-region';
  /** The last check-in, shown under the preview. Owned by the host. */
  @Input() feedback: CameraScanFeedback | null = null;

  /** A resolved student token. The host decides what to do with it. */
  @Output() scanned = new EventEmitter<string>();

  visible = signal(false);
  starting = signal(false);
  private html5Qr?: any;
  // Suppress the rapid repeat decodes html5-qrcode fires for one physical scan.
  private lastScan = '';
  private lastScanAt = 0;
  private readonly DEDUP_MS = 2500;

  open(): void {
    this.visible.set(true);
    this.lastScan = '';
    // The preview element only exists once the dialog has rendered.
    setTimeout(() => this.start(), 100);
  }

  close(): void {
    this.stop();
    this.visible.set(false);
  }

  private async start(): Promise<void> {
    if (this.html5Qr) return;
    this.starting.set(true);
    try {
      // Loaded on demand: html5-qrcode is heavy and most scanning is done with a
      // reader, so it must not sit in the host page's chunk.
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      this.html5Qr = new Html5Qrcode(this.regionId);
      await this.html5Qr.start(
        { facingMode: 'environment' },
        cameraScanConfig(Html5QrcodeSupportedFormats),
        (decodedText: string) => this.handle(decodedText),
        // Per-frame decode failures are normal (no code in view) — ignore.
        () => {},
      );
    } catch {
      // Close rather than leave a black rectangle with no way forward.
      this.html5Qr = undefined;
      this.visible.set(false);
      this.notify.warning(this.translate.instant('NAV.QR_CAMERA_FAILED'));
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

  private handle(decodedText: string): void {
    const raw = (decodedText || '').trim();
    if (!raw) return;
    // Dedup on the RAW value: a camera re-reads the same frame many times a
    // second, and a barcode must not fire a lookup per frame.
    const now = Date.now();
    if (raw === this.lastScan && now - this.lastScanAt < this.DEDUP_MS) return;
    this.lastScan = raw;
    this.lastScanAt = now;

    this.globalScan.resolveScan(raw).subscribe({
      next: (token) => { if (token) this.scanned.emit(token); },
      error: () => this.notify.error(this.translate.instant('NAV.QR_STUDENT_NOT_FOUND')),
    });
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
