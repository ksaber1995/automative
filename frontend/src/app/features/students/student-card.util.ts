import { CardAdjust, CardFields, DEFAULT_CARD_ADJUST, clampAdjust, clampFields } from '@shared/interfaces/card-design.interface';
import { CardTheme, CARD_THEMES } from './card-theme';

/**
 * Renders the ORNATE front face of the printed student ID card (the
 * QR/attendance card) onto a canvas. Shared by the 'navy' and 'maroon'
 * templates, which differ only in palette and typeface — see card-theme.ts.
 * The flat 'minimal' template has its own renderer in card-minimal.util.ts.
 */
/**
 * The printed card is 9 × 5.7 cm at 300 dpi, with a 0.5 cm safe margin on every
 * side that no content may enter — a guillotined card loses a millimetre or two,
 * and a name or QR clipped off the edge makes the card useless.
 *
 * The artwork is authored in the ORIGINAL 1016 × 638 space (every coordinate below
 * is in it). Two transforms map that space onto the card canvas, so nothing had to
 * be re-measured by hand:
 *
 *   background → fills the whole card, bleeding off all four edges
 *   content    → fits inside the card minus the 0.5 cm safe margin
 *
 * So the panel and ribbons still run to the edge, while the text and QR are
 * guaranteed to sit inside the safe zone.
 */
const CM = 300 / 2.54;                       // px per cm at 300 dpi ≈ 118.11
export const CARD_W = Math.round(9 * CM);    // 1063 px = 9 cm
export const CARD_H = Math.round(5.7 * CM);  //  673 px = 5.7 cm
export const CARD_SAFE = Math.round(0.5 * CM); // 59 px = 0.5 cm

/** The space every drawing coordinate in these files is written in. */
export const DESIGN_W = 1016;
export const DESIGN_H = 638;

/** Map design space onto the full card — art bleeds off every edge. */
export function bgTransform(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(CARD_W / DESIGN_W, 0, 0, CARD_H / DESIGN_H, 0, 0);
}

/** Map design space inside the safe margin — no content can reach an edge. */
export function contentTransform(ctx: CanvasRenderingContext2D): void {
  const w = CARD_W - 2 * CARD_SAFE;
  const h = CARD_H - 2 * CARD_SAFE;
  ctx.setTransform(w / DESIGN_W, 0, 0, h / DESIGN_H, CARD_SAFE, CARD_SAFE);
}

/**
 * Palette for the draw currently in flight. Set once at the top of
 * drawStudentCard()/drawCardBack(); a draw is fully synchronous, so a
 * module-level binding cannot interleave between templates.
 */
export let T: CardTheme = CARD_THEMES.navy;
export function setCardTheme(theme: CardTheme): void {
  T = theme;
}

/**
 * The tenant's tuning for the draw currently in flight, on the same footing as `T`
 * and for the same reason: a draw is fully synchronous, so a module-level binding
 * cannot interleave between cards, and threading an extra argument through every
 * one of the ~15 draw functions would have touched every call site for nothing.
 *
 * Always CLAMPED on the way in — the API stores whatever a client posted, and an
 * un-clamped offset is how a logo ends up off the card or sitting on the QR's quiet
 * zone across a print run of a thousand.
 */
export let A: CardAdjust = { ...DEFAULT_CARD_ADJUST };
export function setCardAdjust(adj?: CardAdjust | null): void {
  A = clampAdjust(adj);
}

/**
 * Draw the academy's logo into the box a template reserved for it, honouring the
 * tenant's width and nudge.
 *
 * Every logo site goes through here so the three templates that show one can't
 * drift apart. drawContain keeps the aspect ratio, so `logoScale` grows the BOX and
 * the logo fills as much of it as its own shape allows — a wide logo and a square
 * one at 150% both stay themselves.
 */
export function drawLogo(ctx: Ctx, img: CanvasImageSource, cx: number, cy: number, maxW: number, maxH: number): void {
  const s = A.logoScale / 100;
  drawContain(ctx, img, cx + A.logoDx, cy + A.logoDy, maxW * s, maxH * s);
}

