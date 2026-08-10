/**
 * Generate the sports-academy vocabulary overlays.
 *
 * Walks the base translation files and emits ONLY the keys whose wording
 * differs, at the same paths. Everything untouched falls through to the base
 * file at runtime, so the two can never drift on the ~95% that is identical.
 */
const fs = require('fs');
const path = require('path');

const I18N = path.join(__dirname, '..', 'src', 'assets', 'i18n');

/**
 * Arabic word, with the one-letter clitics Arabic glues onto the front (و "and",
 * ف "so", ب "with", ل "for", ك "as") preserved. Without this, "وكورسات" and
 * "بالحصة" slip through untouched and a screen ends up half-renamed.
 *
 * The lookbehind still refuses a match inside a longer word, so "مدرسة" (school)
 * is not caught by the rule for "مدرس" (teacher).
 */
/**
 * Arabic LETTERS only — deliberately not the whole ؀-ۿ block.
 *
 * That block also holds Arabic punctuation: ؟ (U+061F) and ، (U+060C). Guarding
 * with the whole block meant any word ending a question or followed by a comma
 * was treated as mid-word and skipped, so "حذف هذه الحصة؟" and "مثال: مدرس، مدير"
 * came through untouched. Diacritics are excluded too, so a word carrying a
 * damma or a tanween still matches.
 */
const AR_LETTER = '\\u0621-\\u064A\\u0671-\\u06D3';
const AR = (w) => new RegExp(`(?<![${AR_LETTER}])([وفبلك]?)${w}(?![${AR_LETTER}])`, 'g');
/** English whole word, case-sensitive (we list each casing we want). */
const EN = (w) => new RegExp(`\\b${w}\\b`, 'g');

// Order matters: multi-word and longer forms first, so a general rule cannot
// eat a phrase that has its own translation.
const EN_RULES = [
  // Bundles sit ABOVE courses, so they keep a level-name of their own.
  [EN('Master Courses'), 'Programs'], [EN('Master Course'), 'Program'],
  [EN('master courses'), 'programs'], [EN('master course'), 'program'],
  [EN('Classrooms'), 'Pitches'], [EN('Classroom'), 'Pitch'],
  [EN('classrooms'), 'pitches'], [EN('classroom'), 'pitch'],

  [EN('Courses'), 'Sports'], [EN('Course'), 'Sport'],
  [EN('courses'), 'sports'], [EN('course'), 'sport'],
  [EN('Subjects'), 'Sports'], [EN('Subject'), 'Sport'],
  [EN('subjects'), 'sports'], [EN('subject'), 'sport'],

  [EN('Classes'), 'Groups'], [EN('Class'), 'Group'],
  [EN('classes'), 'groups'], [EN('class'), 'group'],

  [EN('Students'), 'Trainees'], [EN('Student'), 'Trainee'],
  [EN('students'), 'trainees'], [EN('student'), 'trainee'],

  [EN('Teachers'), 'Coaches'], [EN('Teacher'), 'Coach'],
  [EN('teachers'), 'coaches'], [EN('teacher'), 'coach'],
  [EN('Instructors'), 'Coaches'], [EN('Instructor'), 'Coach'],
  [EN('instructors'), 'coaches'], [EN('instructor'), 'coach'],

  [EN('Sessions'), 'Trainings'], [EN('Session'), 'Training'],
  [EN('sessions'), 'trainings'], [EN('session'), 'training'],
  [EN('Lessons'), 'Trainings'], [EN('Lesson'), 'Training'],
  [EN('lessons'), 'trainings'], [EN('lesson'), 'training'],

  [EN('Rooms'), 'Pitches'], [EN('Room'), 'Pitch'],
  [EN('rooms'), 'pitches'], [EN('room'), 'pitch'],

  [EN('Exams'), 'Evaluations'], [EN('Exam'), 'Evaluation'],
  [EN('exams'), 'evaluations'], [EN('exam'), 'evaluation'],
  [EN('Homeworks'), 'Drills'], [EN('Homework'), 'Drills'],
  [EN('homeworks'), 'drills'], [EN('homework'), 'drills'],

  // The act as well as the person — "Teaching, Administration" is a department
  // placeholder, and Teacher→Coach alone left it reading as a school.
  [EN('Teaching'), 'Coaching'], [EN('teaching'), 'coaching'],

  // Books → equipment: the feature sells items against a course, and for a
  // sports academy those are kit rather than textbooks.
  [/\bEducational Books\b/g, 'Equipment'],
  [EN('Books'), 'Equipment'], [EN('Book'), 'Equipment'],
  [EN('books'), 'equipment'], [EN('book'), 'equipment'],
];

