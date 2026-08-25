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
  /** Worth flagging while they stand there: an absence run, money owed. */
  warning?: string | null;
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
        } @else if (errorKey(); as ek) {
          <!-- Stays open on failure: the fix is usually on the user's side
               (grant the permission, close the other app) and closing the
               dialog would make them start over to find out if it worked. -->
          <div class="rounded-md bg-red-50 text-red-700 px-3 py-2 text-sm text-center">
            <i class="pi pi-exclamation-triangle me-1"></i>{{ ek | translate }}
          </div>
          <p-button
            [label]="'SESSION_ATTENDANCE.SCAN_RETRY' | translate"
            icon="pi pi-refresh"
            size="small"
            styleClass="w-full"
            (onClick)="retry()"
          ></p-button>
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
          <!-- Flags worth acting on while the student is still at the door. -->
          @if (feedback.warning) {
            <div class="rounded-md bg-amber-50 text-amber-800 px-3 py-2 text-sm text-center">
              <i class="pi pi-exclamation-triangle me-1"></i>{{ feedback.warning }}
            </div>
          }
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
  /** Why the camera could not start — an i18n key, shown with a Retry button. */
  errorKey = signal<string | null>(null);
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
    this.errorKey.set(null);
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
    this.errorKey.set(null);
    let lastError: any = null;
    try {
      // Loaded on demand: html5-qrcode is heavy and most scanning is done with a
      // reader, so it must not sit in the host page's chunk.
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      this.scanConfig = cameraScanConfig(Html5QrcodeSupportedFormats);
      this.html5Qr = new Html5Qrcode(this.regionId);

      // A previously chosen lens beats the browser's guess — but a saved id can
      // go stale (another phone's id synced in, a browser reshuffle), so fall
      // back to the default rather than failing the whole dialog over it.
      const attempts: any[] = [];
      const saved = this.savedCameraId();
      if (saved) attempts.push({ deviceId: { exact: saved } });
      attempts.push({ facingMode: 'environment' });

      let started = false;
      for (const selector of attempts) {
        try { await this.startWith(selector); started = true; break; }
        catch (e) {
          lastError = e;
          if (selector.deviceId) { try { localStorage.removeItem(CameraScanDialogComponent.CAMERA_KEY); } catch {} }
        }
      }

      // Some older/locked-down Androids (Samsung A-series among them) refuse
      // the facingMode constraint outright yet start the very same lens by its
      // deviceId. Enumerate — the failed attempt above usually won the
      // permission, so labels are readable now — and walk the list, back
      // lenses first.
      if (!started) {
        let cams: Array<{ id: string; label: string }> = [];
        try { cams = (await Html5Qrcode.getCameras()) || []; } catch (e) { lastError = lastError ?? e; }
        const backFirst = [...cams].sort((a, b) => this.backRank(b.label) - this.backRank(a.label));
        for (const cam of backFirst) {
          try { await this.startWith({ deviceId: { exact: cam.id } }); started = true; break; }
          catch (e) { lastError = e; }
        }
      }
      if (!started) throw lastError ?? new Error('camera start failed');

      this.currentCameraId.set(this.runningCameraId() ?? saved);
      // Only after start: enumeration needs the permission the start just won,
      // and before it the labels come back empty on most phones. Plain
      // enumerateDevices, NOT Html5Qrcode.getCameras(): that helper opens the
      // camera a second time to win permission, and on many Androids a second
      // open while the preview is streaming fails "in use" — which silently
      // left the list empty and the lens picker hidden. The running preview
      // already holds the permission, so a bare enumeration returns every
      // camera with its label ("Back Ultra Wide Camera", "camera 0, facing
      // back"); only the ones that report nothing get numbered.
      this.listCameras();
    } catch (e) {
      // Keep the dialog open with the reason and a Retry: the cure is usually
      // on the user's side (grant the permission, close the app holding the
      // camera), and they need somewhere to try again from.
      try { this.html5Qr?.clear?.(); } catch {}
      this.html5Qr = undefined;
      this.errorKey.set(this.classifyCameraError(e ?? lastError));
    } finally {
      this.starting.set(false);
    }
  }

  retry(): void {
    this.errorKey.set(null);
    void this.start();
  }

  /** Every camera the device admits to, labels included — no hardware touched. */
  private listCameras(): void {
    navigator.mediaDevices?.enumerateDevices?.()
      .then((devices) => {
        const cams = (devices || []).filter((d) => d.kind === 'videoinput' && d.deviceId);
        this.cameras.set(cams.map((c, i) => ({ id: c.deviceId, label: c.label || `Camera ${i + 1}` })));
      })
      .catch(() => {});
  }

  /** Higher = more likely the main back camera; used to order blind attempts. */
  private backRank(label: string): number {
    const l = (label || '').toLowerCase();
    if (/back|rear|environment|خلفية/.test(l)) return /wide|ultra|tele|macro|depth/.test(l) ? 1 : 2;
    if (/front|face|user|أمامية/.test(l)) return -1;
    return 0;
  }

  /** Turn a getUserMedia failure into advice the user can act on. */
  private classifyCameraError(e: any): string {
    const text = `${String(e?.name ?? '')} ${String(e?.message ?? e ?? '')}`.toLowerCase();
    if (text.includes('notallowed') || text.includes('permission') || text.includes('denied')) {
      return 'SESSION_ATTENDANCE.SCAN_DENIED';
    }
    if (text.includes('notreadable') || text.includes('trackstart') || text.includes('in use')
      || text.includes('hardware') || text.includes('aborterror')) {
      return 'SESSION_ATTENDANCE.SCAN_BUSY';
    }
    if (text.includes('notfound') || text.includes('no camera') || text.includes('devicesnotfound')) {
      return 'SESSION_ATTENDANCE.SCAN_NO_CAMERA';
    }
    return 'SESSION_ATTENDANCE.SCAN_FAILED';
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
    } catch (e) {
      try { this.html5Qr?.clear?.(); } catch {}
      this.html5Qr = undefined;
      this.errorKey.set(this.classifyCameraError(e));
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
