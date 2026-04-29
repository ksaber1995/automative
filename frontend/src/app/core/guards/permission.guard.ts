import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PermissionResource } from '@shared/interfaces/permissions.interface';

/** Ordered list of routes to try when redirecting to first accessible page */
const ROUTE_PERMISSION_MAP: Array<{ path: string; resource: PermissionResource }> = [
  { path: '/dashboard',   resource: 'dashboard' },
  { path: '/branches',    resource: 'branches' },
  { path: '/courses',     resource: 'courses' },
  { path: '/classes',     resource: 'classes' },
  { path: '/rooms',       resource: 'rooms' },
  { path: '/sessions',    resource: 'sessions' },
  { path: '/timetable',   resource: 'timetable' },
  { path: '/students',    resource: 'students' },
  { path: '/enrollments', resource: 'enrollments' },
  { path: '/employees',   resource: 'employees' },
  { path: '/revenues',    resource: 'revenues' },
  { path: '/expenses',    resource: 'expenses' },
  { path: '/withdrawals', resource: 'withdrawals' },
  { path: '/refunds',     resource: 'refunds' },
  { path: '/debts',       resource: 'debts' },
  { path: '/products',    resource: 'products' },
  { path: '/reports',     resource: 'reports' },
];

function getFirstAccessiblePath(authService: AuthService): string {
  for (const entry of ROUTE_PERMISSION_MAP) {
    if (authService.canRead(entry.resource)) {
      return entry.path;
    }
  }
  return '/auth/login';
}

/**
 * Route guard factory. Checks that the current user has `read` access to the
 * given resource. If not, redirects to the first route the user CAN access.
 */
export const permissionGuard = (resource: PermissionResource) => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (!authService.isAuthenticated()) {
      router.navigate(['/auth/login']);
      return false;
    }

    if (authService.canRead(resource)) {
      return true;
    }

    const firstPath = getFirstAccessiblePath(authService);
    router.navigate([firstPath]);
    return false;
  };
};
