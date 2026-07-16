// ============================================================
// Meta Graph API client for WhatsApp Cloud.
//
// Everything that talks to Meta lives here so the route handlers stay readable
// and there is one place to bump the API version. Node 20 has global fetch, so
// no HTTP dependency is needed.
// ============================================================

// Meta pins behaviour per version and deprecates old ones on a ~2 year clock, so
// this is deliberately a single constant rather than sprinkled through URLs.
// Overridable by env for the case where a version has to change without a code
// deploy. Bumping it is a real change — read Meta's changelog first.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** A Graph API call that came back with an error payload. */
export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly metaCode?: number,
    readonly metaSubcode?: number,
    readonly metaType?: string,
  ) {
    super(message);
    this.name = 'MetaGraphError';
  }
}

/**
 * Meta answers with HTTP 200 and an `error` object about as often as it uses a
 * real status code, so both are checked. The message is what a tenant sees when
 * a send fails, and Meta's own text ("Message failed to send because more than
 * 24 hours have passed...") is far better than anything invented here.
 */
async function graphRequest(path: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<any> {
  const { query, ...requestInit } = init;
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), requestInit);
  } catch (networkError: any) {
    // The Lambda sits in PRIVATE_WITH_EGRESS; if the NAT path is broken this is
    // where it shows up, and it is worth not confusing with a Meta rejection.
    throw new MetaGraphError(`Could not reach Meta: ${networkError?.message || 'network error'}`, 502);
  }

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body: an edge/proxy error page rather than the API itself.
    throw new MetaGraphError(`Meta returned a non-JSON response (HTTP ${response.status})`, response.status);
  }

  if (!response.ok || payload?.error) {
    const err = payload?.error || {};
    throw new MetaGraphError(
      err.message || `Meta request failed (HTTP ${response.status})`,
      response.status,
      err.code,
      err.error_subcode,
      err.type,
    );
  }

  return payload;
}

/**
 * Exchange the Embedded Signup authorisation code for the tenant's access token.
 *
 * This token is scoped to the tenant's WABA and is long-lived — Meta does not
 * hand back a refresh token, so it is stored as-is and only replaced when the
 * tenant reconnects.
 */
export async function exchangeCodeForToken(appId: string, appSecret: string, code: string): Promise<string> {
  const data = await graphRequest('/oauth/access_token', {
    method: 'GET',
    query: { client_id: appId, client_secret: appSecret, code },
  });
  if (!data?.access_token) {
    throw new MetaGraphError('Meta did not return an access token for that code', 502);
  }
  return data.access_token;
}

/**
 * The WABA ids a token actually grants access to.
 *
 * Embedded Signup normally hands the waba_id to the browser directly, but that
 * value arrives from the client and is not to be trusted on its own — a tenant
 * could name someone else's WABA. Reading it back from the token is how the
 * claim gets checked. It is also the fallback when the browser message is missed.
 */
export async function getWabaIdsForToken(appId: string, appSecret: string, token: string): Promise<string[]> {
  const data = await graphRequest('/debug_token', {
    method: 'GET',
    query: { input_token: token, access_token: `${appId}|${appSecret}` },
  });
  const scopes = data?.data?.granular_scopes || [];
  const ids = new Set<string>();
  for (const scope of scopes) {
    if (scope?.scope === 'whatsapp_business_management' || scope?.scope === 'whatsapp_business_messaging') {
      for (const id of scope?.target_ids || []) ids.add(String(id));
    }
  }
  return [...ids];
}

export interface WaPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

/** Numbers registered under a WABA. */
export async function getPhoneNumbers(wabaId: string, token: string): Promise<WaPhoneNumber[]> {
  const data = await graphRequest(`/${wabaId}/phone_numbers`, {
    method: 'GET',
    query: { access_token: token, fields: 'id,display_phone_number,verified_name,quality_rating' },
  });
  return data?.data || [];
}

/**
 * Subscribe our app to the tenant's WABA. Without this Meta has nowhere to
 * deliver inbound messages or delivery receipts for this tenant — the webhook is
 * subscribed per WABA, not once globally, so connecting a tenant is incomplete
 * until this call succeeds.
 */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
  await graphRequest(`/${wabaId}/subscribed_apps`, {
    method: 'POST',
    query: { access_token: token },
  });
}

export interface SendTextArgs {
  phoneNumberId: string;
  token: string;
  to: string;
  text: string;
}

export interface SendTemplateArgs {
  phoneNumberId: string;
  token: string;
  to: string;
  templateName: string;
  language: string;
  /** Positional {{1}}, {{2}}… values for the template body. */
  bodyParams?: string[];
}

/** wamid — Meta's message id, later matched by the webhook's status callbacks. */
function firstMessageId(data: any): string | null {
  return data?.messages?.[0]?.id || null;
}

/** Free-form text. Only legal inside the 24-hour customer service window. */
export async function sendText(args: SendTextArgs): Promise<{ messageId: string | null }> {
  const data = await graphRequest(`/${args.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: args.to,
      type: 'text',
      text: { preview_url: false, body: args.text },
    }),
  });
  return { messageId: firstMessageId(data) };
}

/** An approved template. The only thing sendable outside the 24-hour window. */
export async function sendTemplate(args: SendTemplateArgs): Promise<{ messageId: string | null }> {
  const components = args.bodyParams?.length
    ? [{ type: 'body', parameters: args.bodyParams.map((text) => ({ type: 'text', text })) }]
    : undefined;

  const data = await graphRequest(`/${args.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: args.to,
      type: 'template',
      template: {
        name: args.templateName,
        language: { code: args.language },
        ...(components ? { components } : {}),
      },
    }),
  });
  return { messageId: firstMessageId(data) };
}
