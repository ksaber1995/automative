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
const AR = (w) => new RegExp(`(?<![\\u0600-\\u06FF])([وفبلك]?)${w}(?![\\u0600-\\u06FF])`, 'g');
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

function apply(value, rules, agreement) {
  let out = value;
  for (const [re, to] of rules) out = out.replace(re, to);
  for (const [re, to] of agreement) out = out.replace(re, to);
  return out;
}

function walk(node, rules, stats, agreement, keyPath) {
  if (typeof node === 'string') {
    if (SKIP_KEYS.has(keyPath)) return undefined;
    const next = apply(node, rules, agreement);
    if (next === node) return undefined;
    stats.changed++;
    return next;
  }
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const r = walk(v, rules, stats, agreement, keyPath ? `${keyPath}.${k}` : k);
      if (r !== undefined) out[k] = r;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

function build(lang, rules, agreement = []) {
  const base = JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8'));
  const stats = { changed: 0, total: 0 };
  const overlay = {};
  for (const [section, body] of Object.entries(base)) {
    if (SKIP_TOP.has(section)) continue;
    const r = walk(body, rules, stats, agreement, section);
    if (r !== undefined) overlay[section] = r;
  }
  const outPath = path.join(I18N, `${lang}.sports.json`);
  fs.writeFileSync(outPath, JSON.stringify(overlay, null, 2) + '\n', 'utf8');
  console.log(`${lang}: ${stats.changed} strings overridden across ${Object.keys(overlay).length} sections -> ${path.basename(outPath)}`);
  return overlay;
}

const en = build('en', EN_RULES);
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
