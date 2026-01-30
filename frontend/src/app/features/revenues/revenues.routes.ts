import { Routes } from '@angular/router';

export const REVENUES_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./revenue-list/revenue-list.component').then(m => m.RevenueListComponent) }
];
