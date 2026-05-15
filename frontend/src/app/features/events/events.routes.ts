import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const EVENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./event-list/event-list.component').then((m) => m.EventListComponent),
  },
  {
    path: 'create',
    canActivate: [permissionGuard('academy', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.CREATE' },
    loadComponent: () =>
      import('./event-form/event-form.component').then((m) => m.EventFormComponent),
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard('academy', 'write')],
    data: { breadcrumb: 'BREADCRUMBS.EDIT' },
    loadComponent: () =>
      import('./event-form/event-form.component').then((m) => m.EventFormComponent),
  },
  {
    path: ':id',
    data: { breadcrumb: 'BREADCRUMBS.DETAIL' },
    loadComponent: () =>
      import('./event-detail/event-detail.component').then((m) => m.EventDetailComponent),
  },
];
