import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { StudentAuthService } from './student-auth.service';

/** The auth endpoints establish a session; they never carry one. */
const NO_TOKEN = ['/claim-start', '/claim-finish', '/login'];

/**
 * Attach the student token to every API call, and treat any 401 as the end of
 * the session — the token expired (12h TTL), the credential was revoked, or the
 * student was deactivated. All of them mean the same thing to the UI: back to
 * the login screen, with the saved answers safe on the server.
 */
export const studentAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(StudentAuthService);
  const router = inject(Router);

  const isAuthCall = NO_TOKEN.some((p) => req.url.endsWith(p));
  const token = auth.token();
  const outgoing = token && !isAuthCall
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(outgoing).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !isAuthCall) {
        auth.clear();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
