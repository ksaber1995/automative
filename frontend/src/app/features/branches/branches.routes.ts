import { Routes } from '@angular/router';

export const BRANCHES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./branch-list/branch-list.component').then(m => m.BranchListComponent)
  },
  {
    path: 'create',
    loadComponent: () => import('./branch-form/branch-form.component').then(m => m.BranchFormComponent)
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./branch-form/branch-form.component').then(m => m.BranchFormComponent)
  }
];
