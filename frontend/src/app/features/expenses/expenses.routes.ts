import { Routes } from '@angular/router';

export const EXPENSES_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./expense-list/expense-list.component').then(m => m.ExpenseListComponent) }
];
