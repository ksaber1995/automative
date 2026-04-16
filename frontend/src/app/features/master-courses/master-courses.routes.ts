import { Routes } from '@angular/router';

export const MASTER_COURSES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./master-course-list/master-course-list.component').then(
        (m) => m.MasterCourseListComponent
      ),
  },
  {
    path: 'create',
    loadComponent: () =>
      import('./master-course-form/master-course-form.component').then(
        (m) => m.MasterCourseFormComponent
      ),
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('./master-course-form/master-course-form.component').then(
        (m) => m.MasterCourseFormComponent
      ),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./master-course-detail/master-course-detail.component').then(
        (m) => m.MasterCourseDetailComponent
      ),
  },
];