export interface StudentCardData {
  companyName: string;
  name: string;
  code: string;
  level: string;
  /** The student's school. Optional: the row is dropped when it is blank. */
  school?: string;
  group: string;
  year: string;
  subject: string;
  qrUrl: string;
  /**
   * Which rows this academy prints. renderStudentCardPng fills it in from the
   * saved design, so a caller building card data never has to; absent means
   * every row, which is what cards printed before the toggles existed.
   */
  fields?: CardFields;
}

export type Ctx = CanvasRenderingContext2D;
export type Align = 'right' | 'center' | 'left';
export type Dir = 'rtl' | 'ltr';

/**
 * The academic year the card is printed for, e.g. "2026 - 2027". One value for
 * every tenant — it is not per-company configurable.
 *
 * Rolls over in JULY, not September: cards are printed over the summer for the
 * year that is about to start, so a card made in July 2026 must read 2026 - 2027,
 * not the year that just ended.
 */
export function currentAcademicYear(now: Date = new Date()): string {
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start} - ${start + 1}`;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function goldGrad(ctx: Ctx, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, T.accentDeep);
  g.addColorStop(0.25, T.accent);
  g.addColorStop(0.5, T.accentLight);
  g.addColorStop(0.75, T.accent);
  g.addColorStop(1, T.accentDeep);
  return g;
}

/**
 * Every `bold` the card code asks for is drawn at 900 instead.
 *
 * These are printed at 300 dpi and then read off a small piece of card in a room
 * with whatever light it has. Plain `bold` came back thin and grey — legible on
 * screen at 4x, not on the card. 900 picks up the family's Black face where there
 * is one (Segoe UI Black) and is synthesised where there isn't; either way the
 * stroke gains weight, which is the whole point.
 *
 * Routed through here rather than changed at the ~60 call sites so the two faces,
 * the four student templates and the five pool templates cannot drift apart.
 */
export function cardWeight(weight: string): string {
  return weight === 'bold' ? '900' : weight;
}

/** Draw text, shrinking the font until it fits maxW — names and course titles vary wildly in length. */
export function fitText(
  ctx: Ctx, text: string, x: number, y: number, maxW: number,
  size: number, weight: string, color: string, align: Align, dir: Dir,
): void {
  const w = cardWeight(weight);
  ctx.save();
  ctx.direction = dir;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  let s = size;
  ctx.font = `${w} ${s}px ${T.font}`;
  while (s > 9 && ctx.measureText(text).width > maxW) {
    s -= 1;
    ctx.font = `${w} ${s}px ${T.font}`;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Wrap `text` to at most `maxLines` lines that each fit `maxW`; returns the lines. */
export function wrap(ctx: Ctx, text: string, maxW: number, size: number, weight: string, maxLines: number): string[] {
  ctx.save();
  // Must escalate exactly as fitText does — 900 is wider than bold, and measuring
  // the lighter weight would break them where the drawn text then overruns maxW.
  ctx.font = `${cardWeight(weight)} ${size}px ${T.font}`;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !line) {
      line = next;
    } else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  ctx.restore();
  return lines;
}

/**
 * Wrap `text` into at most `maxLines`, stepping the size DOWN from `size` (never
 * below `min`) until the WHOLE string fits. Returns the lines and the size they
 * must be drawn at.
 *
 * This is what tenant-entered text needs, and neither primitive above does it
 * alone. fitText squeezes a rule onto one line and hits its 9px floor — a thread
 * nobody can read off a printed card. wrap holds the size but silently drops the
 * words past `maxLines`, so an instruction loses its last clause and still looks
 * deliberate. Wrapping first and only then shrinking keeps the whole rule and
 * keeps it legible; `min` is the point below which we would rather it overflow
 * than pretend it is readable.
 */
export function wrapFit(
  ctx: Ctx, text: string, maxW: number, size: number, weight: string, maxLines: number, min: number,
): { lines: string[]; size: number } {
  for (let s = size; s > min; s--) {
    // maxLines + 1 so a text that needs one more line reports it instead of
    // coming back silently truncated at exactly maxLines.
    const lines = wrap(ctx, text, maxW, s, weight, maxLines + 1);
    if (lines.length <= maxLines) return { lines, size: s };
  }
  return { lines: wrap(ctx, text, maxW, min, weight, maxLines), size: min };
}

export function star(ctx: Ctx, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawPanel(ctx: Ctx): void {
  ctx.save();
  // Narrow the whole left panel: every x below is compressed toward the left edge,
  // so the coloured side is thinner (it carries no crest/photo any more).
  ctx.scale(0.78, 1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(320, 0);
  ctx.bezierCurveTo(292, 200, 300, 432, 260, DESIGN_H);
  ctx.lineTo(0, DESIGN_H);
  ctx.closePath();
  ctx.fillStyle = T.panel;
  ctx.fill();

  // Flat wedge instead of a gradient — see the note on gradients in drawStudentCard.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = T.panelDark;
  ctx.beginPath();
  ctx.moveTo(0, 300);
  ctx.lineTo(320, 140);
  ctx.lineTo(320, DESIGN_H);
  ctx.lineTo(0, DESIGN_H);
  ctx.closePath();
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(348, 0);
  ctx.bezierCurveTo(320, 200, 328, 432, 288, DESIGN_H);
  ctx.strokeStyle = goldGrad(ctx, 280, 0, 350, DESIGN_H);
  ctx.lineWidth = 10;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(364, 0);
  ctx.bezierCurveTo(336, 200, 344, 432, 304, DESIGN_H);
  ctx.strokeStyle = T.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.moveTo(-10, 498);
  ctx.bezierCurveTo(80, 556, 180, 588, 272, DESIGN_H - 4);
  ctx.strokeStyle = goldGrad(ctx, 0, 498, 272, DESIGN_H);
  ctx.lineWidth = 13;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-10, 544);
  ctx.bezierCurveTo(70, 590, 155, 613, 232, DESIGN_H);
  ctx.strokeStyle = T.accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Draw `img` to COVER the box: scaled to fill it and centre-cropped, never
 * squashed. A portrait photo in a landscape frame gets its sides trimmed rather
 * than the teacher's face stretched.
 */
export function drawCover(ctx: Ctx, img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || w;
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || h;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Draw `img` to FIT inside the box, whole and un-cropped — a logo must not lose its edges. */
export function drawContain(ctx: Ctx, img: CanvasImageSource, cx: number, cy: number, maxW: number, maxH: number): void {
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || maxW;
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || maxH;
  if (!iw || !ih) return;
  const scale = Math.min(maxW / iw, maxH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
}


type RowIcon = 'user' | 'id' | 'cap' | 'group' | 'cal';

function rowIcon(ctx: Ctx, kind: RowIcon, cx: number, cy: number): void {
  ctx.save();
  // Drawn larger than the original glyph metrics — scaled about the chip centre.
  const s = 1.3;
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  ctx.strokeStyle = T.onPanel;
  ctx.fillStyle = T.onPanel;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'user') {
    ctx.beginPath();
    ctx.arc(cx, cy - 6, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 11);
    ctx.bezierCurveTo(cx - 10, cy + 1, cx + 10, cy + 1, cx + 10, cy + 11);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'id') {
    ctx.font = `900 15px ${T.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'ltr';
    ctx.fillText('ID', cx, cy + 1);
  } else if (kind === 'cap') {
    ctx.beginPath();
    ctx.moveTo(cx - 13, cy - 3);
    ctx.lineTo(cx, cy - 10);
    ctx.lineTo(cx + 13, cy - 3);
    ctx.lineTo(cx, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy + 1);
    ctx.lineTo(cx - 7, cy + 9);
    ctx.quadraticCurveTo(cx, cy + 13, cx + 7, cy + 9);
    ctx.lineTo(cx + 7, cy + 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 13, cy - 3);
    ctx.lineTo(cx + 13, cy + 7);
    ctx.stroke();
  } else if (kind === 'group') {
    ctx.beginPath();
    ctx.arc(cx - 6, cy - 5, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 7, cy - 5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy + 9);
    ctx.bezierCurveTo(cx - 14, cy + 1, cx + 2, cy + 1, cx + 2, cy + 9);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy + 8);
    ctx.bezierCurveTo(cx + 1, cy + 2, cx + 14, cy + 2, cx + 14, cy + 8);
    ctx.closePath();
    ctx.fill();
  } else {
    roundRect(ctx, cx - 12, cy - 10, 24, 21, 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy - 3);
    ctx.lineTo(cx + 12, cy - 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 14);
    ctx.lineTo(cx - 6, cy - 8);
    ctx.moveTo(cx + 6, cy - 14);
    ctx.lineTo(cx + 6, cy - 8);
    ctx.stroke();
    ctx.fillRect(cx - 8, cy + 1, 4, 4);
    ctx.fillRect(cx - 1, cy + 1, 4, 4);
  }
  ctx.restore();
}

