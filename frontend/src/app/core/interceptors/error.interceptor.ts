import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { Router } from '@angular/router';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notificationService = inject(NotificationService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let errorMessage = 'An error occurred';
      const isAuthEndpoint = req.url.includes('/auth/login') || req.url.includes('/auth/register');

      if (error.error instanceof ErrorEvent) {
        // Client-side error
        errorMessage = error.error.message;
      } else {
        // Server-side error
        errorMessage = error.error?.message || error.message || `Error Code: ${error.status}`;

        // Handle specific error codes
        if (error.status === 401 && !isAuthEndpoint) {
          // Only redirect to login for 401 errors that are NOT from auth endpoints
          errorMessage = 'Unauthorized. Please login again.';
          router.navigate(['/auth/login']);
        } else if (error.status === 401 && isAuthEndpoint) {
          // For auth endpoints, just show the error message from the server
          errorMessage = error.error?.message || 'Authentication failed.';
        } else if (error.status === 403) {
          errorMessage = 'You do not have permission to perform this action.';
        } else if (error.status === 404) {
          errorMessage = 'Resource not found.';
        } else if (error.status === 500) {
          errorMessage = 'Internal server error. Please try again later.';
        }
      }

      notificationService.error(errorMessage);
      return throwError(() => error);
    })
  );
};
