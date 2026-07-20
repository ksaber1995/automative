import { CardAdjust, CardDesign } from '@shared/interfaces/card-design.interface';
import { darken, isDark, lighten, mix, readableOn, tint } from './card-color.util';
import {
  A, CardImages, Ctx, DESIGN_H, DESIGN_W, bgTransform, contentTransform, drawContain, fitText, roundRect, wrap, wrapFit,
} from './student-card.util';

/**
 * AGNOSTIC cards — the pool templates.
 *
 * A pool card is printed BEFORE anybody owns it, so not one pixel of it may depend
 * on a student: no name, no level, no group, no year. Both faces talk about the
 * academy. The only per-card content is the QR (its own token) and the serial
 * printed beneath it — which is what the card is linked and typed by.
 *
 * That is the whole reason these are separate from the student templates: a
 * student template with the fields left blank prints as a card full of empty rules
 * and dashes. These are composed around the QR from the start.
 *
 * Five of them, deliberately different in structure — not a recolour of each other:
 *   aurora  dark indigo field, QR tile left, brand rail right
 *   ribbon  light page, diagonal corner ribbon, QR framed dead centre
 *   mono    black on white, oversized QR, nothing else
 *   wave    teal header curving over a white body, QR tile on the curve
 *   crest   maroon on cream, bound top/bottom, QR centred on a symmetric axis
 *
 * `crest` is the only one built on a CENTRED axis — the other four all split the
 * card left/right. That is what keeps it from reading as a recoloured ribbon.
 *
 * NOTE ON GRADIENTS: flat fills only, as everywhere else in the card code. A pool
 * export is a THOUSAND fronts; a dithered gradient turns a 15 KB PNG into ~350 KB
 * and the ZIP into 100 MB+. See the note in student-card.util.ts.
 */

/**
 * 'custom' is NOT rendered here — it is the academy's own artwork and lives in
 * card-custom.util.ts. It is in this union because it is a choice on the same
 * picker, and card-render.util.ts branches on it before reaching these draws.
 */
export type AgnosticTemplate = 'aurora' | 'ribbon' | 'mono' | 'wave' | 'crest' | 'custom';

/**
 * The pool designs offered in the picker. 'custom' is last on purpose — it is the
 * academy's own artwork rather than one of ours, and it is the only one that needs
 * uploads before it can print anything.
 */
export const AGNOSTIC_TEMPLATES: AgnosticTemplate[] = ['aurora', 'ribbon', 'mono', 'wave', 'crest', 'custom'];
export const DEFAULT_AGNOSTIC: AgnosticTemplate = 'aurora';

interface Palette {
  /** Page/field colour of the front. */
  bg: string;
  /** Ink that reads on `bg`. */
  ink: string;
  /**
   * Secondary type on `bg`. NEVER a grey and never faded toward the page: these
   * started as #6b7280/#64748b/#8a8a8a and printed as a smudge. Secondary type is
   * stepped down by SIZE alone, so `sub` is full-strength ink. Same rule as
   * `body`/`muted` in card-theme.ts.
   */
  sub: string;
  accent: string;
  /** Accent that stays legible as text on a light tile. */
  accentInk: string;
  /**
   * Ink guaranteed to read on `accent` — the serial chip, wave's header, the brand
   * disc. These were hard-coded ('#ffffff', '#1b1550', '#fbf4e6'), which is right
   * only while `accent` is the colour the designer picked. It is a tenant's now.
   */
  onAccent: string;
  /** aurora's lifted band. Derived from `bg` so it tracks a tenant's field colour. */
  band: string;
  /** Fill behind the QR — always near-white, or the scanner struggles. */
  tile: string;
  line: string;
  font: string;
  /** True when `bg` is dark, so shared bits flip their ink. */
  dark: boolean;
}

const SANS = '"Segoe UI", Tahoma, Arial, sans-serif';
const MONO = '"Consolas", "SF Mono", "Courier New", monospace';
// Arabic needs a face that actually has Arabic glyphs; the latin serif only takes
// effect for latin runs. Matches the ornate student templates' typeface.
const SERIF = '"Traditional Arabic", "Times New Roman", Georgia, serif';

/**
 * Fold a tenant's three chosen colours into the pool palette.
 *
 * `bg` here is literally the page/field — a pool card has one, unlike the student
 * cards where it means the panel (see tuneTheme). Everything downstream of it is
 * derived, and `dark` is RECOMPUTED rather than carried over: it is the flag every
 * shared bit reads to decide whether to use light or dark ink, so a tenant turning
 * aurora's indigo field cream while `dark` still said true would paint white text
 * onto a cream card.
 */
