// WhatsApp Cloud API helper for sending OTP messages.
//
// Configuration via env vars on the Lambda:
//   WHATSAPP_TOKEN              — Bearer access token from Meta WhatsApp Business
//   WHATSAPP_PHONE_NUMBER_ID    — phone number ID issued by Meta
//   WHATSAPP_OTP_TEMPLATE       — name of the approved authentication template
//                                 (defaults to "verification_code")
//   WHATSAPP_OTP_TEMPLATE_LANG  — template language code (defaults to "en")
//
// If WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are missing the OTP is logged
// to CloudWatch instead of being sent — useful in dev so registration still
// works without provisioned WhatsApp credentials.

const GRAPH_VERSION = 'v20.0';

export async function sendOtpWhatsApp(
  countryCode: string,
  phone: string,
  otp: string
): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE || 'verification_code';
  const templateLang = process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en';

  const recipient = `${countryCode}${phone}`.replace(/\D/g, '');

  if (!token || !phoneNumberId) {
    console.log(
      `[WhatsApp OTP] Credentials not configured — would send OTP ${otp} to +${recipient}`
    );
    return;
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLang },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: otp }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: otp }],
        },
      ],
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(
      `WhatsApp API error ${res.status}: ${errorText || res.statusText}`
    );
  }
}

// Strip non-digits and any single leading "0" from a phone string.
// Used both when normalizing input on register (we never want to store "01097…")
// and when matching login identifiers ("01097628565" → "1097628565").
export function normalizeLocalPhone(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  return digits.startsWith('0') ? digits.slice(1) : digits;
}

// Strip non-digits and a leading "+" from a country code ("+20" → "20").
export function normalizeCountryCode(input: string): string {
  return (input || '').replace(/\D/g, '');
}