// `$1` carries the clitic through (و/ف/ب/ل/ك), so "بالحصة" → "بالتدريب".
const AR_RULES = [
  // Course / subject → sport
  [AR('الكورسات'), '$1الألعاب'], [AR('كورسات'), '$1ألعاب'],
  [AR('الكورس'), '$1اللعبة'], [AR('كورس'), '$1لعبة'],
  [AR('الدورات'), '$1الألعاب'], [AR('دورات'), '$1ألعاب'],
  [AR('الدورة'), '$1اللعبة'], [AR('دورة'), '$1لعبة'],
  [AR('المواد'), '$1الألعاب'], [AR('مواد'), '$1ألعاب'],
  [AR('المادة'), '$1اللعبة'], [AR('مادة'), '$1لعبة'],

  // Class → group
  [AR('الفصول'), '$1المجموعات'], [AR('فصول'), '$1مجموعات'],
  [AR('الفصل'), '$1المجموعة'], [AR('فصل'), '$1مجموعة'],

  // Student → trainee. Possessive forms are spelled out: the clitic rule above
  // only covers prefixes, and "طلابه" would otherwise survive the rename.
  [AR('الطلاب'), '$1المتدربين'], [AR('طلاب'), '$1متدربين'],
  [AR('طلابه'), '$1متدربيه'], [AR('طلابها'), '$1متدربيها'],
  [AR('الطالبات'), '$1المتدربات'], [AR('طالبات'), '$1متدربات'],
  [AR('الطالبة'), '$1المتدربة'], [AR('طالبة'), '$1متدربة'],
  [AR('الطالب'), '$1المتدرب'], [AR('طالب'), '$1متدرب'],

  // Teacher → coach
  [AR('المدرسين'), '$1المدربين'], [AR('مدرسين'), '$1مدربين'],
  [AR('المدرسون'), '$1المدربون'], [AR('مدرسون'), '$1مدربون'],
  [AR('المدرس'), '$1المدرب'], [AR('مدرس'), '$1مدرب'],
  [AR('المعلمين'), '$1المدربين'], [AR('معلمين'), '$1مدربين'],
  [AR('المعلمين'), '$1المدربين'],
  [AR('المعلم'), '$1المدرب'], [AR('معلم'), '$1مدرب'], [AR('معلّم'), '$1مدرب'],

  // Session → training
  [AR('الحصص'), '$1التدريبات'], [AR('حصص'), '$1تدريبات'],
  [AR('حصصه'), '$1تدريباته'], [AR('حصصها'), '$1تدريباتها'],
  [AR('الحصة'), '$1التدريب'], [AR('حصة'), '$1تدريب'],
  [AR('حصته'), '$1تدريبه'], [AR('حصتها'), '$1تدريبها'],

  // Room → pitch
  [AR('القاعات'), '$1الملاعب'], [AR('قاعات'), '$1ملاعب'],
  [AR('القاعة'), '$1الملعب'], [AR('قاعة'), '$1ملعب'],
  [AR('الغرف'), '$1الملاعب'], [AR('غرف'), '$1ملاعب'],
  [AR('الغرفة'), '$1الملعب'], [AR('غرفة'), '$1ملعب'],

  // Exam → evaluation
  [AR('الامتحانات'), '$1التقييمات'], [AR('امتحانات'), '$1تقييمات'],
  [AR('الامتحان'), '$1التقييم'], [AR('امتحان'), '$1تقييم'],
  [AR('الاختبارات'), '$1التقييمات'], [AR('اختبارات'), '$1تقييمات'],
  [AR('الاختبار'), '$1التقييم'], [AR('اختبار'), '$1تقييم'],

  // Homework → drill
  [AR('الواجبات'), '$1التمارين'], [AR('واجبات'), '$1تمارين'],
  [AR('الواجب'), '$1التمرين'], [AR('واجب'), '$1تمرين'],

  // ── Forms the clitic rule above cannot reach ──────────────────────────────
  //
  // ل + ال is written لل, not لال, so "للطلاب" and "للمدرس" never matched the
  // definite forms and whole labels stayed in the old vocabulary
  // ("الحد الأقصى للطلاب").
  [AR('للطلاب'), 'للمتدربين'], [AR('للطالب'), 'للمتدرب'],
  [AR('للمدرسين'), 'للمدربين'], [AR('للمدرس'), 'للمدرب'],
  [AR('للحصص'), 'للتدريبات'], [AR('للحصة'), 'للتدريب'],
  [AR('للفصول'), 'للمجموعات'], [AR('للفصل'), 'للمجموعة'],
  [AR('للكورسات'), 'للألعاب'], [AR('للكورس'), 'للعبة'],
  [AR('للقاعات'), 'للملاعب'], [AR('للقاعة'), 'للملعب'],

  // The accusative ends in an alef that blocks a plain word boundary —
  // "اختر مدرساً" and "اختر كورساً" are both dropdown placeholders.
  [AR('مدرسًا'), '$1مدربًا'], [AR('مدرساً'), '$1مدرباً'],
  [AR('طالبًا'), '$1متدربًا'], [AR('طالباً'), '$1متدرباً'],
  [AR('كورسًا'), '$1لعبة'], [AR('كورساً'), '$1لعبة'],
  [AR('فصلًا'), '$1مجموعة'], [AR('فصلاً'), '$1مجموعة'],

  // A shadda sits inside the word, so مدرّس is not مدرس to a regex.
  [AR('المدرّسين'), '$1المدربين'], [AR('مدرّسين'), '$1مدربين'],
  [AR('المدرّس'), '$1المدرب'], [AR('مدرّس'), '$1مدرب'],
  [AR('المعلّم'), '$1المدرب'], [AR('معلّم'), '$1مدرب'],

  // The act, not the person: "التدريس، الإدارة" is a department placeholder.
  [AR('التدريس'), '$1التدريب'], [AR('تدريس'), '$1تدريب'],

  // Books → equipment. The feature sells items against a course; for a sports
  // academy those are kit, not textbooks.
  [/الكتب التعليمية/g, 'المعدات'],
  [AR('الكتب'), '$1المعدات'], [AR('كتب'), '$1معدات'],
  [AR('الكتاب'), '$1المعدات'], [AR('كتابًا'), '$1معدات'], [AR('كتاباً'), '$1معدات'],
  [AR('كتاب'), '$1معدات'],
];

