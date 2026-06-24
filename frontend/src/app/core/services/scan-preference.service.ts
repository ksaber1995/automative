import { Injectable, signal } from '@angular/core';

/**
 * Tracks whether a USB (keyboard-wedge) barcode/QR scanner is present on THIS
 * device. Browsers can't probe USB HID keyboards, so we detect a scanner the
 * first time one is actually used — a wedge fires a fast keystroke burst ending
 * in Enter (captured app-wide), and feature pages call markUsbDetected() when a
 * scan arrives. The result is remembered per-device in localStorage.
 *
 * Consumers use this to decide the scan default: when a USB scanner is known to
 * exist, the "Scan QR" button does NOT auto-start the camera (the wedge handles
 * scans); the camera stays available as an explicit fallback for devices with no
 * scanner (phones/tablets).
 */
@Injectable({ providedIn: 'root' })
export class ScanPreferenceService {
  private readonly KEY = 'usbScannerDetected';

  /** True once a USB scanner has been observed on this device. */
  readonly usbDetected = signal<boolean>(this.read());

  private read(): boolean {
    try {
      return localStorage.getItem(this.KEY) === '1';
    } catch {
      return false;
    }
  }

  /** Record that a USB scanner is present on this device (idempotent). */
  markUsbDetected(): void {
    if (this.usbDetected()) return;
    this.usbDetected.set(true);
    try {
      localStorage.setItem(this.KEY, '1');
    } catch {
      /* ignore storage failures */
    }
  }
}
