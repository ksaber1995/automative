import { CardDesign } from '@shared/interfaces/card-design.interface';
import {
  A, CardImages, Ctx, DESIGN_H, DESIGN_W, StudentCardData, T, bgTransform, contentTransform, drawCover,
  drawLogo, fitText, roundRect, wrap,
} from './student-card.util';

/**
 * The 'portrait' template — both faces.
 *
 * The one thing that makes it different: the teacher's PHOTO and LOGO live on the
 * BACK, the side that is already about the teacher. The student's side is then
 * free of them, so the QR and the student's own details get the whole card
 * instead of sharing it with someone else's face.
 *
 * Deep forest + soft gold, flat fills only (see the gradient note in
 * student-card.util.ts — big gradients bloat the exported PNG).
 */

/** Small stroked glyphs. Kept local: the ornate/minimal icon sets aren't exported. */
type Glyph = 'phone' | 'whatsapp' | 'mail' | 'pin';

function glyph(ctx: Ctx, kind: Glyph, cx: number, cy: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'phone') {
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 9);
    ctx.quadraticCurveTo(cx - 9, cy - 2, cx - 2, cy + 4);
    ctx.quadraticCurveTo(cx + 4, cy + 10, cx + 9, cy + 7);
    ctx.lineTo(cx + 9, cy + 2);
    ctx.lineTo(cx + 3, cy);
    ctx.lineTo(cx, cy + 3);
    ctx.quadraticCurveTo(cx - 4, cy, cx - 4, cy - 4);
    ctx.lineTo(cx - 1, cy - 7);
    ctx.lineTo(cx - 3, cy - 11);
    ctx.closePath();
    ctx.stroke();
  } else if (kind === 'whatsapp') {
    ctx.beginPath();
    ctx.arc(cx, cy - 1, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 11);
    ctx.lineTo(cx - 3, cy + 5);
    ctx.lineTo(cx - 7, cy + 9);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy - 1, 3.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'mail') {
    roundRect(ctx, cx - 10, cy - 7, 20, 15, 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 6);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx + 10, cy - 6);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy - 3, 6.5, Math.PI, 0);
    ctx.bezierCurveTo(cx + 6.5, cy + 3, cx + 2, cy + 5, cx, cy + 11);
    ctx.bezierCurveTo(cx - 2, cy + 5, cx - 6.5, cy + 3, cx - 6.5, cy - 3);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - 3, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A tick in a soft disc — used down the instructions list. */
function tick(ctx: Ctx, cx: number, cy: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.fillStyle = T.accent;
  ctx.fill();
  ctx.strokeStyle = T.panelDark;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy);
  ctx.lineTo(cx - 1, cy + 3.5);
  ctx.lineTo(cx + 4.5, cy - 3.5);
  ctx.stroke();
  ctx.restore();
}

// ─────────────────────────────── FRONT (student) ─────────────────────────────
// No photo, no crest — the teacher's face is on the other side. That buys a wider
// details column and a bigger, easier-to-scan QR.

