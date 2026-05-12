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

// Google error codes that mean "the token itself is bad" — forged, replayed,
// expired, or missing. These are real signals we should reject on.
const HARD_FAIL_CODES = new Set([
  'missing-input-response',
  'invalid-input-response',
  'timeout-or-duplicate',
  'bad-request',
  'missing-input-secret',
  'invalid-input-secret',
]);

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

  console.log('[recaptcha] google response', {
    success: data?.success,
    score: data?.score,
    action: data?.action,
    hostname: data?.hostname,
    errorCodes: data?.['error-codes'],
  });

  if (!data?.success) {
    const codes: string[] = Array.isArray(data?.['error-codes']) ? data['error-codes'] : [];
    // Only reject when at least one code is a real token-integrity failure.
    // Transient codes like `browser-error` (undocumented, returned when
    // Google itself couldn't render/score in the user's browser — CSP, older
    // browsers, network glitches) shouldn't take legitimate registrations
    // down. We soft-fail those the same way we soft-fail network errors.
    const isHardFail = codes.some((c) => HARD_FAIL_CODES.has(c));
    if (!isHardFail) {
      console.warn('[recaptcha] transient error from Google, allowing through:', codes);
      return { ok: true };
    }
    const detail = codes.length ? ` (${codes.join(', ')})` : '';
    return { ok: false, reason: `reCAPTCHA verification failed${detail}. Please try again.` };
  }

  // v3 actions are advisory — log mismatches but don't reject. The score is
  // the authoritative signal.
  if (options.expectedAction && data.action && data.action !== options.expectedAction) {
    console.warn('[recaptcha] action mismatch (advisory)', {
      expected: options.expectedAction,
      got: data.action,
    });
  }

  if (typeof data.score === 'number' && data.score < MIN_SCORE) {
    console.warn('[recaptcha] score below threshold', { score: data.score, threshold: MIN_SCORE });
    return { ok: false, reason: 'Suspicious activity detected. Please try again.' };
  }

  return { ok: true };
}
