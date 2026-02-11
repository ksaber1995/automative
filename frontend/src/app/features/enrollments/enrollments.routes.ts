import { Routes } from '@angular/router';

export const ENROLLMENTS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./enrollment-list/enrollment-list.component').then(m => m.EnrollmentListComponent) },
  { path: 'create', loadComponent: () => import('./enrollment-form/enrollment-form.component').then(m => m.EnrollmentFormComponent) },
  { path: ':id/edit', loadComponent: () => import('./enrollment-form/enrollment-form.component').then(m => m.EnrollmentFormComponent) },
];