function footIcon(ctx: Ctx, kind: 'book' | 'target' | 'star', cx: number, cy: number): void {
  ctx.save();
  // Drawn larger than the original glyph metrics — scaled about the icon centre.
  const s = 1.25;
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  ctx.strokeStyle = goldGrad(ctx, cx - 16, cy - 16, cx + 16, cy + 16);
  ctx.fillStyle = goldGrad(ctx, cx - 16, cy - 16, cx + 16, cy + 16);
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (kind === 'book') {
    ctx.beginPath();
    ctx.moveTo(cx - 15, cy - 10);
    ctx.quadraticCurveTo(cx - 7, cy - 15, cx, cy - 9);
    ctx.lineTo(cx, cy + 12);
    ctx.quadraticCurveTo(cx - 7, cy + 6, cx - 15, cy + 11);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 15, cy - 10);
    ctx.quadraticCurveTo(cx + 7, cy - 15, cx, cy - 9);
    ctx.lineTo(cx, cy + 12);
    ctx.quadraticCurveTo(cx + 7, cy + 6, cx + 15, cy + 11);
    ctx.closePath();
    ctx.stroke();
  } else if (kind === 'target') {
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    star(ctx, cx, cy, 15);
  }
  ctx.restore();
}

/** The teacher's photo and academy logo, already decoded. Both optional. */
export interface CardImages {
  photo?: CanvasImageSource | null;
  logo?: CanvasImageSource | null;
  /**
   * The academy's own full-card artwork for the POOL cards ('custom' pool design).
   * Front = the students' side the QR and serial are placed on; back = the academy's
   * side, printed exactly as uploaded. Decoded here with photo/logo so a thousand-card
   * export decodes them once, not a thousand times.
   */
  artFront?: CanvasImageSource | null;
  artBack?: CanvasImageSource | null;
}

