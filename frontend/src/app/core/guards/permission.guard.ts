import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PermissionResource, PermissionAction } from '@shared/interfaces/permissions.interface';

/** Ordered list of routes to try when redirecting to first accessible page */
// NOTE: /branches is deliberately absent. It now guards on `academy`, so listing
// it here against the `branches` resource would hand a branches-only user
// /branches as their landing page — which its own guard would then bounce, back
// into this same lookup, forever. Anyone with academy read lands on /courses.
const ROUTE_PERMISSION_MAP: Array<{ path: string; resource: PermissionResource }> = [
  { path: '/dashboard',   resource: 'dashboard' },
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
 * Blocks TEACHER companies from academy-only features (e.g. master courses).
 * Redirects them to the first route they can access.
 */
export const notTeacherGuard = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/auth/login']);
    return false;
  }

  if (authService.isTeacher()) {
    router.navigate([getFirstAccessiblePath(authService)]);
    return false;
  }

  return true;
};

/**
 * The cash drawer is an Advanced-plan academy feature. A Basic academy (and any
 * teacher tenant) does not have it at all, so the URL is blocked the same way the
 * sidebar entry is hidden — see `AuthService.canUseCash`.
 */
export const cashGuard = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/auth/login']);
    return false;
  }

  if (!authService.canUseCash()) {
    router.navigate([getFirstAccessiblePath(authService)]);
    return false;
  }

  return true;
};

/**
 * Vendor-only guard for the QR card pool. Admits the debugging login
 * (master@master.com) and the vendor's own test tenants, so the page is reachable
 * from the accounts we test prod with. The matching sidebar entry hides on the
 * same check; this stops a direct URL. Anyone else is bounced to their first
 * accessible page, exactly like the other guards.
 */
export const qrPoolGuard = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/auth/login']);
    return false;
  }

  if (authService.canSeeQrCardPool()) {
    return true;
  }

  router.navigate([getFirstAccessiblePath(authService)]);
  return false;
};

/**
 * Online exams (Lessons, question banks, and later the exams themselves) are
 * switched on per tenant from the admin console. A tenant without the flag does
 * not have the feature at all, so the URL is blocked the same way the sidebar
 * entry is hidden — see `AuthService.canUseOnlineExams`. The API refuses the
 * endpoints on the same flag.
 */
export const onlineExamsGuard = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/auth/login']);
    return false;
  }

  if (authService.canUseOnlineExams()) {
    return true;
  }

  router.navigate([getFirstAccessiblePath(authService)]);
  return false;
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
