/**
 * Card templates. Each template renders BOTH faces:
 *   - the front (student data + attendance QR), generated per student
 *   - the back  (teacher details, rules, slogan), shared across the academy
 * so a printed pair always matches.
 *
 * 'navy' and 'maroon' share the ornate renderer (student-card.util.ts +
 * card-back.util.ts) and differ only by palette and typeface. 'minimal' is a
 * structurally different flat design with its own renderer (card-minimal.util.ts),
 * but still uses this same theme shape so the shared text/shape primitives work.
 *
 * 'portrait' is the only template that puts the TEACHER'S photo and logo on the
 * back — the side that is already about the teacher — leaving the student's side
 * clean and giving its QR and details the whole width. Its renderer is
 * card-portrait.util.ts.
 */
import { CardAdjust } from '@shared/interfaces/card-design.interface';
import { darken, isDark, lighten, mix, readableOn, readableOnBoth, tint, tintBoth } from './card-color.util';

export type CardTemplate = 'navy' | 'maroon' | 'minimal' | 'portrait';

export const CARD_TEMPLATES: CardTemplate[] = ['navy', 'maroon', 'minimal', 'portrait'];
export const DEFAULT_TEMPLATE: CardTemplate = 'navy';

export interface CardTheme {
  /** Deep field colour: the left panel on the front, the whole back face (ornate). */
  panel: string;
  panelDark: string;
  /** Metallic/accent colour used for rules, borders and ornaments. */
  accent: string;
  accentLight: string;
  /** Darkest stop of the metallic gradient. */
  accentDeep: string;
  /** Accent that stays legible as text on the light page (the student code). */
  accentInk: string;
  /** Page colour of the front face. */
  page: string;
  /** Quote-box fill on the back. */
  quote: string;
  /**
   * Ink that is guaranteed to read on `panel`/`panelDark`.
   *
   * Every one of these faces used to hard-code '#ffffff' for its type on the panel,
   * which is right only for as long as the panel is dark. `panel` is now a tenant's
   * colour (see tuneTheme) and may be pale, so the ink has to be derived from it —
   * never assumed.
   */
  onPanel: string;
  /** Ink that is guaranteed to read on `accent` — the gold pill, the chips. */
  onAccent: string;
  /**
   * The ACCENT used as text on the panel — the teacher's title, "امسح الرمز", the
   * subject banner. Distinct from `accentLight`, which is the same tint used as a
   * FILL (the gold gradient's stop, minimal's code chip): as text it has to earn a
   * contrast ratio against the panel, and as a fill it must stay the colour the
   * gradient was drawn around. Guarding one broke the other until they were split.
   */
  accentOnPanel: string;
  /** Heading text on a light background. */
  ink: string;
  /**
   * Body text on a light background.
   *
   * `body` and `muted` are NOT greys, and must not be set to one. They were
   * (#334155, #6b7280 and friends), and every label, contact line and rule on the
   * printed card came out washed out. Both are now the template's own dark ink —
   * secondary type is stepped down by SIZE, never by fading it toward the page.
   * The same rule holds for `sub` in the pool palettes (card-agnostic.util.ts).
   */
  body: string;
  /** Label/secondary text on a light background. Dark ink, never a grey — see `body`. */
  muted: string;
  /** Hairline rules and dividers. A line may be grey; type may not. */
  line: string;
  /** Soft panel fill (minimal). */
  wash: string;
  font: string;
  /** Dot texture on the front's light area. */
  dot: string;
  /** Dot texture on the dark back face. */
  dotDark: string;
}

const SANS = '"Segoe UI", Tahoma, Arial, sans-serif';
// Arabic needs a face that actually has Arabic glyphs; the latin serifs only
// take effect for latin runs.
const SERIF = '"Traditional Arabic", "Times New Roman", Georgia, serif';

