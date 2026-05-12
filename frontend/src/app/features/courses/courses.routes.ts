import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const COURSES_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./course-list/course-list.component').then(m => m.CourseListComponent) },
  { path: 'create', canActivate: [permissionGuard('academy', 'write')], loadComponent: () => import('./course-form/course-form.component').then(m => m.CourseFormComponent) },
  { path: ':id/edit', canActivate: [permissionGuard('academy', 'write')], loadComponent: () => import('./course-form/course-form.component').then(m => m.CourseFormComponent) },
  { path: ':id', loadComponent: () => import('./course-detail/course-detail.component').then(m => m.CourseDetailComponent) },
  { path: ':courseId/classes', canActivate: [permissionGuard('academy')], loadComponent: () => import('./class-list/class-list.component').then(m => m.ClassListComponent) },
  { path: ':courseId/classes/create', canActivate: [permissionGuard('academy', 'write')], loadComponent: () => import('./class-form/class-form.component').then(m => m.ClassFormComponent) },
  { path: ':courseId/classes/:id/edit', canActivate: [permissionGuard('academy', 'write')], loadComponent: () => import('./class-form/class-form.component').then(m => m.ClassFormComponent) }
];
