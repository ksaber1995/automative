import { CardDesign } from '@shared/interfaces/card-design.interface';
import {
  CardImages, Ctx, DESIGN_H, DESIGN_W, StudentCardData, T, bgTransform, contentTransform, fitText, roundRect, wrap, wrapFit,
} from './student-card.util';

/**
 * The 'minimal' template — both faces. Flat, light, contemporary: teal on slate,
 * generous whitespace, hairline rules. No gradients, no crest, no ornament, so
 * it reads as a deliberately different product from the ornate navy/maroon cards
 * rather than a recolour of them.
 *
 * Same 1016x638 (8.6 x 5.4 cm @ 300dpi) canvas. Big fills stay flat — see the
 * gradient note in student-card.util.ts; that constraint is a feature here.
 */

/** Rounded page + hairline border, shared by both faces. */
function page(ctx: Ctx): void {
  ctx.fillStyle = T.page;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
}

function border(ctx: Ctx): void {
  // Called after restore(), so it re-establishes the full-card transform itself —
  // the hairline frame traces the card's real edge.
  ctx.save();
  bgTransform(ctx);
  roundRect(ctx, 1, 1, DESIGN_W - 2, DESIGN_H - 2, 26);
  ctx.strokeStyle = T.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** The teal spine down the left edge — the one strong colour on the front. */
function spine(ctx: Ctx): void {
  ctx.fillStyle = T.accent;
  ctx.fillRect(0, 0, 12, DESIGN_H);
}

// ─────────────────────────────── FRONT ───────────────────────────────────────

export function drawStudentCardMinimal(ctx: Ctx, d: StudentCardData, qr: CanvasImageSource, images: CardImages = {}): void {
  ctx.save();

  // Background bleeds to the edge; content is inset by the 0.5 cm safe margin.
  bgTransform(ctx);
  roundRect(ctx, 0, 0, DESIGN_W, DESIGN_H, 26);
  ctx.clip();
  page(ctx);

  // left wash column, then the spine on top of it
  ctx.fillStyle = T.wash;
  ctx.fillRect(0, 0, 268, DESIGN_H);
  spine(ctx);

  contentTransform(ctx);

  // student code chip in the left column
  roundRect(ctx, 46, 414, 186, 44, 10);
  ctx.fillStyle = T.accentLight;
  ctx.fill();
  fitText(ctx, d.code || '—', 139, 437, 160, 22, 'bold', T.accentDeep, 'center', 'ltr');

  // ---- header (RTL, right-aligned) ----
  const hR = 968;
  if (d.companyName) {
    fitText(ctx, d.companyName, hR, 52, 380, 18, 'bold', T.accent, 'right', 'rtl');
  }
  fitText(ctx, 'بطاقة تعريف الطالب', hR, 92, 420, 33, 'bold', T.ink, 'right', 'rtl');

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '3px';
  ctx.font = `900 14px ${T.font}`;
  ctx.fillStyle = T.muted;
  ctx.fillText('STUDENT ID CARD', hR, 122);
  ctx.restore();

  ctx.strokeStyle = T.accent;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hR - 130, 142);
  ctx.lineTo(hR, 142);
  ctx.stroke();

  // ---- detail rows: label above value, hairline rule, no icons ----
  const rows = [
    { label: 'اسم الطالب', value: d.name, dir: 'rtl' as const },
    { label: 'الصف الدراسي', value: d.level, dir: 'rtl' as const },
    { label: 'المجموعة', value: d.group, dir: 'rtl' as const },
    { label: 'العام الدراسي', value: d.year, dir: 'ltr' as const },
  ];
  const rR = 700;      // right edge of the rows column
  const rL = 300;      // left edge
  const top = 178;
  const rowH = 78;

  rows.forEach((row, i) => {
    const y = top + i * rowH;
    fitText(ctx, row.label, rR, y, rR - rL, 15, 'bold', T.muted, 'right', 'rtl');
    fitText(
      ctx,
      row.value || '—',
      row.dir === 'ltr' ? rR : rR,
      y + 28,
      rR - rL,
      22,
      'bold',
      T.ink,
      'right',
      row.dir,
    );
    ctx.strokeStyle = T.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rL, y + 50);
    ctx.lineTo(rR, y + 50);
    ctx.stroke();
  });

  // ---- subject pill ----
  roundRect(ctx, rL, 528, rR - rL, 58, 12);
  ctx.fillStyle = T.accent;
  ctx.fill();
  fitText(ctx, d.subject || '—', (rL + rR) / 2, 557, rR - rL - 40, 23, 'bold', T.onAccent, 'center', 'rtl');

  // ---- QR ----
  const qs = 196, qx = 750, qy = 176;
  roundRect(ctx, qx, qy, qs, qs, 12);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = T.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.drawImage(qr, qx + 12, qy + 12, qs - 24, qs - 24);

  fitText(ctx, 'امسح الرمز', qx + qs / 2, qy + qs + 30, qs, 17, 'bold', T.accent, 'center', 'rtl');
  fitText(ctx, 'للحضور والانصراف', qx + qs / 2, qy + qs + 54, qs, 14, 'bold', T.muted, 'center', 'rtl');

  ctx.restore();
  border(ctx);
}

