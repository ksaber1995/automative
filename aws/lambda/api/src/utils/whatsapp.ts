import https from 'https';

async function metaSend(templateName: string, to: string, params: string[]): Promise<void> {
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID || '';
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN || '';

  if (!phoneNumberId || !accessToken) {
    console.log(`[WhatsApp DEV] to=${to} template=${templateName} params=${params.join(',')}`);
    return;
  }

  const payload = JSON.stringify({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: params.map(text => ({ type: 'text', text })),
        },
      ],
    },
  });

  return new Promise((resolve, reject) => {
    const options: import('https').RequestOptions = {
      hostname: 'graph.facebook.com',
      path: `/v21.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Meta API error ${res.statusCode}: ${data}`));
        } else {
          resolve();
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export async function sendWhatsappOtp(
  countryCode: string,
  phone: string,
  otp: string,
  firstName: string
): Promise<void> {
  const to = `${countryCode}${phone}`;
  const template = process.env.META_WHATSAPP_OTP_TEMPLATE || 'netrofit_otp';
  // Template body: "Hi {{1}}, your Netrofit verification code is {{2}}. Valid for 15 minutes."
  await metaSend(template, to, [firstName, otp]);
}

export async function sendWhatsappPasswordResetOtp(
  countryCode: string,
  phone: string,
  otp: string,
  firstName: string
): Promise<void> {
  const to = `${countryCode}${phone}`;
  const template = process.env.META_WHATSAPP_RESET_TEMPLATE || 'netrofit_reset_otp';
  // Template body: "Hi {{1}}, your Netrofit password reset code is {{2}}. Valid for 15 minutes."
  await metaSend(template, to, [firstName, otp]);
}
