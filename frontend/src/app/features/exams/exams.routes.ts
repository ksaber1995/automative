import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const EXAMS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./exam-list/exam-list.component').then((m) => m.ExamListComponent),
  },
  {
    path: 'create',
    canActivate: [permissionGuard('academy', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.CREATE' },
    loadComponent: () =>
      import('./exam-form/exam-form.component').then((m) => m.ExamFormComponent),
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard('academy', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.EDIT' },
    loadComponent: () =>
      import('./exam-form/exam-form.component').then((m) => m.ExamFormComponent),
  },
  {
    path: ':id',
    data: { breadcrumb: 'BREADCRUMBS.DETAIL' },
    loadComponent: () =>
      import('./exam-detail/exam-detail.component').then((m) => m.ExamDetailComponent),
  },
];