/**
 * Arabic agreement repairs, applied AFTER the renames.
 *
 * Arabic adjectives, demonstratives and pronouns agree with their noun's gender,
 * and several renames flip it: الحصة and القاعة are feminine, التدريب and الملعب
 * masculine; الفصل is masculine, المجموعة feminine. Left alone the result reads
 * as broken Arabic ("هذه التدريب", "الملعب لديها").
 *
 * A general fix needs a parser. These are the patterns that actually occur in
 * this file — the list is checked against the output, so anything new shows up
 * in the review rather than shipping silently.
 */
// NOTE: no `\b` in any of these. JavaScript's `\b` is defined against ASCII
// `\w`, so between an Arabic letter and a space it is NOT a boundary and the
// rule silently never fires. Use an explicit lookahead instead.
const NOT_AR = '(?![\\u0600-\\u06FF])';
/**
 * English repairs, applied AFTER the renames.
 *
 * Swapping a word changes the grammar around it. "an instructor" became "an
 * coach", and "class(es)" became "group(es)" — both plainly wrong, and both
 * invisible to a rule that only looks at the noun.
 *
 * Scoped to the words this file actually introduces rather than a general
 * a/an fixer, which would trip over "an hour" and every acronym.
 */
const INTRODUCED = 'coach|coaches|group|groups|sport|sports|trainee|trainees|pitch|pitches|training|trainings|drill|drills';
const EN_POLISH = [
  [new RegExp(`\\ban (?=(?:${INTRODUCED})\\b)`, 'g'), 'a '],
  [new RegExp(`\\bAn (?=(?:${INTRODUCED})\\b)`, 'g'), 'A '],
  // …and the other way, for the vowel-initial words we introduce.
  [/\ba (?=(?:evaluation|evaluations|equipment)\b)/g, 'an '],
  [/\bA (?=(?:evaluation|evaluations|equipment)\b)/g, 'An '],
  // "class(es)" pluralises with -es; "group" does not.
  [/\bgroup\(es\)/g, 'group(s)'], [/\bGroup\(es\)/g, 'Group(s)'],
  [/\bpitch\(s\)/g, 'pitch(es)'], [/\bPitch\(s\)/g, 'Pitch(es)'],
];

