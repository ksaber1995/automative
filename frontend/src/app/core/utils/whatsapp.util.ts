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
    'مرحباً {studentName}، هذا رابط كود الـ QR الخاص بك في {academyName}:\n{link}',
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
 * Normalize a local phone number to a wa.me-ready international number
 * (digits only, no leading +). Defaults to Egypt (dial code 20): strips the
 * trunk leading zero and prefixes the dial code when absent.
 * Returns '' when there are no usable digits.
 */
export function toWhatsappNumber(phone: string | null | undefined, dialCode = '20'): string {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  digits = digits.replace(/^0+/, '');
  if (!digits) return '';
  if (!digits.startsWith(dialCode)) digits = dialCode + digits;
  return digits;
}

/** Substitute {placeholder} tokens. Missing/empty values render as ''. */
export function renderWhatsappTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return body.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
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
  dialCode = '20',
): boolean {
  const number = toWhatsappNumber(phone, dialCode);
  if (!number) return false;
  const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
  return true;
}
