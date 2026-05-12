import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PermissionResource, PermissionAction } from '@shared/interfaces/permissions.interface';

/** Ordered list of routes to try when redirecting to first accessible page */
const ROUTE_PERMISSION_MAP: Array<{ path: string; resource: PermissionResource }> = [
  { path: '/dashboard',   resource: 'dashboard' },
  { path: '/branches',    resource: 'branches' },
  { path: '/courses',     resource: 'academy' },
  { path: '/students',    resource: 'students' },
  { path: '/enrollments', resource: 'enrollments' },
  { path: '/employees',   resource: 'employees' },
  { path: '/revenues',    resource: 'revenues' },
  { path: '/expenses',    resource: 'expenses' },
  { path: '/refunds',     resource: 'refunds' },
  { path: '/debts',       resource: 'debts' },
  { path: '/products',    resource: 'products' },
  { path: '/cash',        resource: 'cash' },
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
 * Route guard factory. Checks that the current user has the given action access
 * (defaults to `read`) on the resource. If not, redirects to the first route
 * the user CAN access.
 */
export const permissionGuard = (
  resource: PermissionResource,
  action: PermissionAction = 'read'
) => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (!authService.isAuthenticated()) {
      router.navigate(['/auth/login']);
      return false;
    }

    if (authService.hasPermission(resource, action)) {
      return true;
    }

    const firstPath = getFirstAccessiblePath(authService);
    router.navigate([firstPath]);
    return false;
  };
};

/**
 * Role-restricted guard. Only allows users whose role is in the allowed list.
 * Used for admin-only pages that don't map to a granular resource.
 */
export const roleGuard = (allowedRoles: string[]) => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (!authService.isAuthenticated()) {
      router.navigate(['/auth/login']);
      return false;
    }

    if (authService.hasAnyRole(allowedRoles)) {
      return true;
    }

    const firstPath = getFirstAccessiblePath(authService);
    router.navigate([firstPath]);
    return false;
  };
};
