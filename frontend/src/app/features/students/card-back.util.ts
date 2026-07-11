import QRCode from 'qrcode';
import { CardDesign } from '@shared/interfaces/card-design.interface';
import {
  CARD_H, CARD_W, Ctx, FONT, GOLD, GOLD_L, NAVY, NAVY_D,
  fitText, goldGrad, roundRect,
} from './student-card.util';

/**
 * The BACK face of the student ID card — identical for every student, so it is
 * configured once per company (Settings > Card Design) and exported as a single
 * shared `card-back.png`.
 *
 * Same 1016x638 (8.6 x 5.4 cm @ 300dpi) canvas as the front. See the note on
 * gradients in student-card.util.ts: big fills are flat on purpose, because
 * dithered gradients triple the exported PNG size.
 */

const CREAM = '#f7f2e4';

type ContactIcon = 'phone' | 'whatsapp' | 'email' | 'pin';
type HighlightIcon = 'book' | 'clipboard' | 'checklist' | 'chart';

function contactIcon(ctx: Ctx, kind: ContactIcon, cx: number, cy: number): void {
  ctx.save();
  ctx.strokeStyle = NAVY_D;
  ctx.fillStyle = NAVY_D;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'phone') {
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 8);
    ctx.quadraticCurveTo(cx - 9, cy - 2, cx - 3, cy + 3);
    ctx.quadraticCurveTo(cx + 2, cy + 9, cx + 8, cy + 7);
    ctx.lineTo(cx + 8, cy + 2);
    ctx.lineTo(cx + 3, cy);
    ctx.lineTo(cx, cy + 3);
    ctx.quadraticCurveTo(cx - 3, cy, cx - 3, cy - 3);
    ctx.lineTo(cx - 1, cy - 6);
    ctx.lineTo(cx - 3, cy - 10);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'whatsapp') {
    // speech bubble + tail, with a small handset inside
    ctx.beginPath();
    ctx.arc(cx, cy - 1, 10, 0, Math.PI * 2);
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy + 11);
    ctx.lineTo(cx - 4, cy + 5);
    ctx.lineTo(cx - 8, cy + 9);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy - 1);
    ctx.scale(0.5, 0.5);
    ctx.beginPath();
    ctx.moveTo(-7, -8);
    ctx.quadraticCurveTo(-9, -2, -3, 3);
    ctx.quadraticCurveTo(2, 9, 8, 7);
    ctx.lineTo(8, 2);
    ctx.lineTo(3, 0);
    ctx.lineTo(0, 3);
    ctx.quadraticCurveTo(-3, 0, -3, -3);
    ctx.lineTo(-1, -6);
    ctx.lineTo(-3, -10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else if (kind === 'email') {
    roundRect(ctx, cx - 10, cy - 7, 20, 14, 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 6);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx + 10, cy - 6);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy - 3, 7, Math.PI, 0);
    ctx.bezierCurveTo(cx + 7, cy + 3, cx + 2, cy + 5, cx, cy + 11);
    ctx.bezierCurveTo(cx - 2, cy + 5, cx - 7, cy + 3, cx - 7, cy - 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = GOLD_L;
    ctx.beginPath();
    ctx.arc(cx, cy - 3, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function highlightIcon(ctx: Ctx, kind: HighlightIcon, cx: number, cy: number): void {
  ctx.save();
  const g = goldGrad(ctx, cx - 16, cy - 16, cx + 16, cy + 16);
  ctx.strokeStyle = g;
  ctx.fillStyle = g;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (kind === 'book') {
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy - 10);
    ctx.quadraticCurveTo(cx - 7, cy - 14, cx, cy - 9);
    ctx.lineTo(cx, cy + 11);
    ctx.quadraticCurveTo(cx - 7, cy + 6, cx - 14, cy + 10);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 14, cy - 10);
    ctx.quadraticCurveTo(cx + 7, cy - 14, cx, cy - 9);
    ctx.lineTo(cx, cy + 11);
    ctx.quadraticCurveTo(cx + 7, cy + 6, cx + 14, cy + 10);
    ctx.closePath();
    ctx.stroke();
  } else if (kind === 'clipboard') {
    roundRect(ctx, cx - 10, cy - 12, 20, 25, 3);
    ctx.stroke();
    roundRect(ctx, cx - 5, cy - 16, 10, 7, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 2); ctx.lineTo(cx + 5, cy - 2);
    ctx.moveTo(cx - 5, cy + 4); ctx.lineTo(cx + 5, cy + 4);
    ctx.moveTo(cx - 5, cy + 9); ctx.lineTo(cx + 1, cy + 9);
    ctx.stroke();
  } else if (kind === 'checklist') {
    roundRect(ctx, cx - 11, cy - 12, 22, 25, 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 5); ctx.lineTo(cx - 4, cy - 2); ctx.lineTo(cx + 2, cy - 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy + 6); ctx.lineTo(cx - 4, cy + 9); ctx.lineTo(cx + 2, cy + 3);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - 13, cy + 12); ctx.lineTo(cx + 13, cy + 12);
    ctx.stroke();
    ctx.fillRect(cx - 11, cy + 1, 5, 10);
    ctx.fillRect(cx - 3, cy - 5, 5, 16);
    ctx.fillRect(cx + 5, cy - 12, 5, 23);
  }
  ctx.restore();
}

