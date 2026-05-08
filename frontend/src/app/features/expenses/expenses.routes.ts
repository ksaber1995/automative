import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const EXPENSES_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./expense-list/expense-list.component').then(m => m.ExpenseListComponent) },
  { path: 'salaries', canActivate: [permissionGuard('expenses', 'write')], loadComponent: () => import('./salaries/salaries.component').then(m => m.SalariesComponent) },
  { path: 'manage-recurring', canActivate: [permissionGuard('expenses', 'write')], loadComponent: () => import('./manage-recurring/manage-recurring.component').then(m => m.ManageRecurringComponent) },
  { path: 'installments', loadComponent: () => import('./installments/installment-list.component').then(m => m.InstallmentListComponent) },
  { path: 'installments/new', canActivate: [permissionGuard('expenses', 'write')], loadComponent: () => import('./installments/installment-form.component').then(m => m.InstallmentFormComponent) },
  { path: 'installments/:id', loadComponent: () => import('./installments/installment-detail.component').then(m => m.InstallmentDetailComponent) },
  { path: 'create', canActivate: [permissionGuard('expenses', 'write')], loadComponent: () => import('./expense-form/expense-form.component').then(m => m.ExpenseFormComponent) },
  { path: ':id/edit', canActivate: [permissionGuard('expenses', 'write')], loadComponent: () => import('./expense-form/expense-form.component').then(m => m.ExpenseFormComponent) },
  { path: ':id', loadComponent: () => import('./expense-detail/expense-detail.component').then(m => m.ExpenseDetailComponent) }
];
