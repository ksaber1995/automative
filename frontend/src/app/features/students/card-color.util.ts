/**
 * Colour maths for the tenant-tunable card palettes.
 *
 * A tenant sets THREE colours per card set — background, text, accent — but the
 * renderers need a dozen: the darker panel behind the lighter one, the pale accent
 * tint that only shows on a dark field, the hairline rules, the dot texture, and
 * above all the ink that has to stay readable on top of whatever they picked.
 * Deriving those from the three, rather than asking for twelve pickers, is what
 * keeps an academy from shipping a thousand printed cards nobody can read.
 *
 * The contrast guard is the point of this file, not a nicety. Every card renderer
 * used to hard-code '#ffffff' for text on its deep panel, which is correct only for
 * as long as the panel is dark. Once the panel is a tenant's choice it may be pale
 * yellow, and the guard is the only thing standing between that and an invisible
 * card. Ratios are WCAG 2.x relative luminance; 4.5 is the AA body-text threshold.
 */

/** Parse '#rgb' or '#rrggbb'. Anything unparseable comes back black rather than throwing mid-draw. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend: t=0 is `a`, t=1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

export function lighten(hex: string, amount: number): string {
  return mix(hex, '#ffffff', amount);
}

export function darken(hex: string, amount: number): string {
  return mix(hex, '#000000', amount);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** True when `hex` is dark enough that light ink belongs on top of it. */
export function isDark(hex: string): boolean {
  return luminance(hex) < 0.4;
}

/** AA body text. Below this a printed card stops being readable at arm's length. */
const MIN_CONTRAST = 4.5;

/**
 * Ink that is guaranteed to read on `bg`.
 *
 * Keeps `preferred` when it already passes — so a template that has been tuned by
 * hand keeps its exact ink — and otherwise falls back to plain white or near-black,
 * whichever wins on this background. Hue is abandoned deliberately here: this is
 * the last line of defence for body text, and being readable beats being on-brand.
 */
export function readableOn(bg: string, preferred?: string): string {
  if (preferred && contrast(preferred, bg) >= MIN_CONTRAST) return preferred;
  return contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111';
}

/**
 * Ink that reads on BOTH backgrounds.
 *
 * The panel and its deeper twin `panelDark` both carry type — the caption box under
 * the QR is panelDark, the face around it is panel — and one `onPanel` has to serve
 * both. Guarding against only one of them is how "امسح الرمز" ended up dark-on-dark
 * while the text beside it was fine.
 */
export function readableOnBoth(bg1: string, bg2: string, preferred?: string): string {
  const ok = (c: string) => contrast(c, bg1) >= MIN_CONTRAST && contrast(c, bg2) >= MIN_CONTRAST;
  if (preferred && ok(preferred)) return preferred;
  if (ok('#ffffff')) return '#ffffff';
  if (ok('#111111')) return '#111111';
  // No single ink clears both. Favour bg1 — the panel carries far more type than
  // the one small box — rather than splitting the difference and failing on both.
  return readableOn(bg1, preferred);
}

/** tint() that has to clear both backgrounds — see readableOnBoth. */
export function tintBoth(colour: string, bg1: string, bg2: string): string {
  const ok = (c: string) => contrast(c, bg1) >= MIN_CONTRAST && contrast(c, bg2) >= MIN_CONTRAST;
  if (ok(colour)) return colour;
  const towards = isDark(bg1) ? '#ffffff' : '#000000';
  for (let t = 0.05; t <= 0.9; t += 0.05) {
    const c = mix(colour, towards, t);
    if (ok(c)) return c;
  }
  return readableOnBoth(bg1, bg2, colour);
}

/**
 * `colour`, pushed toward black or white only as far as it must go to read on `bg`.
 *
 * Unlike readableOn this KEEPS the hue, so a tenant's accent stays recognisably
 * their accent when it is used as text (the serial chip, the small caps label).
 * Walks in 5% steps and gives up at readableOn — a mid-grey accent on a mid-grey
 * background can't be rescued by lightness alone, and a guess would just be wrong.
 */
export function tint(colour: string, bg: string, min: number = MIN_CONTRAST): string {
  if (contrast(colour, bg) >= min) return colour;
  const towards = isDark(bg) ? '#ffffff' : '#000000';
  for (let t = 0.05; t <= 0.9; t += 0.05) {
    const c = mix(colour, towards, t);
    if (contrast(c, bg) >= min) return c;
  }
  return readableOn(bg, colour);
}
