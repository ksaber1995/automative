import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { NotificationService } from '../services/notification.service';
import { Router } from '@angular/router';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  // Pass static-asset fetches straight through — no toast for a missing
  // i18n file, no chance of a circular load during ngx-translate's init.
  if (req.url.includes('/assets/') || req.url.startsWith('assets/')) {
    return next(req);
  }

  const notificationService = inject(NotificationService);
  const translate = inject(TranslateService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const isAuthEndpoint = req.url.includes('/auth/login') || req.url.includes('/auth/register');
      const serverCode: string | undefined = error.error?.code;
      const serverMessage: string | undefined = error.error?.message;

      // A 404 from the public QR lookups is an ordinary outcome, not a failure:
      // the page probes /public/students/:token first and falls back to
      // /public/cards/:token to see whether the token is an unassigned pool card.
      // Both misses are rendered as a full-page state by the component, so a
      // toast on top of that is noise — and on the fallback path it was an
      // outright lie, since the page went on to resolve the card successfully.
      const isPublicQrLookup =
        req.url.includes('/public/students/') || req.url.includes('/public/cards/');
      if (isPublicQrLookup && error.status === 404) {
        return throwError(() => error);
      }

      // Structured 409 responses (course/master-course deactivation blockers) carry
      // a list of blockers under `classes` or `courses`. The calling component will
      // render a richer dialog with links, so we skip the generic toast here.
      const hasStructuredBlockers =
        error.status === 409 &&
        (Array.isArray(error.error?.classes) || Array.isArray(error.error?.courses));
      if (hasStructuredBlockers) {
        return throwError(() => error);
      }

      let errorMessage: string;

      if (error.error instanceof ErrorEvent) {
        // Client-side error (network, CORS preflight)
        errorMessage = error.error.message;
      } else if (serverCode) {
        // Server returned a translation key — let ngx-translate render it in
        // the user's current language. ngx-translate returns the key itself
        // when no translation exists, in which case we fall back to the
        // server's English message.
        // `params` let the server's key name the thing it is about — which
        // class took the room, say — while still reading in the user's language.
        const translated = translate.instant(serverCode, error.error?.params);
        errorMessage = translated === serverCode
          ? (serverMessage || translated)
          : translated;
      } else if (serverMessage) {
        errorMessage = serverMessage;
      } else {
        // No code, no message — translate a generic per-status fallback.
        const fallbackKey =
          error.status === 401 ? 'ERRORS.UNAUTHORIZED' :
          error.status === 403 ? 'ERRORS.FORBIDDEN' :
          error.status === 404 ? 'ERRORS.NOT_FOUND' :
          error.status === 500 ? 'ERRORS.SERVER' :
                                 'ERRORS.GENERIC';
        errorMessage = translate.instant(fallbackKey);
      }

      if (error.status === 401 && !isAuthEndpoint) {
        router.navigate(['/auth/login']);
      }

      notificationService.error(errorMessage);
      return throwError(() => error);
    })
  );
};
