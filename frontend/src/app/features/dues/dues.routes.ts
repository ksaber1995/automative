import { Routes } from '@angular/router';

export const DUES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./dues-list/dues-list.component').then(m => m.DuesListComponent),
  },
];
