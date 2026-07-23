import { Routes } from '@angular/router';
import { permissionGuard } from '../../../core/guards/permission.guard';

// Salaries used to live under /expenses/salaries; it is now its own sidebar
// section at /salaries. Still gated on the `expenses` permission, since salaries
// are paid as expenses under the hood.
export const SALARIES_ROUTES: Routes = [
  { path: '', canActivate: [permissionGuard('expenses', 'write')], data: { breadcrumb: 'BREADCRUMBS.SALARIES' }, loadComponent: () => import('./salaries.component').then(m => m.SalariesComponent) },
  { path: 'percentage/:employeeId', canActivate: [permissionGuard('expenses')], data: { breadcrumb: 'BREADCRUMBS.SALARIES' }, loadComponent: () => import('./percentage-detail.component').then(m => m.PercentageDetailComponent) },
];
