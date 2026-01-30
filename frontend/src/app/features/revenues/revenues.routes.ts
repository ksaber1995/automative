import { Routes } from '@angular/router';

export const REVENUES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./revenue-list/revenue-list.component').then(m => m.RevenueListComponent)
  },
  {
    path: 'create',
    loadComponent: () => import('./revenue-form/revenue-form.component').then(m => m.RevenueFormComponent)
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./revenue-form/revenue-form.component').then(m => m.RevenueFormComponent)
  }
];