/** Wrap `text` to at most `maxLines` lines that each fit `maxW`; returns the lines. */
function wrap(ctx: Ctx, text: string, maxW: number, size: number, weight: string, maxLines: number): string[] {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
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

function drawCardBack(ctx: Ctx, d: CardDesign, qr: CanvasImageSource | null): void {
  ctx.save();
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 30);
  ctx.clip();

  // Flat navy field + a faint lighter dot grid (integer-aligned; see gradient note).
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = '#1d2765';
  for (let y = 16; y < CARD_H; y += 16) {
    for (let x = 16; x < CARD_W; x += 16) ctx.fillRect(x, y, 2, 2);
  }

  // ================= teacher block (right) =================
  const tR = 936;            // right edge of the teacher column's text
  const iconR = 980;         // right edge of the contact icon chips

  // person glyph, to the right of the name
  ctx.save();
  ctx.fillStyle = goldGrad(ctx, 946, 40, 980, 84);
  ctx.beginPath();
  ctx.arc(963, 52, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(948, 76);
  ctx.bezierCurveTo(948, 62, 978, 62, 978, 76);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  fitText(ctx, d.teacherName || '—', tR, 60, 232, 32, 'bold', '#ffffff', 'right', 'rtl');

  if (d.teacherTitle) {
    fitText(ctx, d.teacherTitle, tR, 100, 210, 19, 'bold', GOLD_L, 'right', 'rtl');
    ctx.save();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(716, 100);
    ctx.lineTo(752, 100);
    ctx.stroke();
    ctx.restore();
  }

  const contacts = ([
    { icon: 'phone', value: d.phone },
    { icon: 'whatsapp', value: d.whatsapp },
    { icon: 'email', value: d.email },
    { icon: 'pin', value: d.location },
  ] as { icon: ContactIcon; value: string }[]).filter((c) => !!c.value);

  contacts.forEach((c, i) => {
    const cy = 152 + i * 46;
    roundRect(ctx, iconR - 34, cy - 17, 34, 34, 9);
    ctx.fillStyle = goldGrad(ctx, iconR - 34, cy - 17, iconR, cy + 17);
    ctx.fill();
    contactIcon(ctx, c.icon, iconR - 17, cy);
    // Phone numbers and emails are latin -> LTR, right-aligned against the chip.
    const isLatin = c.icon !== 'pin';
    fitText(ctx, c.value, tR, cy, 222, 18, 'bold', '#ffffff', 'right', isLatin ? 'ltr' : 'rtl');
  });

  // divider between the teacher column and the instructions
  ctx.save();
  ctx.strokeStyle = GOLD;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(700, 40);
  ctx.lineTo(700, 316);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // ================= instructions (middle) =================
  const insR = 652;   // right edge of instruction text
  const pillCx = 545;

  ctx.save();
  roundRect(ctx, pillCx - 100, 44, 200, 36, 18);
  ctx.fillStyle = goldGrad(ctx, pillCx - 100, 44, pillCx + 100, 80);
  ctx.fill();
  ctx.restore();
  fitText(ctx, 'تعليمات للطالب', pillCx + 62, 62, 130, 19, 'bold', NAVY_D, 'right', 'rtl');
  highlightIcon(ctx, 'clipboard', pillCx - 74, 62);

  ctx.save();
  ctx.strokeStyle = GOLD;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pillCx + 108, 62);
  ctx.lineTo(672, 62);
  ctx.moveTo(pillCx - 108, 62);
  ctx.lineTo(400, 62);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  const rules = d.instructions.filter((s) => !!s && s.trim()).slice(0, 5);
  rules.forEach((rule, i) => {
    const cy = 118 + i * 38;
    // gold check bubble
    ctx.fillStyle = goldGrad(ctx, insR + 6, cy - 11, insR + 28, cy + 11);
    ctx.beginPath();
    ctx.arc(insR + 17, cy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = NAVY_D;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(insR + 12, cy);
    ctx.lineTo(insR + 16, cy + 4);
    ctx.lineTo(insR + 23, cy - 4);
    ctx.stroke();
    ctx.restore();

    // The column runs from just right of the QR (ends at 250) to insR, so the
    // longest rule still renders near full size instead of shrinking to nothing.
    fitText(ctx, rule, insR - 6, cy, 348, 16, '600', '#ffffff', 'right', 'rtl');
  });

  // ================= info QR (left) =================
  if (qr) {
    const qx = 44, qy = 46, qs = 206;
    roundRect(ctx, qx, qy, qs, qs, 12);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = goldGrad(ctx, qx, qy, qx + qs, qy + qs);
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.drawImage(qr, qx + 12, qy + 12, qs - 24, qs - 24);

    const capTop = qy + qs + 12;
    roundRect(ctx, qx, capTop, qs, 58, 12);
    ctx.fillStyle = NAVY_D;
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    fitText(ctx, 'امسح الرمز', qx + qs - 14, capTop + 20, 130, 17, 'bold', GOLD_L, 'right', 'rtl');
    fitText(ctx, 'للاطلاع على المعلومات', qx + qs - 14, capTop + 41, 130, 13, '600', '#ffffff', 'right', 'rtl');

    // globe glyph
    ctx.save();
    ctx.strokeStyle = goldGrad(ctx, qx + 14, capTop + 12, qx + 52, capTop + 48);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(qx + 32, capTop + 29, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(qx + 32, capTop + 29, 6, 14, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(qx + 18, capTop + 29);
    ctx.lineTo(qx + 46, capTop + 29);
    ctx.stroke();
    ctx.restore();
  }

  // ================= bottom =================
  ctx.save();
  ctx.strokeStyle = GOLD;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(44, 350);
  ctx.lineTo(972, 350);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // slogan quote box (right)
  if (d.slogan && d.slogan.trim()) {
    const sx = 596, sy = 392, sw = 376, sh = 194;
    roundRect(ctx, sx, sy, sw, sh, 18);
    ctx.fillStyle = CREAM;
    ctx.fill();

    ctx.save();
    ctx.fillStyle = goldGrad(ctx, sx, sy, sx + sw, sy + sh);
    ctx.font = `bold 54px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillText('”', sx + sw - 46, sy + 6);
    ctx.fillText('“', sx + 18, sy + sh - 74);
    ctx.restore();

    const lines = d.slogan.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);
    const startY = sy + sh / 2 - (lines.length - 1) * 20;
    lines.forEach((line, i) => {
      // narrower than the box so a long line can't run under the quote glyphs
      fitText(ctx, line, sx + sw / 2, startY + i * 40, sw - 118, 23, 'bold', NAVY_D, 'center', 'rtl');
    });
  }

  // highlights (left) — RTL, so the first one sits rightmost
  const hi = d.highlights.filter((s) => !!s && s.trim()).slice(0, 4);
  const icons: HighlightIcon[] = ['book', 'clipboard', 'checklist', 'chart'];
  if (hi.length) {
    const zoneL = 48, zoneR = 566;
    const slot = (zoneR - zoneL) / hi.length;
    hi.forEach((label, i) => {
      const cx = zoneR - slot * (i + 0.5);   // index 0 -> rightmost
      highlightIcon(ctx, icons[i % icons.length], cx, 434);
      const lines = wrap(ctx, label, slot - 18, 15, 'bold', 2);
      lines.forEach((line, li) => {
        fitText(ctx, line, cx, 484 + li * 24, slot - 12, 15, 'bold', '#ffffff', 'center', 'rtl');
      });
      if (i < hi.length - 1) {
        ctx.save();
        ctx.strokeStyle = GOLD;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx - slot / 2, 410);
        ctx.lineTo(cx - slot / 2, 520);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  ctx.restore();
}

/**
 * Renders the shared back face. Returns raw base64 PNG (no data-URL prefix) so
 * it can go straight into JSZip; pass a canvas to reuse it across renders.
 */
export async function renderCardBackPng(design: CardDesign, canvas: HTMLCanvasElement): Promise<string> {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  let qr: HTMLImageElement | null = null;
  if (design.qrLink && design.qrLink.trim()) {
    const dataUrl = await QRCode.toDataURL(design.qrLink.trim(), { width: 500, margin: 0 });
    qr = new Image();
    qr.src = dataUrl;
    await qr.decode();
  }

  ctx.clearRect(0, 0, CARD_W, CARD_H);
  drawCardBack(ctx, design, qr);

  return canvas.toDataURL('image/png').split(',')[1];
}
