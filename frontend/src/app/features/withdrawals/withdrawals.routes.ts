import { Routes } from '@angular/router';

export const WITHDRAWALS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./withdrawal-list/withdrawal-list.component').then(
        (m) => m.WithdrawalListComponent
      ),
  },
  {
    path: 'new',
    loadComponent: () =>
      import('./withdrawal-form/withdrawal-form.component').then(
        (m) => m.WithdrawalFormComponent
      ),
  },
  {
    path: 'edit/:id',
    loadComponent: () =>
      import('./withdrawal-form/withdrawal-form.component').then(
        (m) => m.WithdrawalFormComponent
      ),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./withdrawal-list/withdrawal-list.component').then(
        (m) => m.WithdrawalListComponent
      ),
  },
];
