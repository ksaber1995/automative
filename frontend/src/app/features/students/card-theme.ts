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
 */
export type CardTemplate = 'navy' | 'maroon' | 'minimal';

export const CARD_TEMPLATES: CardTemplate[] = ['navy', 'maroon', 'minimal'];
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
  /** Heading text on a light background. */
  ink: string;
  /** Body text on a light background. */
  body: string;
  muted: string;
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
    ink: '#141d55',
    body: '#334155',
    muted: '#6b7280',
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
    ink: '#45111c',
    body: '#5b4038',
    muted: '#8b7565',
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
    ink: '#0f172a',
    body: '#334155',
    muted: '#94a3b8',
    line: '#e2e8f0',
    wash: '#f8fafc',
    font: SANS,
    dot: '#eef2f6',
    dotDark: '#134e4a',
  },
};