const AR_AGREEMENT = [
  // الفصل (m) → المجموعة (f): pre-existing breakage in the base file too.
  [/هذا المجموعة/g, 'هذه المجموعة'],
  [new RegExp(`المجموعة لديه${NOT_AR}`, 'g'), 'المجموعة لديها'],
  [/المجموعة منته[يٍ]?/g, 'المجموعة منتهية'], [/مجموعة منتهٍ/g, 'مجموعة منتهية'],
  [/المجموعة الذي/g, 'المجموعة التي'],
  [new RegExp(`مجموعة جديد${NOT_AR}`, 'g'), 'مجموعة جديدة'],
  // الحصة (f) → التدريب (m)
  [/هذه التدريب/g, 'هذا التدريب'], [/التدريب نشطة/g, 'التدريب نشط'],
  [/تدريب نشطة/g, 'تدريب نشط'], [/التدريب منتهية/g, 'التدريب منتهٍ'],
  [/التدريب غير موجودة/g, 'التدريب غير موجود'], [/التدريب تبدأ/g, 'التدريب يبدأ'],
  [/لم تبدأ هذا التدريب/g, 'لم يبدأ هذا التدريب'],
  [/التدريبات المجانية/g, 'التدريبات المجانية'],
  // القاعة/الغرفة (f) → الملعب (m)
  [/الملعب لديها/g, 'الملعب لديه'], [/هذه الملعب/g, 'هذا الملعب'],
  [/الملعب غير موجودة/g, 'الملعب غير موجود'], [/الملعب مشغولة/g, 'الملعب مشغول'],
  // المادة (f) → اللعبة (f) is fine; الكورس (m) → اللعبة (f) is not.
  [/هذا اللعبة/g, 'هذه اللعبة'],
  [new RegExp(`اللعبة الرئيسي${NOT_AR}`, 'g'), 'اللعبة الرئيسية'],
  [new RegExp(`اللعبة غير موجود${NOT_AR}`, 'g'), 'اللعبة غير موجودة'],
  [new RegExp(`لعبة رئيسي${NOT_AR}`, 'g'), 'لعبة رئيسية'],
  // الامتحان (m) → التقييم (m) and الواجب (m) → التمرين (m) keep gender.
];

/**
 * Sections left alone.
 *  AUTH  — login and registration render before any tenant is known, so the
 *          overlay is never loaded there; rewriting them would be dead weight
 *          and would wrongly rename the "Register as Teacher" entry point.
 *  HOMEWORK_RATING — Excellent…Weak is a scale, not vocabulary.
 */
const SKIP_TOP = new Set(['AUTH', 'HOMEWORK_RATING']);

/**
 * Individual keys where a renamed word carries its OTHER meaning, so renaming it
 * says something false. Each one is a word the sports vocabulary happens to
 * collide with, not a naming decision.
 */
const SKIP_KEYS = new Set([
  'ERRORS.RECAPTCHA_FAILED',     // "اختبار الإنسان" is a CAPTCHA, not an assessment
  'CARD_DESIGN.SAMPLE_SUBJECT',  // sample text printed on an ID card
]);

/**
 * Strings that carry a WORKED EXAMPLE rather than vocabulary.
 *
 * Renaming words cannot help here: "e.g., Introduction to Robotics" has no word
 * to swap, it simply describes a different business. A placeholder's whole job
 * is to show the shape of a good answer, so on a sports academy it has to show
 * a sport. These win over the rules above.
 */
const EXPLICIT = {
  'COURSES.FORM.NAME_PLACEHOLDER':      { en: 'e.g., Football', ar: 'مثال: كرة القدم' },
  'COURSES.FORM.CODE_PLACEHOLDER':      { en: 'e.g., FTB-U12', ar: 'مثال: FTB-U12' },
  'CLASSES.FORM.NAME_PLACEHOLDER':      { en: 'e.g., U-12 Group, Morning Group', ar: 'مثال: مجموعة تحت 12، مجموعة الصباح' },
  'CLASSES.FORM.CODE_PLACEHOLDER':      { en: 'e.g., FTB-U12-A', ar: 'مثال: FTB-U12-A' },
  'SUBJECTS.FORM.NAME_PLACEHOLDER':     { en: 'e.g., Football', ar: 'مثال: كرة القدم' },
  // "الثالث الثانوي" is a school year; a sports academy groups by age band.
  'LEVELS.FORM.NAME_PLACEHOLDER':       { en: 'e.g., Beginner', ar: 'مثال: تحت 12 سنة' },
  'EMPLOYEES.FORM.POSITION_PLACEHOLDER': { en: 'e.g., Coach, Manager', ar: 'مثال: مدرب، مدير' },
  'EMPLOYEES.FORM.DEPARTMENT_PLACEHOLDER': { en: 'e.g., Coaching, Administration', ar: 'مثال: التدريب، الإدارة' },
};

function apply(value, rules, agreement) {
  let out = value;
  for (const [re, to] of rules) out = out.replace(re, to);
  for (const [re, to] of agreement) out = out.replace(re, to);
  return out;
}

