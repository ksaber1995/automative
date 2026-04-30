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
    loadComponent: () =>
      import('./debt-form/debt-form.component').then(
        (m) => m.DebtFormComponent
      ),
  },
  {
    path: 'edit/:id',
    canActivate: [permissionGuard('debts', 'write')],
    loadComponent: () =>
      import('./debt-form/debt-form.component').then(
        (m) => m.DebtFormComponent
      ),
  },
  {
    path: ':id/payment',
    canActivate: [permissionGuard('debts', 'write')],
    loadComponent: () =>
      import('./debt-payment/debt-payment.component').then(
        (m) => m.DebtPaymentComponent
      ),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./debt-list/debt-list.component').then(
        (m) => m.DebtListComponent
      ),
  },
];
