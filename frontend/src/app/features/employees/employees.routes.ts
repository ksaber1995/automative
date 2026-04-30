import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const EMPLOYEES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./employee-list/employee-list.component').then(m => m.EmployeeListComponent)
  },
  {
    path: 'create',
    canActivate: [permissionGuard('employees', 'write')],
    loadComponent: () => import('./employee-form/employee-form.component').then(m => m.EmployeeFormComponent)
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard('employees', 'write')],
    loadComponent: () => import('./employee-form/employee-form.component').then(m => m.EmployeeFormComponent)
  },
  {
    path: ':id',
    loadComponent: () => import('./employee-detail/employee-detail.component').then(m => m.EmployeeDetailComponent)
  }
];
