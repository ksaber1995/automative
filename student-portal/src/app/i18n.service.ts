import { Injectable, effect, signal } from '@angular/core';

export type Lang = 'ar' | 'en';

const LANG_KEY = 'netrofit.exams.lang';

/**
 * The portal's whole dictionary. Hand-rolled on purpose: two languages, one
 * screenful of keys — ngx-translate would be the heaviest thing in the bundle.
 * Arabic is the default (the students are Egyptian); the html element's
 * lang/dir follow the signal, and the stylesheet only uses logical properties,
 * so flipping is one attribute write.
 *
 * API error codes (ERRORS.*) are keys here too, so a backend refusal renders
 * in the student's language without a mapping layer.
 */
const DICT: Record<string, { ar: string; en: string }> = {
  'APP.TITLE': { ar: 'بوابة الامتحانات', en: 'Exam Portal' },
  'APP.LANG_TOGGLE': { ar: 'English', en: 'عربي' },

  'WELCOME.HEADING': { ar: 'أهلاً بك في بوابة الامتحانات', en: 'Welcome to the exam portal' },
  'WELCOME.SUB': { ar: 'حل امتحاناتك أونلاين وشوف نتيجتك فوراً', en: 'Sit your exams online and see your result instantly' },
  'WELCOME.SIGN_IN': { ar: 'تسجيل الدخول', en: 'Sign in' },
  'WELCOME.FIRST_TIME': { ar: 'أول مرة؟ امسح الكارت بتاعك', en: 'First time? Scan your card' },

  'SCAN.HEADING': { ar: 'امسح الكارت بتاعك', en: 'Scan your card' },
  'SCAN.HINT': { ar: 'وجّه الكاميرا على الـ QR اللي على كارتك', en: 'Point the camera at the QR on your card' },
  'SCAN.STARTING': { ar: 'جاري تشغيل الكاميرا…', en: 'Starting the camera…' },
  'SCAN.CAMERA_FAILED': { ar: 'الكاميرا مش متاحة — جرّب متصفح تاني أو اسأل المدرس', en: 'Camera unavailable — try another browser or ask your teacher' },
  'SCAN.IS_THIS_YOU': { ar: 'هو ده انت؟', en: 'Is this you?' },
  'SCAN.YES_ME': { ar: 'أيوه، ده أنا', en: 'Yes, that’s me' },
  'SCAN.NOT_ME': { ar: 'لأ، امسح تاني', en: 'No, scan again' },
  'SCAN.CHECKING': { ar: 'جاري التحقق…', en: 'Checking…' },
  'SCAN.BACK': { ar: 'رجوع', en: 'Back' },

  'CLAIM.HEADING_NEW': { ar: 'اختار اسم مستخدم وكلمة سر', en: 'Pick a username and password' },
  'CLAIM.HEADING_RESET': { ar: 'عيّن كلمة سر جديدة', en: 'Set a new password' },
  'CLAIM.SUB_NEW': { ar: 'هتستخدمهم كل مرة تدخل بيها', en: 'You’ll use these every time you sign in' },
  'CLAIM.SUB_RESET': { ar: 'اسم المستخدم بتاعك زي ما هو — كلمة السر بس اللي هتتغير', en: 'Your username stays the same — only the password changes' },
  'CLAIM.USERNAME': { ar: 'اسم المستخدم أو رقم موبايلك', en: 'Username or your phone number' },
  'CLAIM.PASSWORD': { ar: 'كلمة السر (٨ حروف على الأقل)', en: 'Password (at least 8 characters)' },
  'CLAIM.CONFIRM': { ar: 'اكتب كلمة السر تاني', en: 'Repeat the password' },
  'CLAIM.MISMATCH': { ar: 'الكلمتين مش زي بعض', en: 'The two passwords don’t match' },
  'CLAIM.SUBMIT': { ar: 'تأكيد', en: 'Confirm' },
  'CLAIM.SAVING': { ar: 'جاري الحفظ…', en: 'Saving…' },

  'LOGIN.HEADING': { ar: 'تسجيل الدخول', en: 'Sign in' },
  'LOGIN.IDENTIFIER': { ar: 'اسم المستخدم أو رقم الموبايل', en: 'Username or phone number' },
  'LOGIN.PASSWORD': { ar: 'كلمة السر', en: 'Password' },
  'LOGIN.SUBMIT': { ar: 'دخول', en: 'Sign in' },
  'LOGIN.SIGNING_IN': { ar: 'جاري الدخول…', en: 'Signing in…' },
  'LOGIN.FORGOT': { ar: 'نسيت كلمة السر؟ امسح الكارت بتاعك', en: 'Forgot your password? Scan your card' },

  'EXAMS.HEADING': { ar: 'امتحاناتي', en: 'My exams' },
  'EXAMS.EMPTY': { ar: 'مفيش امتحانات متاحة دلوقتي', en: 'No exams available right now' },
  'EXAMS.EMPTY_SUB': { ar: 'لما المدرس يفتح امتحان هتلاقيه هنا', en: 'When your teacher opens an exam, it will show up here' },
  'EXAMS.SIGN_OUT': { ar: 'خروج', en: 'Sign out' },
  'EXAMS.LOADING': { ar: 'جاري التحميل…', en: 'Loading…' },
  'EXAMS.IN_PROGRESS': { ar: 'مستمر', en: 'In progress' },
  'EXAMS.DONE': { ar: 'خلص', en: 'Done' },
  'EXAMS.QUESTIONS': { ar: 'سؤال', en: 'questions' },
  'EXAMS.MINUTES': { ar: 'دقيقة', en: 'min' },
  'EXAMS.CLOSES': { ar: 'يقفل', en: 'Closes' },
  'EXAMS.START': { ar: 'ابدأ الامتحان', en: 'Start' },
  'EXAMS.CONTINUE': { ar: 'كمّل الامتحان', en: 'Continue' },
  'EXAMS.VIEW_RESULT': { ar: 'شوف النتيجة', en: 'View result' },
  'EXAMS.CODE_PLACEHOLDER': { ar: 'اكتب كود الامتحان', en: 'Access code' },
  'EXAMS.STARTING': { ar: 'جاري البدء…', en: 'Starting…' },
  'EXAMS.MY_RESULTS': { ar: 'كل نتايجي', en: 'All my results' },

  'SIT.QUESTION': { ar: 'سؤال', en: 'Question' },
  'SIT.PREV': { ar: 'السابق', en: 'Previous' },
  'SIT.NEXT': { ar: 'التالي', en: 'Next' },
  'SIT.SUBMIT': { ar: 'تسليم', en: 'Submit' },
  'SIT.SAVED': { ar: 'اتحفظت ✓', en: 'Saved ✓' },
  'SIT.SAVING': { ar: 'جاري الحفظ…', en: 'Saving…' },
  'SIT.SAVE_FAILED': { ar: 'محصلش حفظ — دوس على الإجابة تاني', en: 'Not saved — tap the answer again' },
  'SIT.CONFIRM_TITLE': { ar: 'تسلّم الامتحان؟', en: 'Submit the exam?' },
  'SIT.CONFIRM_UNANSWERED': { ar: 'لسه {n} سؤال من غير إجابة', en: '{n} questions still unanswered' },
  'SIT.CONFIRM_ALL_ANSWERED': { ar: 'جاوبت على كل الأسئلة', en: 'All questions answered' },
  'SIT.CONFIRM_YES': { ar: 'أيوه، سلّم', en: 'Yes, submit' },
  'SIT.CONFIRM_NO': { ar: 'ارجع للامتحان', en: 'Back to the exam' },
  'SIT.TIME_UP': { ar: 'الوقت خلص — جاري التسليم…', en: 'Time is up — submitting…' },
  'SIT.SUBMITTING': { ar: 'جاري التسليم…', en: 'Submitting…' },

  'RESULT.HEADING': { ar: 'نتيجتك', en: 'Your result' },
  'RESULT.OUT_OF': { ar: 'من', en: 'out of' },
  'RESULT.REVIEW': { ar: 'مراجعة الإجابات', en: 'Answer review' },
  'RESULT.NO_ANSWER': { ar: 'مجاوبتش على السؤال ده', en: 'Not answered' },
  'RESULT.EXPIRED_NOTE': { ar: 'الوقت كان خلص — اتحسبلك الإجابات اللي اتحفظت', en: 'Time ran out — the answers you saved were counted' },
  'RESULT.BACK': { ar: 'رجوع لامتحاناتي', en: 'Back to my exams' },

  'RESULTS.HEADING': { ar: 'نتايجي', en: 'My results' },
  'RESULTS.EMPTY': { ar: 'مفيش نتايج لسه', en: 'No results yet' },
  'RESULTS.ABSENT': { ar: 'غايب', en: 'Absent' },
  'RESULTS.NOT_MARKED': { ar: 'لسه متصححش', en: 'Not marked yet' },
  'RESULTS.HOMEWORK': { ar: 'واجب', en: 'Homework' },
  'RESULTS.BACK': { ar: 'رجوع لامتحاناتي', en: 'Back to my exams' },

  // Backend refusals, by their API code.
  'ERRORS.EXAMS.WINDOW_CLOSED': { ar: 'الامتحان مش مفتوح دلوقتي', en: 'This exam is not open right now' },
  'ERRORS.EXAMS.NOT_ENROLLED': { ar: 'الامتحان ده مش لمجموعتك', en: 'This exam is not for your class' },
  'ERRORS.EXAMS.BAD_CODE': { ar: 'الكود غلط — اسأل المدرس', en: 'Wrong code — ask your teacher' },
  'ERRORS.EXAMS.ALREADY_SUBMITTED': { ar: 'انت سلّمت الامتحان ده خلاص', en: 'You already submitted this exam' },
  'ERRORS.EXAMS.TIME_UP': { ar: 'الوقت خلص', en: 'Time is up' },
  'ERRORS.EXAMS.NOT_FOUND': { ar: 'الامتحان ده مش موجود', en: 'This exam does not exist' },
  'ERRORS.EXAMS.NOT_STARTED': { ar: 'انت مبدأتش الامتحان ده', en: 'You have not started this exam' },
  'ERRORS.STUDENT_AUTH.CARD_NOT_FOUND': { ar: 'الكارت ده مش معروف — اتأكد إنه كارتك واسأل المدرس', en: 'This card isn’t recognised — make sure it’s yours and ask your teacher' },
  'ERRORS.STUDENT_AUTH.CLAIM_EXPIRED': { ar: 'المسحة خلص وقتها — امسح الكارت تاني', en: 'The scan expired — scan the card again' },
  'ERRORS.STUDENT_AUTH.USERNAME_TAKEN': { ar: 'الاسم ده متاخد — اختار اسم تاني', en: 'That name is taken — pick another' },
  'ERRORS.STUDENT_AUTH.BAD_USERNAME': { ar: 'الاسم لازم يكون من ٣ لـ ٦٠ حرف أو رقم، أو رقم موبايلك', en: 'Use 3–60 letters, digits, dots or dashes — or your phone number' },
  'ERRORS.STUDENT_AUTH.WEAK_PASSWORD': { ar: 'كلمة السر لازم تكون ٨ حروف على الأقل', en: 'Use at least 8 characters' },
  'ERRORS.STUDENT_AUTH.BAD_CREDENTIALS': { ar: 'اسم المستخدم أو كلمة السر غلط', en: 'Wrong username or password' },
  'ERRORS.STUDENT_AUTH.LOCKED': { ar: 'محاولات كتير — استنى شوية وجرّب تاني', en: 'Too many attempts — wait a bit and try again' },
  'ERRORS.STUDENT_AUTH.SESSION_EXPIRED': { ar: 'الجلسة خلصت — ادخل تاني', en: 'Session expired — sign in again' },
  'ERRORS.STUDENT_AUTH.WRONG_PASSWORD': { ar: 'دي مش كلمة السر الحالية', en: 'That is not your current password' },
  'ERRORS.ONLINE_EXAMS.NOT_AVAILABLE': { ar: 'الامتحانات الأونلاين مش متفعّلة لحسابك', en: 'Online exams are not enabled for this account' },
  'ERRORS.GENERIC': { ar: 'حصلت مشكلة — جرّب تاني', en: 'Something went wrong — try again' },
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  lang = signal<Lang>(((localStorage.getItem(LANG_KEY) as Lang) === 'en' ? 'en' : 'ar'));

  constructor() {
    effect(() => {
      const l = this.lang();
      localStorage.setItem(LANG_KEY, l);
      document.documentElement.lang = l;
      document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    });
  }

  /** Bound as a template helper; reads the signal, so a toggle re-renders everything. */
  t = (key: string): string => DICT[key]?.[this.lang()] ?? key;

  /** t() with {name} placeholders filled in — e.g. tp('SIT.CONFIRM_UNANSWERED', { n: 3 }). */
  tp = (key: string, params: Record<string, string | number>): string =>
    Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      this.t(key),
    );

  /** An API error body → the student's language, falling back to the generic line. */
  fromError(err: any): string {
    const code = err?.error?.code;
    if (typeof code === 'string' && DICT[code]) return this.t(code);
    return this.t('ERRORS.GENERIC');
  }

  toggle(): void {
    this.lang.set(this.lang() === 'ar' ? 'en' : 'ar');
  }
}
