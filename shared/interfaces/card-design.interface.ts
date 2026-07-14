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

export interface CardDesign {
  /**
   * Which of the three card designs to print. Governs BOTH faces: the shared
   * back rendered here, and the per-student fronts in the ZIP export, so a
   * printed pair always matches.
   */
  template: CardTemplateId;
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
}

export const CARD_DESIGN_MAX = {
  instructions: 5,
  highlights: 4,
} as const;

export const DEFAULT_CARD_DESIGN: CardDesign = {
  template: 'navy',
  teacherName: '',
  teacherTitle: '',
  phone: '',
  whatsapp: '',
  email: '',
  location: '',
  qrLink: '',
  slogan: 'التفوق لا يأتي صدفة\nبل هو نتيجة الإجتهاد والثقة بالله',
  instructions: [
    'يحافظ الطالب على البطاقة وعدم إعارتها.',
    'في حالة فقدان البطاقة يتم إبلاغ المعلم فوراً.',
    'تُستخدم البطاقة في الحضور والانصراف.',
    'المحافظة على البطاقة وعدم العبث بها.',
    'الالتزام بالقوانين دليل على احترامك لنفسك وللآخرين.',
  ],
  highlights: [
    'شرح مبسط وفهم عميق',
    'مراجعات نهائية',
    'اختبارات دورية',
    'متابعة مستمرة وتقييم شامل',
  ],
  photo: '',
  logo: '',
};
