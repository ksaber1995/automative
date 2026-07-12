import QRCode from 'qrcode';
import { CardDesign } from '@shared/interfaces/card-design.interface';
import { CARD_THEMES, CardTemplate, DEFAULT_TEMPLATE } from './card-theme';
import { CARD_H, CARD_W, StudentCardData, drawStudentCard, setCardTheme } from './student-card.util';
import { drawCardBack } from './card-back.util';
import { drawCardBackMinimal, drawStudentCardMinimal } from './card-minimal.util';

/**
 * The one place that turns a template + data into a PNG. Both faces of a card
 * always go through here, so the front a student gets and the shared back always
 * come from the same template.
 */

export { CARD_W, CARD_H } from './student-card.util';
export type { StudentCardData } from './student-card.util';
export { currentAcademicYear } from './student-card.util';

function themeFor(template?: CardTemplate) {
  return CARD_THEMES[template ?? DEFAULT_TEMPLATE] ?? CARD_THEMES[DEFAULT_TEMPLATE];
}

async function qrImage(url: string): Promise<HTMLImageElement> {
  const dataUrl = await QRCode.toDataURL(url, { width: 500, margin: 0 });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

function prepare(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  return ctx;
}

/**
 * FRONT face — one per student. Returns raw base64 PNG (no data-URL prefix), ready
 * for JSZip. Pass a canvas to reuse across a batch; a fresh 1016x638 canvas per
 * student would otherwise pin a lot of memory on a large export.
 */
export async function renderStudentCardPng(
  data: StudentCardData,
  canvas: HTMLCanvasElement,
  template?: CardTemplate,
): Promise<string> {
  const ctx = prepare(canvas);
  const qr = await qrImage(data.qrUrl);

  setCardTheme(themeFor(template));
  if (template === 'minimal') drawStudentCardMinimal(ctx, data, qr);
  else drawStudentCard(ctx, data, qr);

  return canvas.toDataURL('image/png').split(',')[1];
}

/**
 * BACK face — one per academy, shared by every card. The QR block is dropped
 * entirely when no link is configured.
 */
export async function renderCardBackPng(design: CardDesign, canvas: HTMLCanvasElement): Promise<string> {
  const ctx = prepare(canvas);
  const link = (design.qrLink || '').trim();
  const qr = link ? await qrImage(link) : null;

  const template = design.template as CardTemplate | undefined;
  setCardTheme(themeFor(template));
  if (template === 'minimal') drawCardBackMinimal(ctx, design, qr);
  else drawCardBack(ctx, design, qr);

  return canvas.toDataURL('image/png').split(',')[1];
}