export function drawStudentCardPortrait(ctx: Ctx, d: StudentCardData, qr: CanvasImageSource): void {
  ctx.save();

  // ── Background: bleeds off every edge ──
  bgTransform(ctx);
  roundRect(ctx, 0, 0, DESIGN_W, DESIGN_H, 28);
  ctx.clip();

  ctx.fillStyle = T.page;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // A deep band down the binding edge, and a thin gold rule beside it.
  ctx.fillStyle = T.panel;
  ctx.fillRect(0, 0, 30, DESIGN_H);
  ctx.fillStyle = T.accent;
  ctx.fillRect(30, 0, 5, DESIGN_H);

  // Faint dot texture, integer-aligned (anti-aliased arcs would bloat the PNG).
  ctx.fillStyle = T.dot;
  for (let y = 16; y < DESIGN_H; y += 16) {
    for (let x = 48; x < DESIGN_W; x += 16) ctx.fillRect(x, y, 2, 2);
  }

  // ── Content: inside the 0.5 cm safe margin ──
  contentTransform(ctx);

  // Header
  const hR = 968;   // right edge of the RTL header column
  if (d.companyName) {
    fitText(ctx, d.companyName, hR, 52, 460, 20, 'bold', T.accentInk, 'right', 'rtl');
  }
  fitText(ctx, 'بطاقة تعريف الطالب', hR, 96, 520, 36, 'bold', T.ink, 'right', 'rtl');

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '4px';
  ctx.font = `900 15px ${T.font}`;
  ctx.fillStyle = T.muted;
  ctx.fillText('STUDENT ID CARD', hR, 128);
  ctx.restore();

  ctx.strokeStyle = T.accent;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hR - 150, 150);
  ctx.lineTo(hR, 150);
  ctx.stroke();

  // ── Details: label above value, hairline rule under each ──
  const rows: { label: string; value: string; dir: 'rtl' | 'ltr' }[] = [
    { label: 'اسم الطالب', value: d.name, dir: 'rtl' },
    { label: 'الصف الدراسي', value: d.level, dir: 'rtl' },
    { label: 'المجموعة', value: d.group, dir: 'rtl' },
    { label: 'العام الدراسي', value: d.year, dir: 'ltr' },
  ];
  // RTL: the details sit under the header on the RIGHT; the QR takes the left.
  const rR = 968;   // right edge of the details column
  const rL = 430;   // left edge — the QR lives to the left of this
  const top = 200;
  const rowH = 74;

  rows.forEach((row, i) => {
    const y = top + i * rowH;
    fitText(ctx, row.label, rR, y, rR - rL, 16, 'bold', T.muted, 'right', 'rtl');
    fitText(ctx, row.value || '—', rR, y + 28, rR - rL, 24, 'bold', T.ink, 'right', row.dir);
    ctx.strokeStyle = T.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rL, y + 48);
    ctx.lineTo(rR, y + 48);
    ctx.stroke();
  });

  // Student code — a solid chip on the right, the one thing staff read out loud
  roundRect(ctx, rR - 200, 494, 200, 54, 12);
  ctx.fillStyle = T.panel;
  ctx.fill();
  fitText(ctx, d.code || '—', rR - 100, 522, 170, 24, 'bold', T.accentOnPanel, 'center', 'ltr');

  // Subject pill fills the rest of that row
  roundRect(ctx, rL, 494, rR - rL - 216, 54, 12);
  ctx.fillStyle = T.accent;
  ctx.fill();
  fitText(ctx, d.subject || '—', (rL + rR - 216) / 2, 522, rR - rL - 250, 23, 'bold', T.onAccent, 'center', 'rtl');

  // ── QR: bigger, because nothing else competes for this side ──
  const qs = 240, qx = 110, qy = 216;
  roundRect(ctx, qx - 10, qy - 10, qs + 20, qs + 20, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = T.accent;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.drawImage(qr, qx, qy, qs, qs);

  fitText(ctx, 'امسح الرمز', qx + qs / 2, qy + qs + 42, qs + 20, 19, 'bold', T.ink, 'center', 'rtl');
  fitText(ctx, 'للحضور والانصراف', qx + qs / 2, qy + qs + 70, qs + 20, 15, 'bold', T.muted, 'center', 'rtl');

  ctx.restore();
}

// ─────────────────────────────── BACK (teacher) ──────────────────────────────
// The teacher's photo and logo live HERE, beside their own details.

