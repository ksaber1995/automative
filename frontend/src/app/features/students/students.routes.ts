import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const STUDENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./student-list/student-list.component').then(m => m.StudentListComponent)
  },
  {
    path: 'create',
    canActivate: [permissionGuard('students', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.CREATE' },
    loadComponent: () => import('./student-form/student-form.component').then(m => m.StudentFormComponent)
  },
  {
    path: ':id',
    data: { breadcrumb: 'BREADCRUMBS.DETAIL' },
    loadComponent: () => import('./student-detail/student-detail.component').then(m => m.StudentDetailComponent)
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard('students', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.EDIT' },
    loadComponent: () => import('./student-form/student-form.component').then(m => m.StudentFormComponent)
  }
];
