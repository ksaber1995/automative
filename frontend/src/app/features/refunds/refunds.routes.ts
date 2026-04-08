import { Routes } from '@angular/router';

export const REFUNDS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./refund-list/refund-list.component').then(m => m.RefundListComponent),
  },
];
