import QRCode from 'qrcode';
import { CardDesign, composeAdjust } from '@shared/interfaces/card-design.interface';
import { CARD_THEMES, CardTemplate, DEFAULT_TEMPLATE, tuneTheme } from './card-theme';
import {
  CARD_H, CARD_W, CardImages, StudentCardData, drawStudentCard, setCardAdjust, setCardTheme,
} from './student-card.util';
import { drawCardBack } from './card-back.util';
import { drawCardBackMinimal, drawStudentCardMinimal } from './card-minimal.util';
import { drawCardBackPortrait, drawStudentCardPortrait } from './card-portrait.util';
import {
  AgnosticCardData, AgnosticTemplate, DEFAULT_AGNOSTIC, drawAgnosticBack, drawAgnosticFront,
} from './card-agnostic.util';
import { drawCustomBack, drawCustomFront } from './card-custom.util';

/**
 * The one place that turns a template + data into a PNG. Both faces of a card
 * always go through here, so the front a student gets and the shared back always
 * come from the same template.
 */

export { CARD_W, CARD_H, DESIGN_W, DESIGN_H } from './student-card.util';
export { canExportCustom } from './card-custom.util';
export type { StudentCardData } from './student-card.util';
export { currentAcademicYear } from './student-card.util';

function themeFor(template?: CardTemplate, design?: CardDesign | null) {
  const base = CARD_THEMES[template ?? DEFAULT_TEMPLATE] ?? CARD_THEMES[DEFAULT_TEMPLATE];
  return tuneTheme(base, design?.student);
}

/**
 * Arm the module-level palette + tuning for the draw that follows.
 *
 * Both must be set on EVERY entry point, never just the first: the bulk export
 * reuses one canvas and one module, so a card rendered after a differently-tuned
 * one would otherwise inherit its neighbour's colours and logo offset.
 *
 * The pool is armed per FACE. Both of its faces carry a logo, so one set of offsets
 * moved both at once; placement therefore comes from that face's own record while
 * the palette still comes from `pool` for both — see composeAdjust.
 */
function arm(
  design: CardDesign | null | undefined,
  which: 'student' | 'pool-front' | 'pool-back',
  template?: CardTemplate,
) {
  setCardTheme(themeFor(template, which === 'student' ? design : null));
  if (which === 'student') {
    setCardAdjust(design?.student);
    return;
  }
  // `?? pool` on the back: designs saved before the split placed both logos with
  // `pool`, and have to keep rendering exactly as they did.
  const placement = which === 'pool-back' ? (design?.poolBack ?? design?.pool) : design?.pool;
  setCardAdjust(composeAdjust(placement, design?.pool));
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
  // The bulk export reuses ONE canvas for every student, and the draw functions
  // leave a scale transform behind. Reset it, or the next card would be drawn
  // through it a second time.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  return ctx;
}

/**
 * Decode the design's photo/logo/artwork data URLs ONCE, so a 500-student export
 * doesn't re-decode the same images 500 times. A broken or empty value yields null
 * and the card falls back to its built-in placeholder/crest.
 *
 * These must be data URLs, not hosted ones: an image from another origin taints
 * the canvas, and canvas.toDataURL() then throws — the export would die.
 */
export async function loadCardImages(design?: CardDesign | null): Promise<CardImages> {
  const decode = async (src?: string): Promise<HTMLImageElement | null> => {
    if (!src) return null;
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      return img;
    } catch {
      return null;
    }
  };
  return {
    photo: await decode(design?.photo),
    logo: await decode(design?.logo),
    artFront: await decode(design?.artFront),
    artBack: await decode(design?.artBack),
  };
}

/**
 * FRONT face — one per student. Returns raw base64 PNG (no data-URL prefix), ready
 * for JSZip. Pass a canvas to reuse across a batch; a fresh canvas per student
 * would otherwise pin a lot of memory on a large export. Pass `images` from
 * loadCardImages() so the teacher's photo and logo are decoded once, not per card.
 */
export async function renderStudentCardPng(
  data: StudentCardData,
  canvas: HTMLCanvasElement,
  template?: CardTemplate,
  images: CardImages = {},
  design?: CardDesign | null,
): Promise<string> {
  const ctx = prepare(canvas);
  const qr = await qrImage(data.qrUrl);

  arm(design, 'student', template);
  // 'portrait' takes no images on the front — the teacher's photo and logo are on
  // its BACK, which is the whole point of that template.
  if (template === 'portrait') drawStudentCardPortrait(ctx, data, qr);
  else if (template === 'minimal') drawStudentCardMinimal(ctx, data, qr, images);
  else drawStudentCard(ctx, data, qr, images);

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
  arm(design, 'student', template);
  if (template === 'portrait') {
    // The only back face that carries images: the teacher's photo and logo.
    drawCardBackPortrait(ctx, design, qr, await loadCardImages(design));
  } else if (template === 'minimal') {
    drawCardBackMinimal(ctx, design, qr);
  } else {
    drawCardBack(ctx, design, qr);
  }

  return canvas.toDataURL('image/png').split(',')[1];
}

// ─────────────────────────── the QR card pool ────────────────────────────────

/**
 * A POOL card's front. No student data — just the card's own QR and its serial.
 * The academy's agnostic template governs both faces, exactly as `template` does
 * for the personal cards.
 */
export async function renderAgnosticCardPng(
  data: AgnosticCardData,
  canvas: HTMLCanvasElement,
  template?: AgnosticTemplate,
  images: CardImages = {},
  design?: CardDesign | null,
): Promise<string> {
  const ctx = prepare(canvas);
  const qr = await qrImage(data.qrUrl);
  // The agnostic templates carry their own palettes (tuned in drawAgnosticFront);
  // the shared text primitives still read T for the typeface, so give them a sans
  // one — and NOT the tenant's student colours, which do not apply to a pool card.
  arm(design, 'pool-front', 'navy');
  // 'custom' is the academy's own artwork — a different job entirely, and none of
  // the palette tuning above applies to somebody else's JPEG.
  if (template === 'custom') drawCustomFront(ctx, design ?? ({} as CardDesign), data.code, qr, images);
  else drawAgnosticFront(ctx, template ?? DEFAULT_AGNOSTIC, data, qr, images);
  return canvas.toDataURL('image/png').split(',')[1];
}

/** A POOL card's back — one per academy, shared by the whole batch. */
export async function renderAgnosticBackPng(
  design: CardDesign,
  companyName: string,
  canvas: HTMLCanvasElement,
  images: CardImages = {},
): Promise<string> {
  const ctx = prepare(canvas);
  const link = (design.qrLink || '').trim();
  const qr = link ? await qrImage(link) : null;
  arm(design, 'pool-back', 'navy');
  const kind = (design.agnosticTemplate as AgnosticTemplate) ?? DEFAULT_AGNOSTIC;
  if (kind === 'custom') drawCustomBack(ctx, design, images);
  else drawAgnosticBack(ctx, kind, design, companyName, qr, images);
  return canvas.toDataURL('image/png').split(',')[1];
}
