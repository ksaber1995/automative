import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const COURSES_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./course-list/course-list.component').then(m => m.CourseListComponent) },
  { path: 'create', canActivate: [permissionGuard('academy', 'write')], data: { breadcrumb: 'BREADCRUMBS.CREATE' }, loadComponent: () => import('./course-form/course-form.component').then(m => m.CourseFormComponent) },
  { path: ':id/edit', canActivate: [permissionGuard('academy', 'write')], data: { breadcrumb: 'BREADCRUMBS.EDIT' }, loadComponent: () => import('./course-form/course-form.component').then(m => m.CourseFormComponent) },
  { path: ':id', data: { breadcrumb: 'BREADCRUMBS.DETAIL' }, loadComponent: () => import('./course-detail/course-detail.component').then(m => m.CourseDetailComponent) },
  { path: ':courseId/classes', canActivate: [permissionGuard('academy')], data: { breadcrumb: 'BREADCRUMBS.COURSE_CLASSES' }, loadComponent: () => import('./class-list/class-list.component').then(m => m.ClassListComponent) },
  { path: ':courseId/classes/create', canActivate: [permissionGuard('academy', 'write')], data: { breadcrumb: 'BREADCRUMBS.CLASSES_CREATE' }, loadComponent: () => import('./class-form/class-form.component').then(m => m.ClassFormComponent) },
  { path: ':courseId/classes/:id/edit', canActivate: [permissionGuard('academy', 'write')], data: { breadcrumb: 'BREADCRUMBS.CLASSES_EDIT' }, loadComponent: () => import('./class-form/class-form.component').then(m => m.ClassFormComponent) }
];
