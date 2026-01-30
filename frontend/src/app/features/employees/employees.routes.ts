import { Routes } from '@angular/router';

export const EMPLOYEES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./employee-list/employee-list.component').then(m => m.EmployeeListComponent)
  },
  {
    path: 'create',
    loadComponent: () => import('./employee-form/employee-form.component').then(m => m.EmployeeFormComponent)
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./employee-form/employee-form.component').then(m => m.EmployeeFormComponent)
  }
];
