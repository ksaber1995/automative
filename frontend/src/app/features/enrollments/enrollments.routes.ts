import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const ENROLLMENTS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./enrollment-list/enrollment-list.component').then(m => m.EnrollmentListComponent) },
  { path: 'create', canActivate: [permissionGuard('enrollments', 'write')], loadComponent: () => import('./enrollment-form/enrollment-form.component').then(m => m.EnrollmentFormComponent) },
  { path: ':id/edit', canActivate: [permissionGuard('enrollments', 'write')], loadComponent: () => import('./enrollment-form/enrollment-form.component').then(m => m.EnrollmentFormComponent) },
];
