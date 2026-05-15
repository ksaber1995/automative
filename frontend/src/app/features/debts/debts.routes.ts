import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const DEBTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./debt-list/debt-list.component').then(
        (m) => m.DebtListComponent
      ),
  },
  {
    path: 'new',
    canActivate: [permissionGuard('debts', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.CREATE' },
    loadComponent: () =>
      import('./debt-form/debt-form.component').then(
        (m) => m.DebtFormComponent
      ),
  },
  {
    path: 'edit/:id',
    canActivate: [permissionGuard('debts', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.EDIT' },
    loadComponent: () =>
      import('./debt-form/debt-form.component').then(
        (m) => m.DebtFormComponent
      ),
  },
  {
    path: ':id/payment',
    canActivate: [permissionGuard('debts', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.DEBT_PAYMENT' },
    loadComponent: () =>
      import('./debt-payment/debt-payment.component').then(
        (m) => m.DebtPaymentComponent
      ),
  },
  {
    path: ':id',
    data: { breadcrumb: 'BREADCRUMBS.DETAIL' },
    loadComponent: () =>
      import('./debt-list/debt-list.component').then(
        (m) => m.DebtListComponent
      ),
  },
];
