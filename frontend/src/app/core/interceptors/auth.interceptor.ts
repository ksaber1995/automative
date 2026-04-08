import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { SubscriptionService } from '../services/subscription.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const subscriptionService = inject(SubscriptionService);
  const token = authService.getToken();

  // Skip auth for login/register requests
  if (req.url.includes('/auth/login') || req.url.includes('/auth/register')) {
    return next(req);
  }

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

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
