/**
 * What the camera scanners are allowed to decode.
 *
 * The app reads two things off a student: the QR on their card, and a BARCODE of
 * the code printed on it. Both end up in the same place — GlobalScanService turns
 * either into a student — so the camera has to be told to look for both.
 *
 * The formats enum is passed in rather than imported: html5-qrcode is loaded
 * lazily (it is a heavy dependency and most sessions never scan), and importing
 * the enum here would drag the whole library into the bundle that imports this.
 *
 * The 1D list is the set actually found on printed cards and labels. Leaving out
 * the exotic ones is deliberate: every extra format is more work per frame and
 * one more way to mis-read a blurry image.
 */
export function scannerFormats(F: any): any[] {
  return [
    F.QR_CODE,
    F.CODE_128,   // the usual choice for a generated barcode
    F.CODE_39,
    F.EAN_13,
    F.EAN_8,
    F.UPC_A,
    F.UPC_E,
    F.ITF,
    F.CODABAR,
  ].filter((f) => f !== undefined);
}

/**
 * The scan window. Wider than tall on purpose: a 1D barcode is a long strip and
 * barely fits a square box, while a QR is happy anywhere inside it.
 */
export const SCAN_BOX = { width: 280, height: 180 };

/** The camera config every scanner in the app uses. */
export function cameraScanConfig(F: any) {
  return { fps: 10, qrbox: SCAN_BOX, formatsToSupport: scannerFormats(F) };
}
