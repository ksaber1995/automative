import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const EXPENSES_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./expense-list/expense-list.component').then(m => m.ExpenseListComponent) },
  { path: 'salaries', canActivate: [permissionGuard('expenses', 'write')], data: { breadcrumb: 'BREADCRUMBS.SALARIES' }, loadComponent: () => import('./salaries/salaries.component').then(m => m.SalariesComponent) },
  { path: 'salaries/percentage/:employeeId', canActivate: [permissionGuard('expenses')], data: { breadcrumb: 'BREADCRUMBS.SALARIES' }, loadComponent: () => import('./salaries/percentage-detail.component').then(m => m.PercentageDetailComponent) },
  { path: 'manage-recurring', canActivate: [permissionGuard('expenses', 'write')], data: { breadcrumb: 'BREADCRUMBS.MANAGE_RECURRING' }, loadComponent: () => import('./manage-recurring/manage-recurring.component').then(m => m.ManageRecurringComponent) },
  { path: 'installments', data: { breadcrumb: 'BREADCRUMBS.INSTALLMENTS' }, loadComponent: () => import('./installments/installment-list.component').then(m => m.InstallmentListComponent) },
  { path: 'installments/new', canActivate: [permissionGuard('expenses', 'write')], data: { breadcrumb: 'BREADCRUMBS.CREATE' }, loadComponent: () => import('./installments/installment-form.component').then(m => m.InstallmentFormComponent) },
  { path: 'installments/:id', data: { breadcrumb: 'BREADCRUMBS.DETAIL' }, loadComponent: () => import('./installments/installment-detail.component').then(m => m.InstallmentDetailComponent) },
  { path: 'create', canActivate: [permissionGuard('expenses', 'write')], data: { breadcrumb: 'BREADCRUMBS.CREATE' }, loadComponent: () => import('./expense-form/expense-form.component').then(m => m.ExpenseFormComponent) },
  { path: ':id/edit', canActivate: [permissionGuard('expenses', 'write')], data: { breadcrumb: 'BREADCRUMBS.EDIT' }, loadComponent: () => import('./expense-form/expense-form.component').then(m => m.ExpenseFormComponent) },
  { path: ':id', data: { breadcrumb: 'BREADCRUMBS.DETAIL' }, loadComponent: () => import('./expense-detail/expense-detail.component').then(m => m.ExpenseDetailComponent) }
];