export const CARD_THEMES: Record<CardTemplate, CardTheme> = {
  navy: {
    panel: '#141d55',
    panelDark: '#0a1036',
    accent: '#c9992f',
    accentLight: '#f4dc96',
    accentDeep: '#8a6516',
    accentInk: '#a97c1c',
    page: '#ffffff',
    quote: '#f7f2e4',
    onPanel: '#ffffff',
    onAccent: '#0a1036',
    accentOnPanel: '#f4dc96',
    ink: '#141d55',
    body: '#141d55',
    muted: '#141d55',
    line: '#e3e6ec',
    wash: '#f4f5f9',
    font: SANS,
    dot: '#e8ebf3',
    dotDark: '#1d2765',
  },
  maroon: {
    panel: '#6d1f2c',
    panelDark: '#45111c',
    accent: '#c0972f',
    accentLight: '#f0dca6',
    accentDeep: '#7a5713',
    accentInk: '#8d6a17',
    page: '#fdf9f0',
    quote: '#fbf3e2',
    onPanel: '#ffffff',
    onAccent: '#45111c',
    accentOnPanel: '#f0dca6',
    ink: '#45111c',
    body: '#45111c',
    muted: '#45111c',
    line: '#e8dcc6',
    wash: '#f7eddc',
    font: SERIF,
    dot: '#f0e4d2',
    dotDark: '#7d2b39',
  },
  // Flat, light, contemporary — teal on slate. No gradients, no crest, no ornament.
  minimal: {
    panel: '#0f766e',
    panelDark: '#115e59',
    accent: '#0f766e',
    accentLight: '#5eead4',
    accentDeep: '#134e4a',
    accentInk: '#0f766e',
    page: '#ffffff',
    quote: '#f8fafc',
    onPanel: '#ffffff',
    onAccent: '#ffffff',
    accentOnPanel: '#5eead4',
    ink: '#0f172a',
    body: '#0f172a',
    muted: '#0f172a',
    line: '#e2e8f0',
    wash: '#f8fafc',
    font: SANS,
    dot: '#eef2f6',
    dotDark: '#134e4a',
  },

  // Deep forest + soft gold: warm and formal, and clearly not a recolour of the
  // navy/maroon pair.
  portrait: {
    panel: '#0f2b26',
    panelDark: '#082019',
    accent: '#c6a15b',
    accentLight: '#eeddb4',
    accentDeep: '#8a6b32',
    accentInk: '#8a6b32',
    page: '#ffffff',
    quote: '#f5f2e9',
    onPanel: '#ffffff',
    onAccent: '#082019',
    accentOnPanel: '#eeddb4',
    ink: '#0f2b26',
    body: '#0f2b26',
    muted: '#0f2b26',
    line: '#e4e9e7',
    wash: '#f4f8f6',
    font: SANS,
    dot: '#e9efec',
    dotDark: '#1a4037',
  },
};

/**
 * Fold a tenant's three chosen colours into the twelve the renderers actually use.
 *
 * The tenant sets `bg`, `text` and `accent` (any of them blank = keep the
 * template's own). Everything else here is DERIVED, because the alternative is
 * asking an academy owner to pick a value for `panelDark`, `accentDeep` and
 * `dotDark` and then live with whatever they chose on a thousand printed cards.
 *
 * What `bg` means for a student card: the PANEL — the deep field that is the left
 * column on the front and the whole of the back. That is the card's dominant
 * colour and the only thing a tenant means by "the background". The page under it
 * stays the template's paper white/cream; a card whose page and panel are the same
 * colour has no design left.
 *
 * Every ink that lands on top of one of these is run through readableOn/tint rather
 * than assumed — see the note on `onPanel`.
 */
export function tuneTheme(base: CardTheme, adj?: CardAdjust | null): CardTheme {
  if (!adj || (!adj.bg && !adj.text && !adj.accent)) return base;
  const t: CardTheme = { ...base };

  if (adj.bg) {
    t.panel = adj.bg;
    // panelDark must stay on the SAME SIDE of the light/dark line as the panel.
    // The design assumes it is a DEEPER panel that the same ink still reads on —
    // so a flat darken(0.35) under a pale field produced a dark box with the
    // panel's now-dark ink on it, and the QR caption went dark-on-dark.
    t.panelDark = isDark(adj.bg) ? darken(adj.bg, 0.35) : darken(adj.bg, 0.12);
    // The dot texture is the panel shifted a step, away from wherever it sits, so
    // it stays a texture rather than a rash of foreign-coloured specks.
    t.dotDark = isDark(adj.bg) ? lighten(adj.bg, 0.12) : darken(adj.bg, 0.06);
  }

  if (adj.text) {
    // tint, not the raw value: `ink` is the type on the light page, and a tenant is
    // perfectly able to pick a pale yellow here and erase every heading on the card.
    // Their hue is kept; only its lightness moves, and only if it has to.
    const readable = tint(adj.text, t.page);
    t.ink = readable;
    t.body = readable;
    t.muted = readable;
  }

  if (adj.accent) {
    t.accent = adj.accent;
    t.accentLight = lighten(adj.accent, 0.62);
    t.accentDeep = darken(adj.accent, 0.34);
    // accentInk is the accent used AS TEXT on the light page (the student code),
    // so it has to earn its contrast rather than inherit it.
    t.accentInk = tint(adj.accent, t.page);
    t.quote = mix(t.page, adj.accent, 0.1);
  }

  // Derived last, from whatever the fields above settled on. Both of these have to
  // clear `panel` AND `panelDark` — the face and the small boxes on it both carry type.
  t.onPanel = readableOnBoth(t.panel, t.panelDark, base.onPanel);
  t.onAccent = readableOn(t.accent, base.onAccent);
  // tintBoth, not readableOn: this one KEEPS its hue, because a gold title going
  // grey would cost the card its character. It only moves as far as contrast demands.
  t.accentOnPanel = tintBoth(adj.accent ? t.accentLight : base.accentOnPanel, t.panel, t.panelDark);
  // The slogan box sits on `quote`; its ink was panelDark, which stops reading the
  // moment either end of that pair moves.
  t.line = adj.bg ? mix(t.page, t.ink, 0.12) : t.line;
  return t;
}