// ─────────────────────────────── BACK ────────────────────────────────────────

type Contact = 'phone' | 'whatsapp' | 'email' | 'pin';

/** Flat teal outline glyphs — no fills, no gradients. */
function icon(ctx: Ctx, kind: Contact, cx: number, cy: number): void {
  ctx.save();
  ctx.strokeStyle = T.accent;
  ctx.fillStyle = T.accent;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'phone') {
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 8);
    ctx.quadraticCurveTo(cx - 8, cy - 2, cx - 2, cy + 3);
    ctx.quadraticCurveTo(cx + 3, cy + 9, cx + 8, cy + 6);
    ctx.lineTo(cx + 8, cy + 1);
    ctx.lineTo(cx + 3, cy - 1);
    ctx.lineTo(cx, cy + 2);
    ctx.quadraticCurveTo(cx - 3, cy - 1, cx - 3, cy - 4);
    ctx.lineTo(cx - 1, cy - 6);
    ctx.lineTo(cx - 3, cy - 10);
    ctx.closePath();
    ctx.stroke();
  } else if (kind === 'whatsapp') {
    // bubble + tail + a small handset, so it can't be mistaken for the phone glyph
    ctx.beginPath();
    ctx.arc(cx, cy - 1, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 10);
    ctx.lineTo(cx - 4, cy + 5);
    ctx.lineTo(cx - 7, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy - 1);
    ctx.scale(0.46, 0.46);
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
    roundRect(ctx, cx - 9, cy - 7, 18, 14, 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 6);
    ctx.lineTo(cx, cy + 1);
    ctx.lineTo(cx + 9, cy - 6);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy - 3, 6, Math.PI, 0);
    ctx.bezierCurveTo(cx + 6, cy + 2, cx + 2, cy + 4, cx, cy + 10);
    ctx.bezierCurveTo(cx - 2, cy + 4, cx - 6, cy + 2, cx - 6, cy - 3);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - 3, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawCardBackMinimal(ctx: Ctx, d: CardDesign, qr: CanvasImageSource | null): void {
  ctx.save();

  // Background bleeds to the edge; content is inset by the 0.5 cm safe margin.
  bgTransform(ctx);
  roundRect(ctx, 0, 0, DESIGN_W, DESIGN_H, 26);
  ctx.clip();
  page(ctx);
  spine(ctx);

  contentTransform(ctx);

  // ---- contact block (right) ----
  const tR = 968;
  const contacts = ([
    { k: 'phone', v: d.phone },
    { k: 'whatsapp', v: d.whatsapp },
    { k: 'email', v: d.email },
    { k: 'pin', v: d.location },
  ] as { k: Contact; v: string }[]).filter((c) => !!c.v);

  contacts.forEach((c, i) => {
    const cy = 148 + i * 42;
    icon(ctx, c.k, tR - 14, cy);
    fitText(ctx, c.v, tR - 38, cy, 250, 16, 'bold', T.body, 'right', c.k === 'pin' ? 'rtl' : 'ltr');
  });

  // hairline divider between teacher and rules
  ctx.strokeStyle = T.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(690, 44);
  ctx.lineTo(690, 320);
  ctx.stroke();

  // ---- instructions (middle) ----
  fitText(ctx, 'تعليمات للطالب', 646, 56, 240, 19, 'bold', T.accent, 'right', 'rtl');
  ctx.beginPath();
  ctx.moveTo(536, 74);
  ctx.lineTo(646, 74);
  ctx.strokeStyle = T.accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  const rules = d.instructions.filter((s) => !!s && s.trim()).slice(0, 5);
  // WRAPPED over two lines, not run through fitText on one — see the same note in
  // card-back.util.ts. In a 340-wide column a full-length instruction shrank to
  // fitText's 9px floor. Worst case (5 rules x 2 lines) lands the last line at
  // y=321, clear of the divider at 352.
  let cy = 112;
  rules.forEach((rule) => {
    const { lines, size } = wrapFit(ctx, rule, 340, 16, 'bold', 2, 12);
    // hollow teal tick
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(662, cy, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(658, cy);
    ctx.lineTo(661, cy + 3.5);
    ctx.lineTo(667, cy - 3.5);
    ctx.stroke();

    lines.forEach((line, li) => {
      fitText(ctx, line, 640, cy + li * 21, 340, size, 'bold', T.body, 'right', 'rtl');
    });
    cy += lines.length * 21 + 5;
  });

  // ---- info QR (left) ----
  if (qr) {
    const qs = 190, qx = 44, qy = 44;
    roundRect(ctx, qx, qy, qs, qs, 12);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = T.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.drawImage(qr, qx + 10, qy + 10, qs - 20, qs - 20);

    fitText(ctx, 'امسح الرمز', qx + qs / 2, qy + qs + 26, qs, 16, 'bold', T.accent, 'center', 'rtl');
    fitText(ctx, 'للاطلاع على المعلومات', qx + qs / 2, qy + qs + 48, qs + 20, 13, 'bold', T.muted, 'center', 'rtl');
  }

  // ---- bottom ----
  ctx.strokeStyle = T.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(44, 352);
  ctx.lineTo(972, 352);
  ctx.stroke();

  // slogan (right), in a soft wash box
  if (d.slogan && d.slogan.trim()) {
    const sx = 596, sy = 386, sw = 376, sh = 196;
    roundRect(ctx, sx, sy, sw, sh, 14);
    ctx.fillStyle = T.wash;
    ctx.fill();

    // a teal rule instead of quote glyphs — quieter, more modern
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx + sw - 26, sy + 28);
    ctx.lineTo(sx + sw - 26, sy + sh - 28);
    ctx.stroke();

    const lines = d.slogan.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);
    const startY = sy + sh / 2 - (lines.length - 1) * 19;
    lines.forEach((line, i) => {
      fitText(ctx, line, sx + sw - 46, startY + i * 38, sw - 84, 21, 'bold', T.ink, 'right', 'rtl');
    });
  }

  // highlights (left) — plain teal bullets, RTL so the first sits rightmost
  const hi = d.highlights.filter((s) => !!s && s.trim()).slice(0, 4);
  if (hi.length) {
    const zoneL = 48, zoneR = 556;
    const slot = (zoneR - zoneL) / hi.length;
    hi.forEach((label, i) => {
      const cx = zoneR - slot * (i + 0.5);
      ctx.fillStyle = T.accent;
      ctx.beginPath();
      ctx.arc(cx, 428, 5, 0, Math.PI * 2);
      ctx.fill();

      const lines = wrap(ctx, label, slot - 16, 15, 'bold', 2);
      lines.forEach((line, li) => {
        fitText(ctx, line, cx, 462 + li * 23, slot - 10, 15, 'bold', T.body, 'center', 'rtl');
      });
    });
  }

  ctx.restore();
  border(ctx);
}
