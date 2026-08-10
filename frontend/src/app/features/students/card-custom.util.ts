import { CardDesign, PoolArtLayout, clampPoolArt } from '@shared/interfaces/card-design.interface';
import {
  CARD_CORNER, CardImages, Ctx, DESIGN_H, DESIGN_W, bgTransform, drawCover, fitText, roundRect,
} from './student-card.util';

/**
 * The 'custom' POOL design — the academy prints its OWN artwork.
 *
 * The academy uploads both faces. The teacher's side is printed exactly as
 * uploaded and nothing is drawn on it. The students' side is their artwork plus
 * the only two things that cannot be baked into it, because they differ on every
 * single card in the batch: the card's own QR, and the serial printed under it.
 *
 * WHY THIS IS NOT JUST ANOTHER PALETTE: every other pool template composes the card
 * from shapes and type this code owns, so it can guarantee the result reads. Here
 * the card is a tenant's JPEG and we own two objects on top of it. That inverts the
 * job — the only things this file can promise are that the QR still scans and the
 * serial can still be read, and both of those need defending rather than designing.
 *
 * Coordinates are the full-bleed 1016 x 638 design space (bgTransform), NOT the
 * safe-inset content box the other faces use: a coordinate has to land on the same
 * spot of the tenant's image as it does on the card, or placing by eye would lie.
 * clampPoolArt keeps the QR's box out of the guillotine's margin regardless.
 */

/** Layout in force, clamped — the API stores whatever a client posted. */
function layoutOf(design: CardDesign): PoolArtLayout {
  return clampPoolArt(design.poolArt);
}

/**
 * Lay the artwork edge to edge.
 *
 * drawCover, not a stretch: an academy's artwork will not match 9 x 5.7 cm exactly,
 * and squashing someone's logo to fit is worse than trimming a few millimetres they
 * were going to lose to the guillotine anyway.
 *
 * Returns false when there is no artwork, so the caller can say so on the card
 * instead of exporting a thousand blank rectangles.
 */
function layArt(ctx: Ctx, art?: CanvasImageSource | null): boolean {
  bgTransform(ctx);
  // Square, like every other card face — see CARD_CORNER. It matters more here
  // than anywhere: this clip carries the tenant's OWN full-bleed artwork, and
  // rounding it quietly shaved the corners off an image they uploaded.
  roundRect(ctx, 0, 0, DESIGN_W, DESIGN_H, CARD_CORNER);
  ctx.clip();
  if (!art) {
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    return false;
  }
  drawCover(ctx, art, 0, 0, DESIGN_W, DESIGN_H);
  return true;
}

/**
 * Said on the card, not swallowed.
 *
 * A 'custom' design with no artwork uploaded is a real state — it is what every
 * academy sees the moment they pick this design — and a preview that goes blank
 * reads as a bug. The export refuses this case outright (see canExportCustom).
 */
function missingArt(ctx: Ctx, which: string): void {
  ctx.fillStyle = '#94a3b8';
  ctx.setLineDash([12, 10]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#94a3b8';
  roundRect(ctx, 30, 30, DESIGN_W - 60, DESIGN_H - 60, 18);
  ctx.stroke();
  ctx.setLineDash([]);
  fitText(ctx, which, DESIGN_W / 2, DESIGN_H / 2, DESIGN_W - 160, 30, 'bold', '#64748b', 'center', 'rtl');
}

/**
 * True when a 'custom' pool design is actually printable.
 *
 * Pool cards are front-only, so only the front artwork is required. A pool ZIP is
 * printed once, in bulk, by an outside printer — shipping it with a blank face is
 * not a thing anybody recovers from, so the export checks this rather than
 * rendering it anyway.
 */
export function canExportCustom(design: CardDesign): boolean {
  return !!(design.artFront || '').trim();
}

// ─────────────────────────────── FRONT ───────────────────────────────────────

/** The students' side: the academy's artwork, plus this card's QR and serial. */
export function drawCustomFront(
  ctx: Ctx,
  design: CardDesign,
  code: string,
  qr: CanvasImageSource,
  images: CardImages = {},
): void {
  const L = layoutOf(design);
  ctx.save();
  const has = layArt(ctx, images.artFront);
  if (!has) missingArt(ctx, 'ارفع تصميم وجه الطالب');

  // Still in bgTransform: the QR is placed against the ARTWORK, so it has to share
  // the artwork's coordinate space rather than the inset one the other faces use.
  const half = L.qrSize / 2;
  const x = L.qrX - half;
  const y = L.qrY - half;

  if (L.qrTile) {
    // The plate is deliberately BIGGER than the QR: the white margin around the
    // modules IS the quiet zone, and a QR flush to the edge of its own plate does
    // not reliably read off a printed card. 7% a side, as everywhere else here.
    const pad = Math.round(L.qrSize * 0.07);
    roundRect(ctx, x - pad, y - pad, L.qrSize + pad * 2, L.qrSize + pad * 2, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  ctx.drawImage(qr, x, y, L.qrSize, L.qrSize);

  // ---- the serial ----
  // Latin digits: force LTR whatever the page direction, or "A-100001" reorders.
  if (L.codeChip) {
    ctx.save();
    ctx.direction = 'ltr';
    ctx.font = `900 ${L.codeSize}px "Segoe UI", Tahoma, Arial, sans-serif`;
    const w = ctx.measureText(code || '—').width + L.codeSize * 1.6;
    const h = L.codeSize * 1.9;
    ctx.restore();
    roundRect(ctx, L.codeX - w / 2, L.codeY - h / 2, w, h, h / 2);
    // The chip is the inverse of the tenant's ink, so it always frames it.
    ctx.fillStyle = inkIsDark(L.codeColor) ? '#ffffff' : '#111827';
    ctx.fill();
  }

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '2px';
  ctx.font = `900 ${L.codeSize}px "Segoe UI", Tahoma, Arial, sans-serif`;
  ctx.fillStyle = L.codeColor;
  ctx.fillText(code || '—', L.codeX, L.codeY);
  ctx.restore();

  ctx.restore();
}

/** Rough lightness of the tenant's ink — only used to pick the chip behind it. */
function inkIsDark(hex: string): boolean {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return true;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) < 140;
}

// ─────────────────────────────── BACK ────────────────────────────────────────

/**
 * The teacher's side: the artwork, and nothing else.
 *
 * Not editable and nothing is drawn over it — every field the other pool backs
 * render (name, contacts, rules, slogan) is the academy's to put in their own
 * artwork here. Drawing them on top would fight the design they uploaded.
 */
export function drawCustomBack(ctx: Ctx, _design: CardDesign, images: CardImages = {}): void {
  ctx.save();
  const has = layArt(ctx, images.artBack);
  if (!has) missingArt(ctx, 'ارفع تصميم وجه المدرس');
  ctx.restore();
}