export function tunePalette(base: Palette, adj?: CardAdjust | null): Palette {
  if (!adj || (!adj.bg && !adj.text && !adj.accent)) return base;
  const p: Palette = { ...base };

  if (adj.bg) {
    p.bg = adj.bg;
    p.dark = isDark(adj.bg);
    // aurora's band is the field lifted a step, whichever direction that is.
    p.band = p.dark ? lighten(adj.bg, 0.08) : darken(adj.bg, 0.05);
    p.line = mix(adj.bg, p.dark ? '#ffffff' : '#000000', 0.14);
    // The ink only moves if the tenant did not pin it AND the old one stopped
    // reading — a hand-tuned template keeps its exact ink until the field breaks it.
    if (!adj.text) {
      p.ink = readableOn(adj.bg, base.ink);
      p.sub = readableOn(adj.bg, base.sub);
    }
  }

  if (adj.text) {
    p.ink = adj.text;
    p.sub = adj.text;
  }

  if (adj.accent) {
    p.accent = adj.accent;
    // accentInk is the accent used AS TEXT on the page, so it has to earn contrast.
    p.accentInk = tint(adj.accent, p.bg);
  }

  p.onAccent = readableOn(p.accent, base.onAccent);
  return p;
}

const PALETTES: Record<AgnosticTemplate, Palette> = {
  aurora: {
    bg: '#171449', ink: '#ffffff', sub: '#ffffff', accent: '#a78bfa', accentInk: '#4c3ba8',
    onAccent: '#1b1550', band: '#221c63',
    tile: '#ffffff', line: '#332c72', font: SANS, dark: true,
  },
  ribbon: {
    bg: '#ffffff', ink: '#111827', sub: '#111827', accent: '#b91c1c', accentInk: '#b91c1c',
    onAccent: '#ffffff', band: '#f3f4f6',
    tile: '#ffffff', line: '#e5e7eb', font: SANS, dark: false,
  },
  mono: {
    bg: '#ffffff', ink: '#000000', sub: '#000000', accent: '#000000', accentInk: '#000000',
    onAccent: '#ffffff', band: '#f5f5f5',
    tile: '#ffffff', line: '#d4d4d4', font: SANS, dark: false,
  },
  wave: {
    bg: '#ffffff', ink: '#0f172a', sub: '#0f172a', accent: '#0d9488', accentInk: '#0f766e',
    onAccent: '#ffffff', band: '#f1f5f9',
    tile: '#ffffff', line: '#e2e8f0', font: SANS, dark: false,
  },
  // 'custom' never reaches these draws (card-render.util.ts sends it to
  // card-custom.util.ts), but PALETTES is keyed by the whole union. Neutral values,
  // so that if a new caller ever does route it here the result is legible rather
  // than undefined-coloured.
  custom: {
    bg: '#ffffff', ink: '#111827', sub: '#111827', accent: '#111827', accentInk: '#111827',
    onAccent: '#ffffff', band: '#f1f5f9',
    tile: '#ffffff', line: '#e5e7eb', font: SANS, dark: false,
  },
  // Maroon on cream. `bg` is the cream page, `accent` the maroon it is bound and
  // ruled in — the inverse of aurora, where the field is the dark colour.
  crest: {
    bg: '#f7efdf', ink: '#4d1620', sub: '#4d1620', accent: '#7b1e2b', accentInk: '#7b1e2b',
    onAccent: '#fbf4e6', band: '#efe3cd',
    tile: '#ffffff', line: '#e0cdae', font: SERIF, dark: false,
  },
};

/** What a pool card actually knows: the academy it belongs to, its own QR, its serial. */
export interface AgnosticCardData {
  companyName: string;
  /** The printed serial, e.g. "A-100001". Never a student code. */
  code: string;
  qrUrl: string;
}

// ─────────────────────────── shared bits ─────────────────────────────────────

/** Clip to the card's rounded edge and lay the background. Callers then inset. */
function field(ctx: Ctx, p: Palette): void {
  bgTransform(ctx);
  roundRect(ctx, 0, 0, DESIGN_W, DESIGN_H, 26);
  ctx.clip();
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
}

