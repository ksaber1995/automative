import { TsRestHttpError } from '@ts-rest/serverless';
import { getClientIp } from '../utils/request-context';

/**
 * In-memory sliding-window rate limiter.
 *
 * Limitations (accepted trade-off — chosen to avoid new infra):
 *   - Each warm Lambda container keeps its own counters. An attacker who
 *     spreads load across N containers gets ~N× the limit. AWS API Gateway
 *     usage plans + WAF are the proper second layer for stricter caps.
 *   - Counters are lost on cold start (acceptable: bursty attackers don't
 *     cold-start the container faster than they hit it).
 *
 * The window is "fixed" — each key is bucketed by the integer
 * floor(now / windowMs). Simpler than a true sliding window and cheap; the
 * worst case is 2× the budget at a window boundary, which is fine for our
 * use cases.
 */

export interface RateLimitBucket {
  /** Stable identifier used in logs and the bucket map. */
  name: string;
  /** Maximum hits per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const RATE_LIMITS = {
  // Per-IP cap on unauthenticated auth endpoints (login / register /
  // verify-phone / resend-otp). Protects against credential stuffing and
  // mass registration from a single IP.
  AUTH_IP: { name: 'auth:ip', limit: 60, windowMs: 15 * 60_000 },

  // Per-email cap on register / forgot-password style flows. Stops an
  // attacker from spamming targeted account-creation or recovery emails for
  // a known address even if they rotate IPs.
  AUTH_EMAIL: { name: 'auth:email', limit: 30, windowMs: 15 * 60_000 },

  // Demo-lead / public contact form submissions. Tight — these are
  // unauthenticated and there is no legitimate burst.
  PUBLIC_FORM_IP: { name: 'public-form:ip', limit: 10, windowMs: 60 * 60_000 },

  // Per-authenticated-user cap across all endpoints. The reports/analytics
  // pages fan out 25–35 parallel calls per reload (one per chart × compare-
  // mode branches), and a power user re-filtering a few times in a minute
  // can burn through a low limit fast. Sized to comfortably cover that
  // workload while still flagging a runaway client.
  AUTHED_USER: { name: 'authed:user', limit: 4000, windowMs: 15 * 60_000 },

  // Per-company cap so one tenant can't monopolize the Lambda's burst
  // budget. Scales with team size — bump if a real company hits it.
  AUTHED_COMPANY: { name: 'authed:company', limit: 15000, windowMs: 15 * 60_000 },
} as const satisfies Record<string, RateLimitBucket>;

interface Counter {
  /** Number of hits in the current window. */
  count: number;
  /** Epoch ms at which the window resets (and the entry can be evicted). */
  resetAt: number;
}

/** Per-bucket maps so unrelated buckets can't collide on the same key. */
const counters: Map<string, Map<string, Counter>> = new Map();

/** Lazy cleanup runs at most once every CLEANUP_INTERVAL_MS. */
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = 0;

function getBucketMap(bucketName: string): Map<string, Counter> {
  let m = counters.get(bucketName);
  if (!m) {
    m = new Map();
    counters.set(bucketName, m);
  }
  return m;
}

function maybeCleanup(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const map of counters.values()) {
    for (const [k, v] of map) {
      if (v.resetAt <= now) map.delete(k);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (ceiled, min 1). */
  retryAfter: number;
  limit: number;
  remaining: number;
}

/**
 * Increments the counter for `key` in `bucket`. Returns the current state
 * after the increment. Does not throw — callers decide how to react.
 */
export function consume(bucket: RateLimitBucket, key: string): RateLimitResult {
  const now = Date.now();
  maybeCleanup(now);

  const map = getBucketMap(bucket.name);
  let entry = map.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + bucket.windowMs };
    map.set(key, entry);
  }
  entry.count += 1;

  const remaining = Math.max(bucket.limit - entry.count, 0);
  const retryAfter = Math.max(Math.ceil((entry.resetAt - now) / 1000), 1);

  return {
    allowed: entry.count <= bucket.limit,
    retryAfter,
    limit: bucket.limit,
    remaining,
  };
}

/**
 * Checks the limit and throws `TsRestHttpError(429)` if exceeded. ts-rest
 * propagates the status code straight through to the API Gateway response,
 * so we don't need to enumerate 429 in every contract entry.
 *
 * Pass `key = null` to skip the check (e.g., when the IP can't be
 * determined for a request that arrived without standard headers).
 */
export function enforce(bucket: RateLimitBucket, key: string | null | undefined): void {
  if (!key) return;
  const result = consume(bucket, key);
  if (result.allowed) return;
  console.warn('[rate-limit] blocked', {
    bucket: bucket.name,
    key,
    limit: result.limit,
    retryAfter: result.retryAfter,
  });
  throw new TsRestHttpError(
    429,
    {
      message: 'Too many requests. Please slow down and try again later.',
      retryAfter: result.retryAfter,
    },
    'application/json',
  );
}

/** Convenience for endpoints that want to limit by the current client IP. */
export function enforceByIp(bucket: RateLimitBucket): void {
  enforce(bucket, getClientIp());
}

/**
 * Test-only helper. Resets every bucket so tests can run in isolation.
 * Never call from production code.
 */
export function __resetForTests(): void {
  counters.clear();
  lastCleanup = 0;
}
