// Google reCAPTCHA v3 server-side verification.
//
// Reads `RECAPTCHA_V3_SECRET_KEY` from the Lambda environment. If the secret
// is missing (dev), verification is skipped so registration / lead-capture
// still works without provisioned reCAPTCHA credentials — and any failure
// from Google's API is treated as a soft-fail (warn + allow) to avoid taking
// the registration flow down if reCAPTCHA itself is having an outage.

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

// reCAPTCHA v3 returns a score in [0.0, 1.0]. We reject below the threshold.
// 0.5 is Google's recommended default for human-vs-bot.
const MIN_SCORE = 0.5;

export interface RecaptchaVerifyOptions {
  /** Optional action string to assert ("register", "demo_lead", etc.). */
  expectedAction?: string;
  /** Optional client IP for Google's risk analysis. */
  remoteIp?: string | null;
}

export async function verifyRecaptcha(
  token: string | undefined | null,
  options: RecaptchaVerifyOptions = {}
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const secret = process.env.RECAPTCHA_V3_SECRET_KEY;

  if (!secret) {
    console.log('[recaptcha] RECAPTCHA_V3_SECRET_KEY not set — skipping verification');
    return { ok: true };
  }

  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'reCAPTCHA token is required.' };
  }

  const params = new URLSearchParams({ secret, response: token });
  if (options.remoteIp) params.set('remoteip', options.remoteIp);

  let data: any;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    data = await res.json();
  } catch (err) {
    console.warn('[recaptcha] verification request failed, allowing through:', err);
    return { ok: true };
  }

  if (!data?.success) {
    console.warn('[recaptcha] verification failed', data);
    return { ok: false, reason: 'reCAPTCHA verification failed. Please try again.' };
  }

  if (options.expectedAction && data.action && data.action !== options.expectedAction) {
    console.warn('[recaptcha] action mismatch', { expected: options.expectedAction, got: data.action });
    return { ok: false, reason: 'reCAPTCHA verification failed. Please try again.' };
  }

  if (typeof data.score === 'number' && data.score < MIN_SCORE) {
    console.warn('[recaptcha] score below threshold', { score: data.score });
    return { ok: false, reason: 'Suspicious activity detected. Please try again.' };
  }

  return { ok: true };
}
