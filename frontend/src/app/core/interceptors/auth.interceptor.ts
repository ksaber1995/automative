import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { SubscriptionService } from '../services/subscription.service';
import { LanguageService } from '../services/language.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Static-asset fetches (e.g. ngx-translate loading ./assets/i18n/*.json) must
  // bypass this interceptor entirely. Injecting LanguageService here while it's
  // mid-construction creates a circular DI — LanguageService's constructor is
  // what triggers the asset fetch in the first place — and Arabic silently
  // fails to load on bootstrap.
  if (req.url.includes('/assets/') || req.url.startsWith('assets/')) {
    return next(req);
  }

  const authService = inject(AuthService);
  const subscriptionService = inject(SubscriptionService);
  const languageService = inject(LanguageService);
  const token = authService.getToken();

  // Attach current UI language so the backend can localize anything it owns
  // (emails, scheduled jobs) and so the frontend's error interceptor can fall
  // back to the same locale when the server emits a translation code.
  const lang = languageService.currentLang();

  // Skip auth for login/register and public (unauthenticated) endpoints, but
  // still send the language. The public student-profile page is reached with
  // no session, and we must never attach a stale token or trigger a logout
  // from it.
  if (
    req.url.includes('/auth/login') ||
    req.url.includes('/auth/register') ||
    req.url.includes('/public/')
  ) {
    return next(req.clone({ setHeaders: { 'Accept-Language': lang } }));
  }

  const headers: Record<string, string> = { 'Accept-Language': lang };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const authReq = req.clone({ setHeaders: headers });

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        authService.logout();
      }
      if (error.status === 402) {
        // Force subscription signals to trigger blocked state
        const current = subscriptionService.subscription();
        const message: string = error.error?.message || '';
        if (current) {
          if (message.includes('Trial')) {
            subscriptionService.subscription.set({ ...current, status: 'TRIAL', trialEndDate: '2000-01-01' });
          } else {
            subscriptionService.subscription.set({ ...current, subscriptionEndDate: '2000-01-01' });
          }
        }
      }
      return throwError(() => error);
    })
  );
};
