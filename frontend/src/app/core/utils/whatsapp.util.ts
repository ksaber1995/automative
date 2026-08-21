/**
 * Click-to-chat (wa.me) helpers.
 *
 * Messages are sent from each staff member's OWN WhatsApp number: we only build
 * a https://wa.me/<number>?text=<body> deep link and open it. The staff device,
 * already logged into their number, opens with the message pre-filled — they tap
 * Send. No server-side sending, no Meta API, no per-number registration.
 */

export type WhatsappTemplateType =
  | 'QR_STUDENT'
  | 'FOLLOWUP_PARENT'
  | 'ABSENCE'
  | 'PAYMENT_DELAY'
  | 'EXAM_RESULTS';

export const WHATSAPP_TEMPLATE_TYPES: WhatsappTemplateType[] = [
  'QR_STUDENT',
  'FOLLOWUP_PARENT',
  'ABSENCE',
  'PAYMENT_DELAY',
  'EXAM_RESULTS',
];

/** Default Arabic bodies — mirrors DEFAULT_WHATSAPP_TEMPLATES on the backend. */
export const DEFAULT_WHATSAPP_TEMPLATES: Record<WhatsappTemplateType, string> = {
  QR_STUDENT:
    'مرحباً {studentName}، هذا رابط كود الـ QR الخاص بك في {academyName}:\n{link}\n\nكود الطالب: {code}\nاستخدمه للحضور إذا لم تكن البطاقة معك.',
  FOLLOWUP_PARENT:
    'رسالة من {academyName}:\n\nعزيزي ولي أمر الطالب {studentName}، يمكنك متابعة بيانات وحضور ابنك/ابنتك عبر الرابط التالي:\n{link}',
  ABSENCE:
    'رسالة من {academyName}:\n\nعزيزي {parentName}، لقد تغيب ابنك/ابنتك {studentName} اليوم عن حصة {className} ({courseName}) - الحصة رقم {sessionNumber} بتاريخ {date}. يرجى الحرص على الحضور المنتظم.',
  PAYMENT_DELAY:
    'رسالة من {academyName}:\n\nعزيزي {studentName}، دفعتك بقيمة {amount} {currency} لمادة {courseName} كانت مستحقة بتاريخ {dueDate}. يرجى التسديد في أقرب وقت ممكن.',
  EXAM_RESULTS:
    'رسالة من {academyName}:\n\nعزيزي {parentName}، حصل {studentName} على {grade}/{maxGrade} ({percentage}%) في امتحان {examName} لمادة {courseName}.',
};

/**
 * The dial code assumed for locally-written numbers ('20' Egypt, '966' Saudi
 * Arabia…). Set at login from the signed-in user's registration country code —
 * AuthService.publishUser is the single writer — because student/parent phones
 * are free-text fields typed the way the academy's country writes them locally.
 * '20' matches the old hardcoded default, so a session with no country code
 * behaves exactly as before.
 */
let defaultDialCode = '20';

export function setWhatsappDialCode(code: string | null | undefined): void {
  const digits = String(code ?? '').replace(/\D/g, '');
  if (digits) defaultDialCode = digits;
}

/**
 * Normalize a phone number to a wa.me-ready international number (digits only,
 * no leading +). A number already written internationally ('+9665…' or
 * '009665…') is trusted as-is; otherwise it is treated as local to the
 * tenant's country: trunk leading zero stripped, dial code prefixed when
 * absent. Returns '' when there are no usable digits.
 */
export function toWhatsappNumber(phone: string | null | undefined, dialCode?: string): string {
  const raw = String(phone ?? '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // '+…' or '00…' is an explicit international prefix — no local number starts
  // with a double zero, only one trunk zero — so the dial code is already there.
  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.replace(/^0+/, '');
  const code = String(dialCode ?? defaultDialCode).replace(/\D/g, '') || '20';
  digits = digits.replace(/^0+/, '');
  if (!digits) return '';
  if (!digits.startsWith(code)) digits = code + digits;
  return digits;
}

/**
 * What a sports academy calls each template variable, mapped to the canonical
 * name the code fills in.
 *
 * The chips on the messaging page are meant to be copied into the message body,
 * so whatever is shown there has to substitute. Renaming the chip alone would
 * hand a coach `{traineeName}` and then render it as an empty string.
 *
 * An alias, not a rename: every template already saved says `{studentName}`, and
 * those bodies keep working untouched. Resolution runs alias → canonical only,
 * so nothing here can shadow a real variable.
 */
export const SPORTS_TEMPLATE_ALIASES: Record<string, string> = {
  traineeName: 'studentName',
  sportName: 'courseName',
  groupName: 'className',
  trainingNumber: 'sessionNumber',
  evaluationName: 'examName',
};

/** The name to SHOW for a variable, given the tenant's vocabulary. */
export function templateVarLabel(canonical: string, isSports: boolean): string {
  if (!isSports) return canonical;
  const alias = Object.entries(SPORTS_TEMPLATE_ALIASES).find(([, c]) => c === canonical);
  return alias ? alias[0] : canonical;
}

/**
 * Substitute {placeholder} tokens. Missing/empty values render as ''.
 *
 * A token the caller did not supply is tried again under its canonical name, so
 * a body written with the sports variables renders from the same data.
 */
export function renderWhatsappTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return body.replace(/\{(\w+)\}/g, (_, key) => {
    let v = vars[key];
    if (v === undefined || v === null) {
      const canonical = SPORTS_TEMPLATE_ALIASES[key];
      if (canonical) v = vars[canonical];
    }
    return v === undefined || v === null ? '' : String(v);
  });
}

/**
 * Open a WhatsApp chat to `phone` pre-filled with `text`.
 * Returns false (and opens nothing) when the phone has no usable digits.
 */
export function openWhatsappChat(
  phone: string | null | undefined,
  text: string,
  dialCode?: string,
): boolean {
  const number = toWhatsappNumber(phone, dialCode);
  if (!number) return false;
  const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
  return true;
}
