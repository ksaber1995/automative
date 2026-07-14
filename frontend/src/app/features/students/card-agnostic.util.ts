import { CardDesign } from '@shared/interfaces/card-design.interface';
import {
  CardImages, Ctx, DESIGN_H, DESIGN_W, bgTransform, contentTransform, drawContain, drawCover, fitText, roundRect, wrap,
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
 * Four of them, deliberately different in structure — not a recolour of each other:
 *   aurora  dark indigo field, QR tile left, brand rail right
 *   ribbon  light page, diagonal corner ribbon, QR framed dead centre
 *   mono    black on white, oversized QR, nothing else
 *   wave    teal header curving over a white body, QR tile on the curve
 *
 * NOTE ON GRADIENTS: flat fills only, as everywhere else in the card code. A pool
 * export is a THOUSAND fronts; a dithered gradient turns a 15 KB PNG into ~350 KB
 * and the ZIP into 100 MB+. See the note in student-card.util.ts.
 */

export type AgnosticTemplate = 'aurora' | 'ribbon' | 'mono' | 'wave';

export const AGNOSTIC_TEMPLATES: AgnosticTemplate[] = ['aurora', 'ribbon', 'mono', 'wave'];
export const DEFAULT_AGNOSTIC: AgnosticTemplate = 'aurora';

interface Palette {
  /** Page/field colour of the front. */
  bg: string;
  /** Ink that reads on `bg`. */
  ink: string;
  sub: string;
  accent: string;
  /** Accent that stays legible as text on a light tile. */
  accentInk: string;
  /** Fill behind the QR — always near-white, or the scanner struggles. */
  tile: string;
  line: string;
  font: string;
  /** True when `bg` is dark, so shared bits flip their ink. */
  dark: boolean;
}

const SANS = '"Segoe UI", Tahoma, Arial, sans-serif';
const MONO = '"Consolas", "SF Mono", "Courier New", monospace';

const PALETTES: Record<AgnosticTemplate, Palette> = {
  aurora: {
    bg: '#171449', ink: '#ffffff', sub: '#b9b4e8', accent: '#a78bfa', accentInk: '#4c3ba8',
    tile: '#ffffff', line: '#332c72', font: SANS, dark: true,
  },
  ribbon: {
    bg: '#ffffff', ink: '#111827', sub: '#6b7280', accent: '#b91c1c', accentInk: '#b91c1c',
    tile: '#ffffff', line: '#e5e7eb', font: SANS, dark: false,
  },
  mono: {
    bg: '#ffffff', ink: '#000000', sub: '#8a8a8a', accent: '#000000', accentInk: '#000000',
    tile: '#ffffff', line: '#d4d4d4', font: SANS, dark: false,
  },
  wave: {
    bg: '#ffffff', ink: '#0f172a', sub: '#64748b', accent: '#0d9488', accentInk: '#0f766e',
    tile: '#ffffff', line: '#e2e8f0', font: SANS, dark: false,
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
  ctx.font = `bold ${Math.round(h * 0.52)}px ${mono ? MONO : p.font}`;
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
  ctx.font = `bold ${size}px ${p.font}`;
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** The academy's logo, or its initial in an accent disc when none is uploaded. */
function brandMark(ctx: Ctx, p: Palette, name: string, cx: number, cy: number, r: number, logo?: CanvasImageSource | null): void {
  if (logo) {
    drawContain(ctx, logo, cx, cy, r * 2, r * 2);
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = p.accent;
  ctx.fill();
  fitText(ctx, (name || '؟').trim().charAt(0), cx, cy, r * 1.4, Math.round(r * 1.1), 'bold', p.dark ? '#171449' : '#ffffff', 'center', 'rtl');
}

// ─────────────────────────────── FRONT ───────────────────────────────────────

export function drawAgnosticFront(
  ctx: Ctx,
  kind: AgnosticTemplate,
  d: AgnosticCardData,
  qr: CanvasImageSource,
  images: CardImages = {},
): void {
  const p = PALETTES[kind];
  ctx.save();
  field(ctx, p);

  // Background furniture is painted in the full-bleed space so it reaches the edge.
  if (kind === 'aurora') {
    // A single flat violet band down the left — the QR sits on it, so the code
    // reads against colour instead of floating in the dark.
    ctx.fillStyle = '#221c63';
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
  }

  contentTransform(ctx);

  if (kind === 'aurora') {
    // QR on the violet band; brand rail on the right. Both columns are centred in
    // the card's height — a card is looked at as a whole, and a stack that stops
    // two thirds down just reads as a printing error.
    qrTile(ctx, p, qr, 96, 138, 278, 16);
    serialChip(ctx, p, d.code, 235, 448, 278, 56, p.accent, '#1b1550');

    const R = 952;
    brandMark(ctx, p, d.companyName, R - 40, 104, 42, images.logo);
    fitText(ctx, d.companyName || '—', R - 104, 104, 400, 30, 'bold', p.ink, 'right', 'rtl');

    ctx.fillStyle = p.accent;
    ctx.fillRect(R - 120, 158, 120, 4);

    fitText(ctx, 'بطاقة الحضور', R, 250, 420, 44, 'bold', p.ink, 'right', 'rtl');
    caps(ctx, 'ATTENDANCE CARD', R, 300, 15, p.sub, p, 'right');

    const notes = ['امسح الرمز لتسجيل الحضور', 'البطاقة ملك للأكاديمية', 'رقم البطاقة مطبوع بالأسفل'];
    notes.forEach((n, i) => {
      const y = 386 + i * 46;
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(R - 6, y, 5, 0, Math.PI * 2);
      ctx.fill();
      fitText(ctx, n, R - 26, y, 420, 19, 'bold', p.sub, 'right', 'rtl');
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
    serialChip(ctx, p, d.code, qx + qs / 2, qy + qs + 34, qs + 24, 58, p.accent, '#ffffff');

    const L = 74;
    brandMark(ctx, p, d.companyName, L + 42, 190, 42, images.logo);
    fitText(ctx, d.companyName || '—', L, 268, 480, 32, 'bold', p.ink, 'left', 'rtl');
    ctx.fillStyle = p.accent;
    ctx.fillRect(L, 302, 140, 5);
    caps(ctx, 'ATTENDANCE CARD', L, 340, 14, p.sub, p, 'left');
    fitText(ctx, 'امسح الرمز لتسجيل الحضور', L, 396, 480, 21, 'bold', p.ink, 'left', 'rtl');
    fitText(ctx, 'هذه البطاقة ملك للأكاديمية', L, 434, 480, 16, 'bold', p.sub, 'left', 'rtl');
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
    fitText(ctx, d.companyName || '—', R, 176, 400, 32, 'bold', p.ink, 'right', 'rtl');
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(R - 120, 212);
    ctx.lineTo(R, 212);
    ctx.stroke();
    caps(ctx, 'ATTENDANCE CARD', R, 250, 13, p.sub, p, 'right');

    serialChip(ctx, p, d.code, R - 170, 300, 340, 62, '#000000', '#ffffff', true);

    fitText(ctx, 'امسح الرمز لتسجيل الحضور', R, 408, 400, 19, 'bold', p.ink, 'right', 'rtl');
    fitText(ctx, 'البطاقة ملك للأكاديمية', R, 444, 400, 15, 'bold', p.sub, 'right', 'rtl');
  } else {
    // wave — the QR straddles the curve, half on teal and half on white, which is
    // the whole idea of the template; the brand sits in the header above it.
    fitText(ctx, d.companyName || '—', 952, 74, 540, 30, 'bold', '#ffffff', 'right', 'rtl');
    caps(ctx, 'ATTENDANCE CARD', 952, 114, 13, 'rgba(255,255,255,0.85)', p, 'right');
    brandMark(ctx, p, d.companyName, 96, 88, 44, images.logo);

    const qs = 268, qx = 88, qy = 214;
    qrTile(ctx, p, qr, qx, qy, qs, 18);
    serialChip(ctx, p, d.code, qx + qs / 2, qy + qs + 30, qs, 56, p.accent, '#ffffff');

    // The right half carries the words, so the white body isn't half empty.
    const R = 952;
    fitText(ctx, 'امسح الرمز لتسجيل الحضور', R, 300, 480, 26, 'bold', p.ink, 'right', 'rtl');
    ctx.fillStyle = p.accent;
    ctx.fillRect(R - 110, 330, 110, 4);
    const notes = ['البطاقة ملك للأكاديمية', 'رقم البطاقة مطبوع بجانب الرمز', 'عند الفقد أبلغ الإدارة فوراً'];
    notes.forEach((n, i) => {
      const y = 396 + i * 44;
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(R - 6, y, 5, 0, Math.PI * 2);
      ctx.fill();
      fitText(ctx, n, R - 26, y, 460, 18, 'bold', p.sub, 'right', 'rtl');
    });
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
  const p = PALETTES[kind];
  ctx.save();
  field(ctx, p);

  if (kind === 'aurora') {
    ctx.fillStyle = '#221c63';
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
  } else {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, DESIGN_W, 8);
    ctx.fillRect(0, DESIGN_H - 8, DESIGN_W, 8);
  }

  contentTransform(ctx);

  // Two columns, and both are filled: the academy's media on the left, everything
  // it has to say on the right. An earlier cut put the rules in a foot strip and
  // left a dead hole through the middle of the card.
  const headInk = kind === 'wave' ? '#ffffff' : p.ink;
  const R = 952;   // right edge — the RTL start
  const L = 60;    // left column

  // ---- media column: the teacher's photo, and the academy's info QR ----
  const pw = 190, ph = 224;
  if (images.photo) {
    ctx.save();
    roundRect(ctx, L, 44, pw, ph, 16);
    ctx.strokeStyle = p.dark ? 'rgba(255,255,255,0.25)' : p.line;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.clip();
    drawCover(ctx, images.photo, L, 44, pw, ph);
    ctx.restore();
  } else {
    brandMark(ctx, p, design.teacherName || companyName, L + pw / 2, 150, 76, images.logo);
  }

  if (qr) {
    const qs = 190;
    qrTile(ctx, p, qr, L, 316, qs, 12);
    fitText(ctx, 'امسح للمزيد', L + qs / 2, 530, qs + 40, 16, 'bold', p.dark ? p.sub : p.accentInk, 'center', 'rtl');
  }

  // ---- the academy, right column ----
  fitText(ctx, design.teacherName || companyName || '—', R, 74, 600, 34, 'bold', headInk, 'right', 'rtl');
  if (design.teacherTitle) {
    fitText(ctx, design.teacherTitle, R, 118, 600, 20, 'bold',
      kind === 'wave' ? 'rgba(255,255,255,0.9)' : p.accentInk, 'right', 'rtl');
  }

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
    fitText(ctx, v!, R - 26, y, 560, 17, 'bold', p.dark ? p.sub : p.ink, 'right', latin ? 'ltr' : 'rtl');
  });

  // ---- rules, still in the right column, so the card reads as one block ----
  const rules = (design.instructions || []).filter((s) => !!s && s.trim()).slice(0, 3);
  if (rules.length) {
    ctx.strokeStyle = p.dark ? 'rgba(255,255,255,0.18)' : p.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(310, 356);
    ctx.lineTo(R, 356);
    ctx.stroke();

    let y = 392;
    rules.forEach((rule) => {
      const lines = wrap(ctx, rule, 600, 16, 'bold', 2);
      lines.forEach((line, li) => {
        if (li === 0) {
          ctx.fillStyle = p.accent;
          ctx.beginPath();
          ctx.arc(R - 6, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        fitText(ctx, line, R - 26, y, 600, 16, 'bold', p.sub, 'right', 'rtl');
        y += 24;
      });
      y += 8;
    });
  }

  // ---- slogan, along the foot of the right column ----
  if (design.slogan && design.slogan.trim()) {
    const lines = design.slogan.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);
    const top = 638 - 44 - (lines.length - 1) * 30;
    lines.forEach((line, i) => {
      fitText(ctx, line, R, top + i * 30, 620, 18, 'bold',
        p.dark ? p.ink : p.accentInk, 'right', 'rtl');
    });
  }

  ctx.restore();
  border(ctx, p);
}
