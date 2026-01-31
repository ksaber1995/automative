import { Routes } from '@angular/router';

export const COURSES_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./course-list/course-list.component').then(m => m.CourseListComponent) },
  { path: ':id', loadComponent: () => import('./course-detail/course-detail.component').then(m => m.CourseDetailComponent) },
  { path: ':courseId/classes/new', loadComponent: () => import('./class-form/class-form.component').then(m => m.ClassFormComponent) },
  { path: ':courseId/classes/edit/:id', loadComponent: () => import('./class-form/class-form.component').then(m => m.ClassFormComponent) }
];
