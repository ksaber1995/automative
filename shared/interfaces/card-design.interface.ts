/**
 * Per-company design of the student ID card's BACK face.
 *
 * The front face is personal (name, code, class, QR) and is generated per
 * student. The back is identical for every card in the academy — teacher
 * details, rules, contact info, slogan — so it is configured once here and
 * exported as a single shared `card-back.png`.
 *
 * Stored as JSONB on `companies.card_design`.
 */
export type CardTemplateId = 'navy' | 'maroon' | 'minimal' | 'portrait';

/**
 * The AGNOSTIC templates — used for the pre-printed QR card pool.
 *
 * A pool card is printed before anybody owns it, so it carries no student data at
 * all: both faces are about the academy, and the only per-card content is the QR
 * and the serial. Chosen independently of `template`, which governs the personal
 * student cards.
 */
export type AgnosticTemplateId = 'aurora' | 'ribbon' | 'mono' | 'wave' | 'crest' | 'custom';

/**
 * A tenant's per-card-set tuning: where the logo/photo sit, how big the logo is,
 * and the three colours the palette is derived from.
 *
 * Held SEPARATELY for the pool cards and the student cards (`CardDesign.pool` and
 * `CardDesign.student`). They are different designs printed for different reasons —
 * a logo offset that suits `crest` has no meaning on `navy` — so one shared set of
 * numbers would just be wrong on one of them.
 *
 * Every field is a delta from the template's own design, never an absolute: zero
 * and blank mean "as the designer drew it". That is what lets the templates keep
 * being edited without silently moving a tenant's logo.
 */
/**
 * Where the QR and the serial sit on a tenant's OWN artwork ('custom' pool design).
 *
 * Coordinates are centres, in the same 1016 x 638 design space as everything else,
 * but they address the FULL-BLEED card rather than the safe-inset content box — the
 * artwork is printed edge to edge, so a coordinate has to mean the same spot on the
 * tenant's image as it does on the card. They are clamped to POOL_ART_SAFE so a
 * placed QR still cannot land in the guillotine's margin of error.
 *
 * Only these two things are placeable, and that is the whole point of the design:
 * everything else on a pool card is the academy's own artwork. The QR and the
 * serial are the only per-card content that exists.
 */
export interface PoolArtLayout {
  /** QR centre + the length of its side. */
  qrX: number;
  qrY: number;
  qrSize: number;
  /**
   * White plate under the QR. ON by default and worth leaving on: a QR read by a
   * phone camera off a printed card needs a light quiet zone, and dropped onto a
   * dark or busy part of an artwork it simply will not scan. Off is for artwork
   * that already has a white box waiting for it.
   */
  qrTile: boolean;
  /** Serial centre, its font size, and its ink. */
  codeX: number;
  codeY: number;
  codeSize: number;
  /** Run through the contrast guard against the artwork before it is drawn. */
  codeColor: string;
  /** A chip behind the serial, for artwork with nowhere quiet to put it. */
  codeChip: boolean;
}

/**
 * How close to the card's edge a placed QR/serial may get, in design px.
 *
 * The card is guillotined with a millimetre or two of drift, so this mirrors the
 * 0.5 cm safe margin every other face respects — converted into design space
 * (CARD_SAFE 59px of CARD_W 1063 -> 1016 design units).
 */
export const POOL_ART_SAFE = 56;

export const DEFAULT_POOL_ART: PoolArtLayout = {
  // Left half, vertically centred: the same place the built-in pool designs put it,
  // so a tenant's first drag starts from somewhere sane rather than a corner.
  qrX: 235,
  qrY: 290,
  qrSize: 268,
  qrTile: true,
  codeX: 235,
  codeY: 470,
  codeSize: 34,
  codeColor: '#111827',
  codeChip: false,
};

export interface CardAdjust {
  /**
   * Logo width as a percentage of the template's own logo box, 50..200.
   * 100 = exactly as designed. Height follows — the logo is always drawn to fit its
   * box whole (drawContain), so this scales the box, never the aspect ratio.
   */
  logoScale: number;
  /** Logo nudge from its designed spot, in design-space px. See CARD_ADJUST_BOUNDS. */
  logoDx: number;
  logoDy: number;
  /** Teacher-photo nudge from its designed spot, in design-space px. */
  photoDx: number;
  photoDy: number;
  /**
   * The card's dominant field. On a pool card that is the page itself; on a student
   * card it is the panel (the left column and the whole back face) — see tuneTheme.
   * Blank = the template's own.
   */
  bg: string;
  /** Primary ink. Blank = the template's own. */
  text: string;
  /** Ribbon/chips/rules. Blank = the template's own. */
  accent: string;
}

