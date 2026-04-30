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
    loadComponent: () => import('./user-form/user-form.component').then(m => m.UserFormComponent),
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard('users', 'write')],
    loadComponent: () => import('./user-form/user-form.component').then(m => m.UserFormComponent),
  },
  {
    path: ':id',
    loadComponent: () => import('./user-detail/user-detail.component').then(m => m.UserDetailComponent),
  },
];