/** The hairline edge, traced on the card's real border after the content restore. */
function border(ctx: Ctx, p: Palette): void {
  ctx.save();
  bgTransform(ctx);
  roundRect(ctx, 1, 1, DESIGN_W - 2, DESIGN_H - 2, 26);
  ctx.strokeStyle = p.dark ? p.line : p.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/**
 * The QR, on a white tile. Always white behind it and always quiet-zone padded —
 * a scanner reading a phone-camera photo of a printed card has little margin.
 */
function qrTile(ctx: Ctx, p: Palette, qr: CanvasImageSource, x: number, y: number, size: number, radius = 14): void {
  roundRect(ctx, x, y, size, size, radius);
  ctx.fillStyle = p.tile;
  ctx.fill();
  ctx.strokeStyle = p.dark ? 'rgba(255,255,255,0.18)' : p.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  const pad = Math.round(size * 0.07);
  ctx.drawImage(qr, x + pad, y + pad, size - pad * 2, size - pad * 2);
}

/** The serial, in a chip. Latin digits, so force LTR whatever the page direction. */
function serialChip(
  ctx: Ctx, p: Palette, code: string, cx: number, y: number, w: number, h: number,
  fill: string, ink: string, mono = false,
): void {
  roundRect(ctx, cx - w / 2, y, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '2px';
  ctx.font = `900 ${Math.round(h * 0.52)}px ${mono ? MONO : p.font}`;
  ctx.fillStyle = ink;
  ctx.fillText(code || '—', cx, y + h / 2 + 1);
  ctx.restore();
}

/** Small caps label. */
function caps(ctx: Ctx, text: string, x: number, y: number, size: number, colour: string, p: Palette, align: CanvasTextAlign = 'left'): void {
  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '3px';
  ctx.font = `900 ${size}px ${p.font}`;
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** The academy's initial in an accent disc — the brand mark on pool cards. */
function brandMark(ctx: Ctx, p: Palette, name: string, cx: number, cy: number, r: number): void {
  const s = A.logoScale / 100;
  const dx = cx + A.logoDx;
  const dy = cy + A.logoDy;
  ctx.beginPath();
  ctx.arc(dx, dy, r * s, 0, Math.PI * 2);
  ctx.fillStyle = p.accent;
  ctx.fill();
  fitText(ctx, (name || '؟').trim().charAt(0), dx, dy, r * 1.4 * s, Math.round(r * 1.1 * s), 'bold', p.onAccent, 'center', 'rtl');
}

// ─────────────────────────────── FRONT ───────────────────────────────────────

export function drawAgnosticFront(
  ctx: Ctx,
  kind: AgnosticTemplate,
  d: AgnosticCardData,
  qr: CanvasImageSource,
  images: CardImages = {},
): void {
  const p = tunePalette(PALETTES[kind], A);
  ctx.save();
  field(ctx, p);

  // Background furniture is painted in the full-bleed space so it reaches the edge.
  if (kind === 'aurora') {
    // A single flat violet band down the left — the QR sits on it, so the code
    // reads against colour instead of floating in the dark.
    ctx.fillStyle = p.band;
    ctx.fillRect(0, 0, 470, DESIGN_H);
    ctx.fillStyle = p.accent;
    ctx.fillRect(466, 0, 5, DESIGN_H);
  } else if (kind === 'ribbon') {
    // Diagonal corner ribbon, top-right (the RTL "start" corner).
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(DESIGN_W - 330, 0);
    ctx.lineTo(DESIGN_W, 0);
    ctx.lineTo(DESIGN_W, 330);
    ctx.closePath();
    ctx.fillStyle = p.accent;
    ctx.fill();
    ctx.restore();
    // and a thin foot rule
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, DESIGN_H - 14, DESIGN_W, 14);
  } else if (kind === 'wave') {
    // Teal header whose bottom edge curves — a flat fill bounded by a bezier.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(DESIGN_W, 0);
    ctx.lineTo(DESIGN_W, 196);
    ctx.bezierCurveTo(DESIGN_W * 0.72, 300, DESIGN_W * 0.28, 92, 0, 214);
    ctx.closePath();
    ctx.fillStyle = p.accent;
    ctx.fill();
  } else if (kind === 'crest') {
    // Bound top and bottom in maroon, like the head and tail of a ledger. Runs
    // full-bleed, so the cream page reads as inlaid between two solid edges.
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, 0, DESIGN_W, 30);
    ctx.fillRect(0, DESIGN_H - 30, DESIGN_W, 30);
    // A cream hairline inside each band lifts it off the page edge.
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 34, DESIGN_W, 3);
    ctx.fillRect(0, DESIGN_H - 37, DESIGN_W, 3);
  }

  contentTransform(ctx);

  if (kind === 'aurora') {
    // QR on the violet band; brand rail on the right. Both columns are centred in
    // the card's height — a card is looked at as a whole, and a stack that stops
    // two thirds down just reads as a printing error.
    qrTile(ctx, p, qr, 96, 138, 278, 16);
    serialChip(ctx, p, d.code, 235, 448, 278, 56, p.accent, p.onAccent);

    const R = 952;
    brandMark(ctx, p, d.companyName, R - 40, 104, 42);
    fitText(ctx, d.companyName || '—', R - 104, 104, 400, 32, 'bold', p.ink, 'right', 'rtl');

    ctx.fillStyle = p.accent;
    ctx.fillRect(R - 120, 158, 120, 4);

    fitText(ctx, 'بطاقة الحضور', R, 250, 420, 46, 'bold', p.ink, 'right', 'rtl');
    caps(ctx, 'ATTENDANCE CARD', R, 302, 17, p.sub, p, 'right');

    const notes = ['امسح الرمز لتسجيل الحضور', 'البطاقة ملك للأكاديمية', 'رقم البطاقة مطبوع بالأسفل'];
    notes.forEach((n, i) => {
      const y = 386 + i * 46;
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(R - 6, y, 5, 0, Math.PI * 2);
      ctx.fill();
      fitText(ctx, n, R - 28, y, 420, 21, 'bold', p.sub, 'right', 'rtl');
    });
  } else if (kind === 'ribbon') {
    // The mirror of aurora, in daylight: QR framed on the RIGHT under the ribbon,
    // the academy's identity filling the left. Splitting it left/right is what
    // stops a light card from turning into a thin column floating in white.
    const qs = 286, qx = 640, qy = 176;
    qrTile(ctx, p, qr, qx, qy, qs, 12);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 4;
    roundRect(ctx, qx - 12, qy - 12, qs + 24, qs + 24, 18);
    ctx.stroke();
    serialChip(ctx, p, d.code, qx + qs / 2, qy + qs + 34, qs + 24, 58, p.accent, p.onAccent);

    const L = 74;
    brandMark(ctx, p, d.companyName, L + 42, 190, 42);
    fitText(ctx, d.companyName || '—', L, 268, 480, 38, 'bold', p.ink, 'left', 'rtl');
    ctx.fillStyle = p.accent;
    ctx.fillRect(L, 302, 140, 5);
    caps(ctx, 'ATTENDANCE CARD', L, 342, 19, p.accentInk, p, 'left');
    fitText(ctx, 'امسح الرمز لتسجيل الحضور', L, 400, 480, 28, 'bold', p.ink, 'left', 'rtl');
    fitText(ctx, 'هذه البطاقة ملك للأكاديمية', L, 444, 480, 22, 'bold', p.sub, 'left', 'rtl');
  } else if (kind === 'mono') {
    // Austere: an oversized QR and nothing but type. Set as a two-column spread so
    // the emptiness reads as deliberate space, not as a card that failed to print.
    const size = 356;
    const qx = 84, qy = (DESIGN_H - size) / 2;
    qrTile(ctx, p, qr, qx, qy, size, 0);
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 4;
    ctx.strokeRect(qx - 14, qy - 14, size + 28, size + 28);

    const R = 946;
    fitText(ctx, d.companyName || '—', R, 176, 400, 38, 'bold', p.ink, 'right', 'rtl');
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(R - 120, 212);
    ctx.lineTo(R, 212);
    ctx.stroke();
    caps(ctx, 'ATTENDANCE CARD', R, 252, 18, p.ink, p, 'right');

    serialChip(ctx, p, d.code, R - 170, 300, 340, 62, p.accent, p.onAccent, true);

    fitText(ctx, 'امسح الرمز لتسجيل الحضور', R, 410, 400, 27, 'bold', p.ink, 'right', 'rtl');
    fitText(ctx, 'البطاقة ملك للأكاديمية', R, 454, 400, 22, 'bold', p.sub, 'right', 'rtl');
  } else if (kind === 'wave') {
    // wave — the QR straddles the curve, half on teal and half on white, which is
    // the whole idea of the template; the brand sits in the header above it.
    fitText(ctx, d.companyName || '—', 952, 72, 540, 36, 'bold', p.onAccent, 'right', 'rtl');
    caps(ctx, 'ATTENDANCE CARD', 952, 118, 18, p.onAccent, p, 'right');
    brandMark(ctx, p, d.companyName, 96, 88, 44);

    const qs = 268, qx = 88, qy = 214;
    qrTile(ctx, p, qr, qx, qy, qs, 18);
    serialChip(ctx, p, d.code, qx + qs / 2, qy + qs + 30, qs, 56, p.accent, p.onAccent);

    // The right half carries the words, so the white body isn't half empty.
    const R = 952;
    fitText(ctx, 'امسح الرمز لتسجيل الحضور', R, 300, 480, 32, 'bold', p.ink, 'right', 'rtl');
    ctx.fillStyle = p.accent;
    ctx.fillRect(R - 110, 332, 110, 4);
    const notes = ['البطاقة ملك للأكاديمية', 'رقم البطاقة مطبوع بجانب الرمز', 'عند الفقد أبلغ الإدارة فوراً'];
    notes.forEach((n, i) => {
      const y = 396 + i * 46;
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(R - 7, y, 5, 0, Math.PI * 2);
      ctx.fill();
      fitText(ctx, n, R - 28, y, 460, 24, 'bold', p.ink, 'right', 'rtl');
    });
  } else {
    // crest — everything hangs off the card's vertical centreline: brand, QR,
    // serial, title. The flanks are held by symmetric rules rather than a second
    // column, which is what keeps a centred card from looking half-printed.
    const CX = DESIGN_W / 2;

    brandMark(ctx, p, d.companyName, CX, 72, 38);
    fitText(ctx, d.companyName || '—', CX, 138, 620, 34, 'bold', p.ink, 'center', 'rtl');

    const qs = 256, qx = CX - qs / 2, qy = 182;
    qrTile(ctx, p, qr, qx, qy, qs, 10);
    // Double frame — a wide maroon rule with a hairline inside it.
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 4;
    roundRect(ctx, qx - 13, qy - 13, qs + 26, qs + 26, 14);
    ctx.stroke();
    ctx.lineWidth = 1;
    roundRect(ctx, qx - 22, qy - 22, qs + 44, qs + 44, 18);
    ctx.stroke();

    // Flanking rules, each ending in a small diamond that points at the QR.
    [-1, 1].forEach((dir) => {
      const near = CX + dir * (qs / 2 + 46);
      const far = CX + dir * (DESIGN_W / 2 - 64);
      const y = qy + qs / 2;
      // A tanned rule, not `line` — the pale hairline read as a printing slip
      // against cream rather than as ornament.
      ctx.strokeStyle = '#c9ab82';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(near, y);
      ctx.lineTo(far, y);
      ctx.stroke();
      ctx.save();
      ctx.translate(near - dir * 14, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = p.accent;
      ctx.fillRect(-6, -6, 12, 12);
      ctx.restore();
    });

    // Clears the QR's outer frame (which ends at qy + qs + 22) before the chip starts.
    serialChip(ctx, p, d.code, CX, qy + qs + 36, 300, 54, p.accent, p.onAccent);

    fitText(ctx, 'بطاقة الحضور', CX, 564, 520, 36, 'bold', p.ink, 'center', 'rtl');
    // The weakest type on any pool card: a 12px letterspaced serif in `sub` tan on
    // cream all but vanished off the press. Sized up and moved onto `accent`, which
    // is the maroon the card is already bound in.
    caps(ctx, 'ATTENDANCE CARD', CX, 602, 18, p.accentInk, p, 'center');
  }

  ctx.restore();
  border(ctx, p);
}

// ─────────────────────────────── BACK ────────────────────────────────────────

/**
 * The academy's face. Same for every card in the batch, so it ships once in the
 * ZIP — and it can afford the teacher's photo without bloating the export.
 */
export function drawAgnosticBack(
  ctx: Ctx,
  kind: AgnosticTemplate,
  design: CardDesign,
  companyName: string,
  qr: CanvasImageSource | null,
  images: CardImages = {},
): void {
  const p = tunePalette(PALETTES[kind], A);
  ctx.save();
  field(ctx, p);

  if (kind === 'aurora') {
    ctx.fillStyle = p.band;
    ctx.fillRect(0, 0, 300, DESIGN_H);
    ctx.fillStyle = p.accent;
    ctx.fillRect(300, 0, 5, DESIGN_H);
  } else if (kind === 'ribbon') {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(330, 0);
    ctx.lineTo(0, 330);
    ctx.closePath();
    ctx.fillStyle = p.accent;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, DESIGN_H - 14, DESIGN_W, 14);
  } else if (kind === 'wave') {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(DESIGN_W, 0);
    ctx.lineTo(DESIGN_W, 150);
    ctx.bezierCurveTo(DESIGN_W * 0.7, 250, DESIGN_W * 0.3, 60, 0, 170);
    ctx.closePath();
    ctx.fillStyle = p.accent;
    ctx.fill();
  } else if (kind === 'crest') {
    // Same binding as the front, so a printed pair reads as one card.
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, 0, DESIGN_W, 30);
    ctx.fillRect(0, DESIGN_H - 30, DESIGN_W, 30);
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 34, DESIGN_W, 3);
    ctx.fillRect(0, DESIGN_H - 37, DESIGN_W, 3);
  } else {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, DESIGN_W, 8);
    ctx.fillRect(0, DESIGN_H - 8, DESIGN_W, 8);
  }

  contentTransform(ctx);

  // Two columns, and both are filled: the academy's media on the left, everything
  // it has to say on the right. An earlier cut put the rules in a foot strip and
  // left a dead hole through the middle of the card.
  const headInk = kind === 'wave' ? p.onAccent : p.ink;
  const R = 952;   // right edge — the RTL start
  const L = 60;    // left column

  // ---- media column: the academy's brand mark, and its info QR ----
  const pw = 190;
  brandMark(ctx, p, companyName, L + pw / 2, 150, 76);

  if (qr) {
    const qs = 190;
    qrTile(ctx, p, qr, L, 316, qs, 12);
    fitText(ctx, 'امسح للمزيد', L + qs / 2, 532, qs + 40, 21, 'bold', p.dark ? p.sub : p.accentInk, 'center', 'rtl');
  }

  // ---- the academy, right column ----
  fitText(ctx, companyName || '—', R, 72, 600, 36, 'bold', headInk, 'right', 'rtl');

  const contacts = [design.phone, design.whatsapp, design.email, design.location]
    .filter((v) => !!v && v.trim()).slice(0, 4);
  contacts.forEach((v, i) => {
    const y = 178 + i * 38;
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(R - 6, y, 5, 0, Math.PI * 2);
    ctx.fill();
    // A phone number or an email is latin: force LTR or the digits reorder.
    const latin = /^[+\d\s()-]+$/.test(v!) || v!.includes('@');
    fitText(ctx, v!, R - 28, y, 560, 22, 'bold', p.dark ? p.sub : p.ink, 'right', latin ? 'ltr' : 'rtl');
  });

  // ---- rules, still in the right column, so the card reads as one block ----
  const rules = (design.instructions || []).filter((s) => !!s && s.trim()).slice(0, 3);
  if (rules.length) {
    ctx.strokeStyle = p.dark ? 'rgba(255,255,255,0.18)' : p.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(310, 348);
    ctx.lineTo(R, 348);
    ctx.stroke();

    // This block and the slogan under it are what bound the whole back face. The
    // worst case a tenant can enter — three rules that EACH wrap to two lines — puts
    // the last line at y=530 with 19/26; the slogan then opens at 566. Growing the
    // size or the leading past this, or starting lower than 384, collides the two.
    let y = 384;
    rules.forEach((rule) => {
      const { lines, size } = wrapFit(ctx, rule, 600, 19, 'bold', 2, 14);
      lines.forEach((line, li) => {
        if (li === 0) {
          ctx.fillStyle = p.accent;
          ctx.beginPath();
          ctx.arc(R - 7, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        fitText(ctx, line, R - 28, y, 600, size, 'bold', p.dark ? p.sub : p.ink, 'right', 'rtl');
        y += 26;
      });
      y += 8;
    });
  }

  // ---- slogan, along the foot of the right column ----
  if (design.slogan && design.slogan.trim()) {
    const lines = design.slogan.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);
    const top = 638 - 40 - (lines.length - 1) * 32;
    lines.forEach((line, i) => {
      fitText(ctx, line, R, top + i * 32, 620, 23, 'bold',
        p.dark ? p.ink : p.accentInk, 'right', 'rtl');
    });
  }

  ctx.restore();
  border(ctx, p);
}