/**
 * Bounds for the nudges, in design-space px (the card is 1016 x 638).
 *
 * Deliberately tight. These are 9 x 5.7 cm cards that get guillotined with a
 * millimetre or two of drift and then have a QR scanned off them, so an
 * unconstrained offset is a way to push a logo off the card or onto the QR's quiet
 * zone and not find out until a thousand are printed. Clamped in the renderer too,
 * not only in the UI — the API takes whatever a client sends.
 */
export const CARD_ADJUST_BOUNDS = {
  scaleMin: 50,
  scaleMax: 200,
  offset: 120,
} as const;

export const DEFAULT_CARD_ADJUST: CardAdjust = {
  logoScale: 100,
  logoDx: 0,
  logoDy: 0,
  photoDx: 0,
  photoDy: 0,
  bg: '',
  text: '',
  accent: '',
};

/**
 * Which rows appear on the student card's FRONT.
 *
 * Academies print these for different reasons, so what belongs on the card
 * differs: one wants the school on it, another the group the child trains with,
 * a third only a name and a code. Every row still disappears on its own when the
 * student has no value for it — this decides what is *offered*, the data decides
 * what is *shown*.
 *
 * `code` has no toggle: the card exists to be scanned, and its number is the
 * fallback when a camera will not read the QR. A card with neither is a blank.
 */
export interface CardFields {
  studentName: boolean;
  /** The class/group the student trains with. */
  className: boolean;
  /** The course/sport they are enrolled on. */
  courseName: boolean;
  /** The school the student attends (students.school_name). */
  school: boolean;
  /** The academic year footer. */
  year: boolean;
}

export const DEFAULT_CARD_FIELDS: CardFields = {
  studentName: true,
  className: true,
  courseName: true,
  school: true,
  year: true,
};

/** Narrow whatever is stored (or missing) into a full set. */
export function clampFields(f?: Partial<CardFields> | null): CardFields {
  const d = DEFAULT_CARD_FIELDS;
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
  return {
    studentName: bool(f?.studentName, d.studentName),
    className: bool(f?.className, d.className),
    courseName: bool(f?.courseName, d.courseName),
    school: bool(f?.school, d.school),
    year: bool(f?.year, d.year),
  };
}

export interface CardDesign {
  /**
   * Which of the three card designs to print. Governs BOTH faces: the shared
   * back rendered here, and the per-student fronts in the ZIP export, so a
   * printed pair always matches.
   */
  template: CardTemplateId;
  /** Which rows the student card's front shows. Absent = all of them. */
  fields?: CardFields;
  /** Which agnostic design the QR-card pool prints with. */
  agnosticTemplate?: AgnosticTemplateId;
  /** Defaults to the company name when blank. */
  teacherName: string;
  /** The line under the name, e.g. "خبير اللغة العربية". */
  teacherTitle: string;
  phone: string;
  whatsapp: string;
  email: string;
  location: string;
  /** Free URL the back-face QR points at; blank hides the QR block. */
  qrLink: string;
  /** Quote box. A newline splits it into two lines. */
  slogan: string;
  /** Rules list ("تعليمات للطالب"). */
  instructions: string[];
  /** The four icon items along the bottom. */
  highlights: string[];
  /**
   * The teacher's photo, shown in the student-side photo frame. A data URL, not a
   * hosted URL: the card is rasterised through canvas.toDataURL(), and an image
   * from another origin taints the canvas and makes the export throw. Empty = the
   * default silhouette placeholder. The card-design page downscales before saving.
   */
  photo: string;
  /** The academy's logo, replacing the crest. Same data-URL rule as `photo`. */
  logo: string;
  /** Tuning for the personal student cards. Absent = the template as designed. */
  student?: CardAdjust;
  /**
   * Tuning for the QR card pool's STUDENT side, and the colours for both of its
   * faces — the two faces are one card, so they share a palette.
   */
  pool?: CardAdjust;
  /**
   * Placement for the pool's ACADEMY side.
   *
   * Separate from `pool` because both pool faces carry a logo, and one set of
   * numbers moved both at once — nudging the front's logo dragged the back's with
   * it, which is not a thing anybody wants. Its colour fields are IGNORED: colours
   * come from `pool` for both faces (see composeAdjust). Absent falls back to
   * `pool`, so designs saved before this keep rendering exactly as they did.
   */
  poolBack?: CardAdjust;
  /**
   * The academy's OWN artwork for the pool cards, used when `agnosticTemplate` is
   * 'custom'. Same data-URL rule as `photo`/`logo`: a hosted URL from another origin
   * taints the canvas and makes the ZIP export throw.
   *
   * `artFront` is the students' side — the artwork the QR and serial are placed on.
   * `artBack` is the academy's side, printed exactly as uploaded with nothing added.
   */
  artFront?: string;
  artBack?: string;
  /** Where the QR and serial sit on `artFront`. */
  poolArt?: PoolArtLayout;
}

