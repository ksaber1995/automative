import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import QRCode from 'qrcode';
import { AdminQrCard } from './models';

/**
 * Card serials live in reserved ranges above every organic student code, and the
 * printed form drops the base: a V2 card (900005) prints "05", an old one
 * (100005) prints "A5". The prefix is not decoration — it IS the range, and it is
 * what staff type to find the card.
 *
 * MUST stay identical to formatStudentCode in
 * frontend/src/app/core/utils/student-code.util.ts. New runs mint in the V2
 * range, so getting only the old base right renders 900001 as "A800001" — a
 * number that resolves to nothing, printed on physical plastic.
 */
const CARD_SERIAL_BASE = 100000;
/** Exported so a chosen start number can be previewed as the label it will print. */
export const CARD_SERIAL_BASE_V2 = 900000;

export function serialLabel(serial: number): string {
  if (!Number.isFinite(serial)) return String(serial);
  if (serial >= CARD_SERIAL_BASE_V2) return `0${serial - CARD_SERIAL_BASE_V2}`;
  return serial > CARD_SERIAL_BASE ? `A${serial - CARD_SERIAL_BASE}` : String(serial);
}

/** The URL a phone camera resolves when it scans the card. */
export function cardScanUrl(token: string, origin = 'https://app.netrofit.com'): string {
  return `${origin}/p/s/${token}`;
}

/**
 * Render one card as a PNG: the plain QR only, no serial printed on it. The
 * number still identifies the file — it is the (lowercase) filename in the zip —
 * so the readable label lives there instead of baked into the image.
 *
 * Plain QR by design — the tenant's own card artwork lives in the main app's
 * renderer, and copying ~2,500 lines of it here would leave two versions to
 * drift apart.
 */
async function renderCardPng(card: AdminQrCard, size = 600): Promise<string> {
  // qrcode writes the whole canvas (white quiet zone included), so we can draw
  // straight onto it — the image is nothing but the QR.
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, cardScanUrl(card.token), {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  return canvas.toDataURL('image/png').split(',')[1];
}

/**
 * Zip a run of cards as PNGs and hand it to the browser.
 *
 * `onProgress` drives the progress bar — a 500-card run is a few thousand canvas
 * operations and the tab looks frozen without it.
 */
export async function downloadCardsZip(
  cards: AdminQrCard[],
  companyName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const zip = new JSZip();
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    zip.file(`${serialLabel(card.serial).toLowerCase()}.png`, await renderCardPng(card), { base64: true });
    onProgress?.(i + 1, cards.length);
    // Yield every 25 cards so the progress bar actually repaints.
    if (i % 25 === 24) await new Promise((r) => setTimeout(r));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const first = cards[0] ? serialLabel(cards[0].serial).toLowerCase() : '';
  const last = cards[cards.length - 1] ? serialLabel(cards[cards.length - 1].serial).toLowerCase() : '';
  // Safe filename: tenant names are Arabic as often as not.
  const slug = companyName.replace(/[^\w؀-ۿ-]+/g, '_').replace(/^_+|_+$/g, '') || 'cards';
  saveAs(blob, `${slug}-${first}-${last}.zip`);
}
