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
    data: { breadcrumb: 'BREADCRUMBS.CREATE' },
    loadComponent: () => import('./employee-form/employee-form.component').then(m => m.EmployeeFormComponent)
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard('employees', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.EDIT' },
    loadComponent: () => import('./employee-form/employee-form.component').then(m => m.EmployeeFormComponent)
  },
  {
    path: ':id',
    data: { breadcrumb: 'BREADCRUMBS.DETAIL' },
    loadComponent: () => import('./employee-detail/employee-detail.component').then(m => m.EmployeeDetailComponent)
  }
];
