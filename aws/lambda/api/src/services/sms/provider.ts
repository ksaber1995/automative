import { getSecret } from '../../utils/secrets';

/**
 * The gateway, behind one interface.
 *
 * Written against SMSMisr because that is what was chosen, but every Egyptian
 * aggregator (Victory Link, Connekio, …) is the same shape: an HTTP POST with
 * account credentials, a registered sender ID, the number and the body. Swapping
 * one for another should be a new `SmsProvider` in this file and one line in
 * `getSmsProvider`, with nothing above this layer changing.
 */

export interface SmsSendResult {
  /** The gateway accepted it. Delivery is still asynchronous and not guaranteed. */
  accepted: boolean;
  /** The gateway's own id, for chasing a message up later. */
  providerMessageId: string | null;
  /** Raw code the gateway returned, kept verbatim for support conversations. */
  providerCode: string | null;
  error: string | null;
}

export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string): Promise<SmsSendResult>;
}

/**
 * Platform credentials, one account for everyone. Tenants are entitled via
 * `companies.sms_activated`, not by holding their own keys — see the SMS
 * section in admin/README.md.
 *
 * The secret exists from the first deploy with blank fields, so its presence
 * proves nothing; `isSmsConfigured` is what says whether we can actually send.
 */
export interface SmsPlatformConfig {
  provider?: string;
  username?: string;
  password?: string;
  /** The registered alphanumeric sender ID. Egypt requires this to be pre-approved. */
  sender?: string;
  /** SMSMisr: '1' live, '2' test. Test accepts and bills nothing. */
  environment?: string;
}

export async function getSmsPlatformConfig(): Promise<SmsPlatformConfig> {
  const secretArn = process.env.SMS_PLATFORM_SECRET_ARN;
  if (!secretArn) throw new Error('SMS_PLATFORM_SECRET_ARN not set');
  return await getSecret(secretArn);
}

/** True once real credentials have been pasted in. */
export function isSmsConfigured(config: SmsPlatformConfig): boolean {
  return !!(config?.username && config?.password && config?.sender);
}

/**
 * SMSMisr's REST endpoint.
 *
 * `language: 2` is Arabic (UCS-2). Sending Arabic as language 1 does not fail —
 * it delivers mojibake, which is worse, so the language is chosen from the body
 * rather than configured.
 */
class SmsMisrProvider implements SmsProvider {
  readonly name = 'smsmisr';

  constructor(private config: SmsPlatformConfig) {}

  async send(to: string, body: string): Promise<SmsSendResult> {
    const isArabic = /[؀-ۿ]/.test(body);
    const payload = {
      environment: this.config.environment || '1',
      username: this.config.username,
      password: this.config.password,
      sender: this.config.sender,
      mobile: to,
      language: isArabic ? '2' : '1',
      message: body,
    };

    try {
      const res = await fetch('https://smsmisr.com/api/SMS/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // A gateway that has stopped answering must not hold a Lambda open until
        // it times out — the caller is a person waiting on a click.
        signal: AbortSignal.timeout(15_000),
      });

      const text = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { /* some errors come back as plain text */ }

      // 1901 is "success". Every other code is a refusal with its own meaning,
      // kept verbatim rather than flattened to "failed" — the difference between
      // "out of credit" and "sender ID not approved" is the difference between
      // topping up and a week with support.
      const code = parsed?.code != null ? String(parsed.code) : null;
      if (res.ok && code === '1901') {
        return {
          accepted: true,
          providerMessageId: parsed?.SMSID != null ? String(parsed.SMSID) : null,
          providerCode: code,
          error: null,
        };
      }

      return {
        accepted: false,
        providerMessageId: null,
        providerCode: code,
        error: parsed?.message || text?.slice(0, 300) || `HTTP ${res.status}`,
      };
    } catch (e: any) {
      return {
        accepted: false,
        providerMessageId: null,
        providerCode: null,
        error: e?.name === 'TimeoutError' ? 'The SMS gateway did not respond' : (e?.message || 'SMS gateway request failed'),
      };
    }
  }
}

/**
 * A provider that refuses to send, used when no credentials have been pasted in
 * yet. Deliberately not a silent no-op: a message that was never sent must be
 * recorded as FAILED with a reason, or the tenant sees "sent" for something
 * nobody received.
 */
class UnconfiguredProvider implements SmsProvider {
  readonly name = 'none';
  async send(): Promise<SmsSendResult> {
    return {
      accepted: false,
      providerMessageId: null,
      providerCode: null,
      error: 'No SMS gateway credentials are configured for the platform.',
    };
  }
}

export async function getSmsProvider(): Promise<SmsProvider> {
  const config = await getSmsPlatformConfig().catch(() => ({} as SmsPlatformConfig));
  if (!isSmsConfigured(config)) return new UnconfiguredProvider();

  switch ((config.provider || 'smsmisr').toLowerCase()) {
    case 'smsmisr':
    default:
      return new SmsMisrProvider(config);
  }
}
