import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const USERS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./user-list/user-list.component').then(m => m.UserListComponent),
  },
  {
    path: 'create',
    canActivate: [permissionGuard('users', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.CREATE' },
    loadComponent: () => import('./user-form/user-form.component').then(m => m.UserFormComponent),
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard('users', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.EDIT' },
    loadComponent: () => import('./user-form/user-form.component').then(m => m.UserFormComponent),
  },
  {
    path: ':id',
    data: { breadcrumb: 'BREADCRUMBS.DETAIL' },
    loadComponent: () => import('./user-detail/user-detail.component').then(m => m.UserDetailComponent),
  },
];
