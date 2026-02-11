import { Routes } from '@angular/router';

export const revenuesRoutes: Routes = [
  {
    path: '',
    redirectTo: 'list',
    pathMatch: 'full'
  },
  {
    path: 'list',
    loadComponent: () =>
      import('./revenue-list/revenue-list.component').then(m => m.RevenueListComponent),
    title: 'Revenue List'
  }
];
