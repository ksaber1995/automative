/**
 * Standard error response shape for the API.
 *
 * Every error returned by a route should carry a `code` — a stable, dotted
 * i18n key like `ERRORS.BRANCHES.NOT_FOUND`. The frontend's error interceptor
 * runs that key through ngx-translate so the user sees the message in the
 * locale they picked. `message` stays as an English fallback (logs, dev
 * tools, third-party API consumers).
 */

import { isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

export type ApiErrorBody = { message: string; code?: string };

export type ApiErrorResponse<S extends number = number> = {
  status: S;
  body: ApiErrorBody;
};

/** Convenience constructor for catalogued errors. */
export function apiError<S extends number>(
  status: S,
  code: string,
  message: string
): ApiErrorResponse<S> {
  return { status, body: { message, code } };
}

/**
 * Funnel a thrown error from inside a route handler into a stable response.
 * Recognises the auth/subscription guard errors thrown by `extractTenantContext`
 * and friends, and otherwise returns the caller-supplied fallback code/status.
 *
 * Use it inside `catch (error) { ... }` blocks:
 *   return mapThrownError(error, 'ERRORS.STUDENTS.CREATE_FAILED', 'Failed to create student', 400);
 */
export function mapThrownError(
  error: any,
  fallbackCode: string,
  fallbackMessage: string,
  fallbackStatus: number = 500
) {
  if (isSubscriptionError(error)) {
    return apiError(402, 'ERRORS.SUBSCRIPTION.REQUIRED', error?.message || 'Subscription required');
  }
  if (isAuthError(error)) {
    return apiError(401, 'ERRORS.UNAUTHORIZED', error?.message || 'Unauthorized');
  }
  return apiError(fallbackStatus, fallbackCode, error?.message || fallbackMessage);
}

/**
 * Read `Accept-Language` off an incoming request. Returns 'ar' when the
 * header explicitly asks for Arabic (handles values like "ar", "ar-EG",
 * "ar,en;q=0.9"), otherwise 'en'. The backend rarely needs this — it only
 * matters for text the backend itself originates (emails, exports) since
 * snackbar/error wording is translated on the frontend via the `code`.
 */
export function getRequestLang(
  headers: Record<string, string | undefined> | undefined
): 'en' | 'ar' {
  if (!headers) return 'en';
  const raw =
    headers['accept-language'] ??
    headers['Accept-Language'] ??
    headers['ACCEPT-LANGUAGE'];
  if (typeof raw !== 'string' || raw.length === 0) return 'en';
  const first = raw.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('ar') ? 'ar' : 'en';
}
