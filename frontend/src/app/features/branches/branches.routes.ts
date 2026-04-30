import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const BRANCHES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./branch-list/branch-list.component').then(m => m.BranchListComponent)
  },
  {
    path: 'create',
    canActivate: [permissionGuard('branches', 'write')],
    loadComponent: () => import('./branch-form/branch-form.component').then(m => m.BranchFormComponent)
  },
  {
    path: ':id',
    loadComponent: () => import('./branch-detail/branch-detail.component').then(m => m.BranchDetailComponent)
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard('branches', 'write')],
    loadComponent: () => import('./branch-form/branch-form.component').then(m => m.BranchFormComponent)
  }
];
