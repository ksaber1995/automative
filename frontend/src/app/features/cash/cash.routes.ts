import { Routes } from '@angular/router';

export const CASH_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./cash-management/cash-management.component').then(
        (m) => m.CashManagementComponent
      ),
  },
];
