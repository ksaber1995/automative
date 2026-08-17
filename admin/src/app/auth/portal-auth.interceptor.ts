import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { PortalAuthService } from './portal-auth.service';

/**
 * Attach the portal token to every admin-API call, and treat a 401 as "the
 * session is over".
 *
 * The login call is excluded from BOTH halves: it has no token to send, and its
 * 401 means "wrong password" — clearing the session there would be harmless but
 * the shell would flip to a fresh login page and swallow the error message the
 * user needs to read.
 */
export const portalAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(PortalAuthService);
  const isLogin = req.url.endsWith('/portal/login');

  const token = auth.token();
  const authed = token && !isLogin
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authed).pipe(
    catchError((err: unknown) => {
      if (!isLogin && err instanceof HttpErrorResponse && err.status === 401) {
        auth.clear();
      }
      return throwError(() => err);
    }),
  );
};