export function drawCardBackPortrait(
  ctx: Ctx,
  d: CardDesign,
  qr: CanvasImageSource | null,
  images: CardImages = {},
): void {
  ctx.save();

  // ── Background ──
  bgTransform(ctx);
  roundRect(ctx, 0, 0, DESIGN_W, DESIGN_H, 28);
  ctx.clip();

  ctx.fillStyle = T.panel;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  ctx.fillStyle = T.dotDark;
  for (let y = 16; y < DESIGN_H; y += 16) {
    for (let x = 16; x < DESIGN_W; x += 16) ctx.fillRect(x, y, 2, 2);
  }
  // The teacher column sits on a darker field, so the photo has something to sit on.
  ctx.fillStyle = T.panelDark;
  ctx.fillRect(0, 0, 330, DESIGN_H);
  ctx.fillStyle = T.accent;
  ctx.fillRect(330, 0, 4, DESIGN_H);

  contentTransform(ctx);

  // ── Left column: logo, photo, info QR ──
  const colCx = 168;

  if (images.logo) {
    drawLogo(ctx, images.logo, colCx, 62, 220, 84);
  } else {
    // No logo uploaded — the academy name carries the top of the column instead.
    fitText(ctx, d.teacherName || '', colCx, 62, 240, 22, 'bold', T.accentOnPanel, 'center', 'rtl');
  }

  // Photo frame
  // 15% taller (258 -> 297). The info QR below had to move down to make room.
  const px = 48, py = 122, pw = 240, ph = 297;
  ctx.save();
  // Frame, border and clip move as one piece — see drawPhoto in student-card.util.ts.
  ctx.translate(A.photoDx, A.photoDy);
  roundRect(ctx, px, py, pw, ph, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = T.accent;
  ctx.lineWidth = 5;
  ctx.stroke();
  roundRect(ctx, px + 4, py + 4, pw - 8, ph - 8, 12);
  ctx.clip();

  if (images.photo) {
    ctx.fillStyle = '#eef1f0';   // neutral backdrop behind a transparent photo
    ctx.fillRect(px, py, pw, ph);
    drawCover(ctx, images.photo, px + 4, py + 4, pw - 8, ph - 8);
  } else {
    // No placeholder: left blank white so a photo can be attached by hand.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px, py, pw, ph);
  }
  ctx.restore();

  // Info QR under the photo (hidden entirely when no link is configured)
  if (qr) {
    const qs = 120, qx = colCx - qs / 2, qy = 440;
    roundRect(ctx, qx - 8, qy - 8, qs + 16, qs + 16, 12);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.drawImage(qr, qx, qy, qs, qs);
    fitText(ctx, 'امسح للاطلاع على المعلومات', colCx, qy + qs + 28, 260, 14, 'bold', T.accentOnPanel, 'center', 'rtl');
  }

  // ── Right column: who the teacher is, and how to reach them ──
  const tR = 968;   // right edge of the RTL text column
  const tL = 372;

  fitText(ctx, d.teacherName || '', tR, 64, tR - tL, 34, 'bold', T.onPanel, 'right', 'rtl');
  if (d.teacherTitle) {
    fitText(ctx, d.teacherTitle, tR, 102, tR - tL, 20, 'bold', T.accentOnPanel, 'right', 'rtl');
  }

  ctx.strokeStyle = T.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tL, 128);
  ctx.lineTo(tR, 128);
  ctx.stroke();

  // Contacts — two per row, only the ones that are filled in
  const contacts: { kind: Glyph; text: string }[] = [
    { kind: 'phone', text: d.phone },
    { kind: 'whatsapp', text: d.whatsapp },
    { kind: 'mail', text: d.email },
    { kind: 'pin', text: d.location },
  ].filter((c) => !!(c.text || '').trim()) as { kind: Glyph; text: string }[];

  const colW = (tR - tL) / 2;
  contacts.forEach((c, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const right = tR - col * colW;         // RTL: first item on the right
    const y = 168 + row * 44;
    glyph(ctx, c.kind, right - 14, y, T.accent);
    fitText(ctx, c.text, right - 34, y, colW - 54, 16, 'bold', T.onPanel, 'right', 'ltr');
  });

  const afterContacts = 168 + Math.ceil(contacts.length / 2) * 44 + 8;

  // Slogan
  if ((d.slogan || '').trim()) {
    const lines = d.slogan.split('\n').slice(0, 2);
    const boxH = lines.length > 1 ? 78 : 54;
    roundRect(ctx, tL, afterContacts, tR - tL, boxH, 12);
    ctx.fillStyle = T.quote;
    ctx.fill();
    lines.forEach((line, i) => {
      fitText(ctx, line, tR - 18, afterContacts + 28 + i * 26, tR - tL - 36, 17, 'bold', T.ink, 'right', 'rtl');
    });
  }

  // Instructions
  const insTop = afterContacts + ((d.slogan || '').includes('\n') ? 96 : 72);
  const instructions = (d.instructions || []).filter((x) => !!(x || '').trim()).slice(0, 5);
  if (instructions.length) {
    fitText(ctx, 'تعليمات للطالب', tR, insTop, tR - tL, 18, 'bold', T.accentOnPanel, 'right', 'rtl');
    instructions.forEach((line, i) => {
      const y = insTop + 32 + i * 28;
      tick(ctx, tR - 10, y);
      fitText(ctx, line, tR - 30, y, tR - tL - 44, 14, 'bold', T.onPanel, 'right', 'rtl');
    });
  }

  // Highlights along the bottom
  const highlights = (d.highlights || []).filter((x) => !!(x || '').trim()).slice(0, 4);
  if (highlights.length) {
    const hy = 580;
    const slot = (tR - tL) / highlights.length;
    highlights.forEach((h, i) => {
      const cx = tR - slot * i - slot / 2;
      ctx.beginPath();
      ctx.arc(cx, hy - 22, 4, 0, Math.PI * 2);
      ctx.fillStyle = T.accent;
      ctx.fill();
      const lines = wrap(ctx, h, slot - 16, 13, 'bold', 2);
      lines.forEach((line, li) => {
        fitText(ctx, line, cx, hy + li * 17, slot - 12, 13, 'bold', T.accentOnPanel, 'center', 'rtl');
      });
    });
  }

  ctx.restore();
}
