import { Routes } from '@angular/router';

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
    loadComponent: () =>
      import('./debt-form/debt-form.component').then(
        (m) => m.DebtFormComponent
      ),
  },
  {
    path: 'edit/:id',
    loadComponent: () =>
      import('./debt-form/debt-form.component').then(
        (m) => m.DebtFormComponent
      ),
  },
  {
    path: ':id/payment',
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
