import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
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
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule, SelectModule, TranslateModule],
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
        <!-- Phones carry several back lenses (main, wide, tele) and the browser's
             default is often the wide one, which can't focus on a card — so the
             choice has to be the user's. A named list, not a blind cycle button:
             with three or four lenses the user should pick the one they mean.
             Hidden when there is nothing to choose between. -->
        @if (cameras().length > 1) {
          <p-select
            [options]="cameras()"
            optionLabel="label"
            optionValue="id"
            [ngModel]="currentCameraId()"
            (onChange)="selectCamera($event.value)"
            [placeholder]="'SESSION_ATTENDANCE.CHOOSE_CAMERA' | translate"
            [disabled]="starting()"
            styleClass="w-full"
            size="small"
            appendTo="body"
          ></p-select>
        }
        <!-- Many Androids expose ONE logical back camera to the browser — the
             wide and main lenses are not separate devices, they are zoom levels
             (0.5× is the wide lens). So when the running track reports a zoom
             range, offer the presets it supports; on such phones this IS the
             camera choice, and on the rest it helps focus on a small card. -->
        @if (zoomOptions().length) {
          <div class="flex justify-center gap-2">
            @for (z of zoomOptions(); track z) {
              <button type="button"
                class="px-3 py-1 rounded-full border text-sm transition-colors"
                [class.bg-indigo-600]="isZoom(z)" [class.text-white]="isZoom(z)" [class.border-indigo-600]="isZoom(z)"
                [class.bg-white]="!isZoom(z)" [class.text-gray-700]="!isZoom(z)" [class.border-gray-300]="!isZoom(z)"
                [disabled]="starting()"
                (click)="setZoom(z)">{{ z }}×</button>
            }
          </div>
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

  /** The device's cameras, once known. More than one → the picker shows. */
  cameras = signal<{ id: string; label: string }[]>([]);
  currentCameraId = signal<string | null>(null);
  private scanConfig: any;
  /** Survives page loads: the lens that worked is the lens wanted next time. */
  private static readonly CAMERA_KEY = 'scanCameraId';
  private static readonly ZOOM_KEY = 'scanCameraZoom';

  /** Zoom presets the running camera supports; empty → no zoom row. */
  zoomOptions = signal<number[]>([]);
  currentZoom = signal<number | null>(null);

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
      this.scanConfig = cameraScanConfig(Html5QrcodeSupportedFormats);
      this.html5Qr = new Html5Qrcode(this.regionId);

      // A previously chosen lens beats the browser's guess — but a saved id can
      // go stale (another phone's id synced in, a browser reshuffle), so fall
      // back to the default rather than failing the whole dialog over it.
      const saved = this.savedCameraId();
      if (saved) {
        try {
          await this.startWith({ deviceId: { exact: saved } });
        } catch {
          localStorage.removeItem(CameraScanDialogComponent.CAMERA_KEY);
          await this.startWith({ facingMode: 'environment' });
        }
      } else {
        await this.startWith({ facingMode: 'environment' });
      }

      this.currentCameraId.set(this.runningCameraId() ?? saved);
      // Only after start: enumeration needs the permission the start just won,
      // and before it the labels come back empty on most phones. The device's
      // own label names the lens ("Back Ultra Wide Camera", "camera 0, facing
      // back") — keep it, and only number the ones that report nothing.
      Html5Qrcode.getCameras()
        .then((cams: Array<{ id: string; label: string }>) =>
          this.cameras.set((cams || []).map((c, i) => ({ id: c.id, label: c.label || `Camera ${i + 1}` }))))
        .catch(() => {});
    } catch {
      // Close rather than leave a black rectangle with no way forward.
      this.html5Qr = undefined;
      this.visible.set(false);
      this.notify.warning(this.translate.instant('NAV.QR_CAMERA_FAILED'));
    } finally {
      this.starting.set(false);
    }
  }

  private async startWith(cameraSelector: any): Promise<void> {
    await this.html5Qr.start(
      cameraSelector,
      this.scanConfig,
      (decodedText: string) => this.handle(decodedText),
      // Per-frame decode failures are normal (no code in view) — ignore.
      () => {},
    );
    // Capabilities can lag the stream by a beat on Android; read them after a
    // short settle rather than immediately and getting an empty object.
    setTimeout(() => this.refreshZoom(), 300);
  }

  /** The MediaStreamTrack behind the preview — the zoom lives on it. */
  private videoTrack(): MediaStreamTrack | null {
    try {
      const video = document.getElementById(this.regionId)?.querySelector('video') as HTMLVideoElement | null;
      const stream = video?.srcObject as MediaStream | null;
      return stream?.getVideoTracks()[0] ?? null;
    } catch { return null; }
  }

  private refreshZoom(): void {
    const track = this.videoTrack();
    const zoom = (track?.getCapabilities?.() as any)?.zoom;
    if (!track || typeof zoom?.min !== 'number' || typeof zoom?.max !== 'number') {
      this.zoomOptions.set([]);
      this.currentZoom.set(null);
      return;
    }
    const presets = [0.5, 1, 2, 3].filter((z) => z >= zoom.min && z <= zoom.max);
    this.zoomOptions.set(presets.length > 1 ? presets : []);
    this.currentZoom.set(typeof (track.getSettings?.() as any)?.zoom === 'number'
      ? (track.getSettings() as any).zoom : null);
    // The zoom that worked last time is the zoom wanted this time.
    const saved = parseFloat(localStorage.getItem(CameraScanDialogComponent.ZOOM_KEY) || '');
    if (presets.includes(saved) && !this.isZoom(saved)) void this.setZoom(saved);
  }

  isZoom(z: number): boolean {
    const c = this.currentZoom();
    return c !== null && Math.abs(c - z) < 0.01;
  }

  async setZoom(z: number): Promise<void> {
    const track = this.videoTrack();
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: z } as any] });
      this.currentZoom.set(z);
      try { localStorage.setItem(CameraScanDialogComponent.ZOOM_KEY, String(z)); } catch {}
    } catch {
      // The device refused this level — leave the buttons as they are.
    }
  }

  /** Restart on the chosen camera and remember it for every later scan. */
  async selectCamera(id: string | null): Promise<void> {
    if (!id || id === this.currentCameraId() || !this.html5Qr || this.starting()) return;
    this.starting.set(true);
    try {
      await this.html5Qr.stop();
      await this.startWith({ deviceId: { exact: id } });
      this.currentCameraId.set(id);
      try { localStorage.setItem(CameraScanDialogComponent.CAMERA_KEY, id); } catch {}
    } catch {
      this.html5Qr = undefined;
      this.visible.set(false);
      this.notify.warning(this.translate.instant('NAV.QR_CAMERA_FAILED'));
    } finally {
      this.starting.set(false);
    }
  }

  private savedCameraId(): string | null {
    try { return localStorage.getItem(CameraScanDialogComponent.CAMERA_KEY); } catch { return null; }
  }

  /** The deviceId actually streaming, when the library exposes it. */
  private runningCameraId(): string | null {
    try { return this.html5Qr?.getRunningTrackSettings?.()?.deviceId ?? null; } catch { return null; }
  }

  private stop(): void {
    this.zoomOptions.set([]);
    this.currentZoom.set(null);
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