function walk(node, rules, stats, agreement, keyPath, lang) {
  if (typeof node === 'string') {
    if (SKIP_KEYS.has(keyPath)) return undefined;
    const forced = EXPLICIT[keyPath]?.[lang];
    if (forced !== undefined) {
      if (forced === node) return undefined;
      stats.changed++;
      stats.explicit++;
      return forced;
    }
    const next = apply(node, rules, agreement);
    if (next === node) return undefined;
    stats.changed++;
    return next;
  }
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const r = walk(v, rules, stats, agreement, keyPath ? `${keyPath}.${k}` : k, lang);
      if (r !== undefined) out[k] = r;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

function build(lang, rules, agreement = []) {
  const base = JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8'));
  const stats = { changed: 0, total: 0, explicit: 0 };
  const overlay = {};
  for (const [section, body] of Object.entries(base)) {
    if (SKIP_TOP.has(section)) continue;
    const r = walk(body, rules, stats, agreement, section, lang);
    if (r !== undefined) overlay[section] = r;
  }
  // An EXPLICIT entry whose key no longer exists in the BASE file is dead: the
  // placeholder it was written for was renamed or removed, and nothing says so.
  // Checked against the base rather than the overlay, because an override that
  // happens to equal the existing text is correctly absent from the overlay —
  // "e.g., Beginner" needs no sports twin in English.
  const missed = Object.keys(EXPLICIT).filter(
    (k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), base) === undefined,
  );
  const outPath = path.join(I18N, `${lang}.sports.json`);
  fs.writeFileSync(outPath, JSON.stringify(overlay, null, 2) + '\n', 'utf8');
  console.log(`${lang}: ${stats.changed} strings overridden across ${Object.keys(overlay).length} sections (${stats.explicit} explicit) -> ${path.basename(outPath)}`);
  if (missed.length) console.log(`  ⚠ EXPLICIT keys that did not apply: ${missed.join(', ')}`);
  return overlay;
}

const en = build('en', EN_RULES, EN_POLISH);
const ar = build('ar', AR_RULES, AR_AGREEMENT);

// Anything still carrying a broken agreement pattern is reported rather than
// shipped quietly — this is the check that keeps the list above honest.
const LEFTOVERS = [
  /هذه التدريب/, /هذه الملعب/, /هذا المجموعة/, /هذا اللعبة/,
  /التدريب نشطة/, /الملعب لديها/,
  new RegExp(`المجموعة لديه${NOT_AR}`),
  /التدريب غير موجودة/,
  new RegExp(`اللعبة الرئيسي${NOT_AR}`),
];
const flat = [];
(function collect(o, p) {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') flat.push([p ? `${p}.${k}` : k, v]);
    else collect(v, p ? `${p}.${k}` : k);
  }
})(ar, '');
const broken = flat.filter(([, v]) => LEFTOVERS.some((re) => re.test(v)));
console.log(`\nar: ${broken.length} strings still carry a known agreement break`);
for (const [k, v] of broken.slice(0, 20)) console.log(`  ${k} = ${v}`);

// Same check for English: the grammar artifacts a word swap creates.
const EN_LEFTOVERS = [
  new RegExp(`\\ban (?:${INTRODUCED})\\b`, 'i'),
  /\bgroup\(es\)/i,
  /\ba (?:evaluation|equipment)\b/,
];
const enFlat = [];
(function collect(o, p) {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') enFlat.push([p ? `${p}.${k}` : k, v]);
    else collect(v, p ? `${p}.${k}` : k);
  }
})(en, '');
const enBroken = enFlat.filter(([, v]) => EN_LEFTOVERS.some((re) => re.test(v)));
console.log(`en: ${enBroken.length} strings still carry a word-swap grammar artifact`);
for (const [k, v] of enBroken.slice(0, 20)) console.log(`  ${k} = ${v}`);

// A few spot checks printed for review.
const probe = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
console.log('\n--- spot checks (en) ---');
for (const p of ['NAV.COURSES', 'NAV.STUDENTS', 'NAV.ROOMS', 'COURSES.TITLE', 'STUDENTS.TITLE', 'EXAMS.KIND.HOMEWORK']) {
  console.log(`${p} = ${JSON.stringify(probe(en, p))}`);
}
console.log('\n--- spot checks (ar) ---');
for (const p of ['NAV.COURSES', 'NAV.STUDENTS', 'NAV.ROOMS', 'COURSES.TITLE', 'STUDENTS.TITLE']) {
  console.log(`${p} = ${JSON.stringify(probe(ar, p))}`);
}
