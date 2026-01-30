import { Routes } from '@angular/router';

export const STUDENTS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./student-list/student-list.component').then(m => m.StudentListComponent) }
];