export function drawStudentCard(ctx: Ctx, data: StudentCardData, qr: CanvasImageSource, images: CardImages = {}): void {
  ctx.save();

  // ── Background: bleeds off all four edges ────────────────────────────────────
  bgTransform(ctx);
  roundRect(ctx, 0, 0, DESIGN_W, DESIGN_H, 30);
  ctx.clip();   // clipping is baked in device space, so it survives the transform swap below

  // NOTE ON GRADIENTS: large-area gradients are avoided throughout this card.
  // The browser dithers them to hide banding, and that noise is incompressible —
  // a gradient-filled navy panel alone took the exported PNG from 15 KB to 223 KB
  // (~350 KB/card, i.e. a 100 MB ZIP for a mid-size academy). Big shapes are flat
  // fills; goldGrad() is only used on thin strokes and small glyphs, where the
  // dithered area is negligible.
  ctx.fillStyle = T.page;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // Same reason: integer-aligned squares, not anti-aliased arcs.
  ctx.fillStyle = T.dot;
  for (let y = 14; y < DESIGN_H; y += 15) {
    for (let x = 380; x < DESIGN_W; x += 15) {
      ctx.fillRect(x, y, 2, 2);
    }
  }

  drawPanel(ctx);

  // ── Content: inside the 0.5 cm safe margin, so nothing can be cut off ────────
  contentTransform(ctx);

  // --- header ---
  const hcx = 626;
  if (data.companyName) {
    fitText(ctx, data.companyName, hcx, 46, 400, 19, 'bold', T.accent, 'center', 'rtl');
  }
  fitText(ctx, 'بطاقة تعريف الطالب', hcx, 88, 440, 40, 'bold', T.panel, 'center', 'rtl');

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '3px';
  ctx.font = `900 19px ${T.font}`;
  ctx.fillStyle = T.muted;
  ctx.fillText('STUDENT ID CARD', hcx, 124);
  const tw = ctx.measureText('STUDENT ID CARD').width;
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = goldGrad(ctx, hcx - 200, 0, hcx + 200, 0);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hcx - tw / 2 - 62, 124);
  ctx.lineTo(hcx - tw / 2 - 14, 124);
  ctx.moveTo(hcx + tw / 2 + 14, 124);
  ctx.lineTo(hcx + tw / 2 + 62, 124);
  ctx.stroke();
  ctx.restore();

  // --- info rows ---
  // The level row is dropped entirely when no level is set — a lone "—" on a
  // printed card reads as a mistake, so the row reflows away instead.
  // A row appears only if the academy asked for it AND the student has a value.
  // Both halves matter: the toggle decides what this academy prints at all, and
  // the value decides whether THIS card has anything to say — a lone "—" on a
  // printed card reads as a mistake, so an empty row reflows away instead.
  //
  // The code has no toggle on purpose: the card exists to be scanned, and its
  // number is the fallback when a camera will not read the QR.
  const f = clampFields(data.fields);
  const rows: { icon: RowIcon; label: string; value: string; dir: Dir; gold?: boolean }[] = [
    ...(f.studentName && data.name
      ? [{ icon: 'user' as RowIcon, label: 'اسم الطالب', value: data.name, dir: 'rtl' as Dir }] : []),
    { icon: 'id', label: 'كود الطالب', value: data.code, dir: 'ltr', gold: true },
    ...(data.level ? [{ icon: 'cap' as RowIcon, label: 'الصف الدراسي', value: data.level, dir: 'rtl' as Dir }] : []),
    ...(f.school && data.school
      ? [{ icon: 'cap' as RowIcon, label: 'المدرسة', value: data.school, dir: 'rtl' as Dir }] : []),
    ...(f.className && data.group
      ? [{ icon: 'group' as RowIcon, label: 'المجموعة', value: data.group, dir: 'rtl' as Dir }] : []),
    ...(f.year && data.year
      ? [{ icon: 'cal' as RowIcon, label: 'العام الدراسي', value: data.year, dir: 'ltr' as Dir }] : []),
  ];

  const rx = 300;      // left edge — clears the (now narrower) gold ribbon on the navy panel
  const chip = 46;
  const labelR = 766;
  // The label runs right-to-left from labelR and is capped at 124 wide, so it can
  // reach x=642. valueR must leave a real gutter before that: label and value are
  // now the same navy (see `muted` in card-theme.ts), and at 640 a long value like
  // "الثالث الثانوي" butted straight onto "الصف الدراسي" and read as one word. The
  // grey used to hide this; the gutter has to do it now.
  const valueR = 626;
  const valueMaxW = valueR - (rx + chip + 14);
  // The rows must end before the subject banner at y=544. Five fit at 66 (last
  // chip ends at 478); a sixth — level AND school both set — would end at 544,
  // exactly on the banner, so the block tightens instead of overrunning it. At
  // 59 the sixth chip ends at 506, and 46px of chip still clears a 59px row.
  const rowH = rows.length >= 6 ? 59 : 66;

  rows.forEach((row, i) => {
    const cy = 158 + rowH * i + rowH / 2;

    roundRect(ctx, rx, cy - chip / 2, chip, chip, 11);
    ctx.fillStyle = T.panel;
    ctx.fill();
    rowIcon(ctx, row.icon, rx + chip / 2, cy);

    fitText(ctx, row.label, labelR, cy, 124, 19, 'bold', T.muted, 'right', 'rtl');
    fitText(
      ctx,
      row.value || '—',
      row.dir === 'ltr' ? valueR - valueMaxW / 2 : valueR,
      cy,
      valueMaxW,
      23,
      'bold',
      row.gold ? T.accentInk : T.panel,
      row.dir === 'ltr' ? 'center' : 'right',
      row.dir,
    );

    if (i < rows.length - 1) {
      ctx.strokeStyle = T.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rx + chip + 14, cy + 33);
      ctx.lineTo(labelR, cy + 33);
      ctx.stroke();
    }
  });

  // --- subject banner (course name) ---
  // The banner lives in the white content column and must stay there: it is filled
  // with panelDark and drawn after drawPanel(), so any part of it that reaches left
  // of the gold ribbon paints ON TOP of the navy side panel and reads as a dark bar
  // bleeding out of it. BANNER_L therefore lines up with the icon-chip column above
  // (rx = 360) and never crosses the ribbon (which ends at ~364).
  // The whole banner goes when the course is switched off or the student has
  // none — an empty dark bar with a dash in it is worse than the space it fills.
  if (f.courseName && data.subject) {
    const BANNER_L = 300;      // lines up with the icon-chip column (rx), left of the narrowed panel's ribbon
    const BANNER_R = 762;      // right edge — still clears the footer icons at ~825
    const TEXT_R = BANNER_R - 46;
    const TEXT_L = 372;        // leaves a gap after the quill
    ctx.save();
    roundRect(ctx, BANNER_L, 544, BANNER_R - BANNER_L, 68, 16);
    ctx.fillStyle = T.panelDark;
    ctx.fill();
    ctx.restore();

    fitText(ctx, data.subject, TEXT_R, 579, TEXT_R - TEXT_L, 27, 'bold', T.accentOnPanel, 'right', 'rtl');

    ctx.save();
    ctx.strokeStyle = goldGrad(ctx, 310, 560, 354, 598);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(312, 596);
    ctx.quadraticCurveTo(332, 590, 352, 560);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(321, 593);
    ctx.quadraticCurveTo(341, 592, 350, 569);
    ctx.stroke();
    ctx.restore();
  }

  // --- QR ---
  // qx + qs must leave a real margin to the card edge (DESIGN_W): this is a printed
  // and guillotined card, so anything under ~2mm (24px) risks being cut into.
  const qx = 780, qy = 152, qs = 200;
  roundRect(ctx, qx, qy, qs, qs, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = goldGrad(ctx, qx, qy, qx + qs, qy + qs);
  ctx.lineWidth = 5;
  ctx.stroke();
  // Wider quiet zone around the QR — more white padding inside the frame.
  ctx.drawImage(qr, qx + 24, qy + 24, qs - 48, qs - 48);

  const capTop = qy + qs + 14;
  roundRect(ctx, qx, capTop, qs, 64, 12);
  ctx.fillStyle = T.panelDark;
  ctx.fill();
  ctx.strokeStyle = T.accent;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  fitText(ctx, 'امسح الرمز', qx + qs - 14, capTop + 22, 130, 18, 'bold', T.accentOnPanel, 'right', 'rtl');
  fitText(ctx, 'للحضور والانصراف', qx + qs - 14, capTop + 45, 130, 14, 'bold', T.onPanel, 'right', 'rtl');

  ctx.save();
  ctx.strokeStyle = goldGrad(ctx, qx + 14, capTop + 14, qx + 50, capTop + 50);
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  roundRect(ctx, qx + 18, capTop + 15, 24, 34, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(qx + 24, capTop + 24);
  ctx.lineTo(qx + 36, capTop + 24);
  ctx.moveTo(qx + 24, capTop + 32);
  ctx.lineTo(qx + 36, capTop + 32);
  ctx.moveTo(qx + 24, capTop + 40);
  ctx.lineTo(qx + 36, capTop + 40);
  ctx.stroke();
  ctx.restore();

  // --- footer values ---
  // Centred under the QR column (qx .. qx + qs).
  const feet: { icon: 'book' | 'target' | 'star'; label: string; cx: number }[] = [
    { icon: 'star', label: 'تميز', cx: 942 },
    { icon: 'target', label: 'تطور', cx: 880 },
    { icon: 'book', label: 'تعلم', cx: 818 },
  ];
  for (const f of feet) {
    footIcon(ctx, f.icon, f.cx, 544);
    fitText(ctx, f.label, f.cx, 588, 60, 17, 'bold', T.panel, 'center', 'rtl');
  }

  ctx.restore();
  // No outer edge frame — the card prints without a border.
}
