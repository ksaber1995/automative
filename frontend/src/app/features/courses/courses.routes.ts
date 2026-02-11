import { Routes } from '@angular/router';

export const COURSES_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./course-list/course-list.component').then(m => m.CourseListComponent) },
  { path: 'create', loadComponent: () => import('./course-form/course-form.component').then(m => m.CourseFormComponent) },
  { path: ':id/edit', loadComponent: () => import('./course-form/course-form.component').then(m => m.CourseFormComponent) },
  { path: ':id', loadComponent: () => import('./course-detail/course-detail.component').then(m => m.CourseDetailComponent) },
  { path: ':courseId/classes', loadComponent: () => import('./class-list/class-list.component').then(m => m.ClassListComponent) },
  { path: ':courseId/classes/create', loadComponent: () => import('./class-form/class-form.component').then(m => m.ClassFormComponent) },
  { path: ':courseId/classes/:id/edit', loadComponent: () => import('./class-form/class-form.component').then(m => m.ClassFormComponent) }
];