export const CARD_DESIGN_MAX = {
  instructions: 5,
  highlights: 4,
} as const;

export const DEFAULT_CARD_DESIGN: CardDesign = {
  template: 'navy',
  fields: { ...DEFAULT_CARD_FIELDS },
  agnosticTemplate: 'aurora',
  teacherName: '',
  teacherTitle: '',
  phone: '',
  whatsapp: '',
  email: '',
  location: '',
  qrLink: '',
  // English defaults — the printed card design is English. A tenant can still
  // write these in any language from the Card Design page; whatever they save
  // wins over these.
  slogan: 'Excellence is never an accident.\nIt is the result of hard work and dedication.',
  instructions: [
    'Keep this card safe and do not lend it to anyone.',
    'Report a lost card to your teacher immediately.',
    'This card is used for check-in and check-out.',
    'Take good care of the card and do not tamper with it.',
    'Following the rules shows respect for yourself and others.',
  ],
  highlights: [
    'Clear explanations, deep understanding',
    'Final revisions',
    'Regular quizzes',
    'Continuous follow-up and assessment',
  ],
  photo: '',
  logo: '',
  student: { ...DEFAULT_CARD_ADJUST },
  pool: { ...DEFAULT_CARD_ADJUST },
  poolBack: { ...DEFAULT_CARD_ADJUST },
  artFront: '',
  artBack: '',
  poolArt: { ...DEFAULT_POOL_ART },
};

/** Clamp a stored/posted layout into range. The API accepts whatever a client sends. */
export function clampPoolArt(a?: PoolArtLayout | null): PoolArtLayout {
  if (!a) return { ...DEFAULT_POOL_ART };
  const d = DEFAULT_POOL_ART;
  const num = (v: unknown, lo: number, hi: number, dflt: number) =>
    (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
  const hex = (v: unknown, dflt: string) =>
    (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : dflt);
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);

  // Size first: the position bounds depend on it, because what has to stay inside
  // the safe area is the QR's BOX, not its centre point.
  const qrSize = num(a.qrSize, 90, 460, d.qrSize);
  const half = qrSize / 2;
  return {
    qrSize,
    qrX: num(a.qrX, POOL_ART_SAFE + half, 1016 - POOL_ART_SAFE - half, d.qrX),
    qrY: num(a.qrY, POOL_ART_SAFE + half, 638 - POOL_ART_SAFE - half, d.qrY),
    qrTile: bool(a.qrTile, d.qrTile),
    codeX: num(a.codeX, POOL_ART_SAFE, 1016 - POOL_ART_SAFE, d.codeX),
    codeY: num(a.codeY, POOL_ART_SAFE, 638 - POOL_ART_SAFE, d.codeY),
    codeSize: num(a.codeSize, 12, 80, d.codeSize),
    codeColor: hex(a.codeColor, d.codeColor),
    codeChip: bool(a.codeChip, d.codeChip),
  };
}

/** Clamp a stored/posted adjust into range. The API accepts whatever a client sends. */
export function clampAdjust(a?: CardAdjust | null): CardAdjust {
  if (!a) return { ...DEFAULT_CARD_ADJUST };
  const { scaleMin, scaleMax, offset } = CARD_ADJUST_BOUNDS;
  const num = (v: unknown, lo: number, hi: number, dflt: number) =>
    (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
  // A colour is only honoured if it is a hex we can actually parse — a blank or a
  // half-typed '#ab' from the picker must fall back to the template, not to black.
  const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : '');
  return {
    logoScale: num(a.logoScale, scaleMin, scaleMax, 100),
    logoDx: num(a.logoDx, -offset, offset, 0),
    logoDy: num(a.logoDy, -offset, offset, 0),
    photoDx: num(a.photoDx, -offset, offset, 0),
    photoDy: num(a.photoDy, -offset, offset, 0),
    bg: hex(a.bg),
    text: hex(a.text),
    accent: hex(a.accent),
  };
}

/**
 * One adjust for a draw: placement from `placement`, colours from `colours`.
 *
 * The two pool faces place their logos independently but must share a palette —
 * they are the two sides of one card, and a front and back in different colours is
 * not a design, it is a bug. Splitting the record would have meant two colour
 * pickers that must always agree; splitting it only at the point of the draw keeps
 * one picker and still lets each face put its logo where it belongs.
 */
export function composeAdjust(placement?: CardAdjust | null, colours?: CardAdjust | null): CardAdjust {
  const p = clampAdjust(placement);
  const c = clampAdjust(colours);
  return { ...p, bg: c.bg, text: c.text, accent: c.accent };
}
