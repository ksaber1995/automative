import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { permissionGuard } from './core/guards/permission.guard';
import { LayoutComponent } from './core/layout/layout.component';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/dashboard',
    pathMatch: 'full'
  },
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES)
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        canActivate: [permissionGuard('dashboard')],
        loadChildren: () => import('./features/dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES)
      },
      {
        path: 'branches',
        canActivate: [permissionGuard('branches')],
        loadChildren: () => import('./features/branches/branches.routes').then(m => m.BRANCHES_ROUTES)
      },
      {
        path: 'courses',
        canActivate: [permissionGuard('courses')],
        loadChildren: () => import('./features/courses/courses.routes').then(m => m.COURSES_ROUTES)
      },
      {
        path: 'master-courses',
        canActivate: [permissionGuard('master_courses')],
        loadChildren: () => import('./features/master-courses/master-courses.routes').then(m => m.MASTER_COURSES_ROUTES)
      },
      {
        path: 'events',
        canActivate: [permissionGuard('events')],
        loadChildren: () => import('./features/events/events.routes').then(m => m.EVENTS_ROUTES)
      },
      {
        path: 'classes',
        canActivate: [permissionGuard('classes')],
        loadComponent: () => import('./features/courses/class-list/class-list.component').then(m => m.ClassListComponent)
      },
      {
        path: 'classes/create',
        canActivate: [permissionGuard('classes')],
        loadComponent: () => import('./features/courses/class-form/class-form.component').then(m => m.ClassFormComponent)
      },
      {
        path: 'classes/:id',
        canActivate: [permissionGuard('classes')],
        loadComponent: () => import('./features/courses/class-detail/class-detail.component').then(m => m.ClassDetailComponent)
      },
      {
        path: 'students',
        canActivate: [permissionGuard('students')],
        loadChildren: () => import('./features/students/students.routes').then(m => m.STUDENTS_ROUTES)
      },
      {
        path: 'enrollments',
        canActivate: [permissionGuard('enrollments')],
        loadChildren: () => import('./features/enrollments/enrollments.routes').then(m => m.ENROLLMENTS_ROUTES)
      },
      {
        path: 'employees',
        canActivate: [permissionGuard('employees')],
        loadChildren: () => import('./features/employees/employees.routes').then(m => m.EMPLOYEES_ROUTES)
      },
      {
        path: 'revenues',
        canActivate: [permissionGuard('revenues')],
        loadChildren: () => import('./features/revenues/revenues.routes').then(m => m.revenuesRoutes)
      },
      {
        path: 'expenses',
        canActivate: [permissionGuard('expenses')],
        loadChildren: () => import('./features/expenses/expenses.routes').then(m => m.EXPENSES_ROUTES)
      },
      {
        path: 'reports',
        canActivate: [permissionGuard('reports')],
        loadChildren: () => import('./features/reports/reports.routes').then(m => m.REPORTS_ROUTES)
      },
      {
        path: 'withdrawals',
        canActivate: [permissionGuard('withdrawals')],
        loadChildren: () => import('./features/withdrawals/withdrawals.routes').then(m => m.WITHDRAWALS_ROUTES)
      },
      {
        path: 'refunds',
        canActivate: [permissionGuard('refunds')],
        loadChildren: () => import('./features/refunds/refunds.routes').then(m => m.REFUNDS_ROUTES)
      },
      {
        path: 'dues',
        loadChildren: () => import('./features/dues/dues.routes').then(m => m.DUES_ROUTES)
      },
      {
        path: 'debts',
        canActivate: [permissionGuard('debts')],
        loadChildren: () => import('./features/debts/debts.routes').then(m => m.DEBTS_ROUTES)
      },
      {
        path: 'products',
        canActivate: [permissionGuard('products')],
        loadChildren: () => import('./features/products/products.routes').then(m => m.PRODUCTS_ROUTES)
      },
      {
        path: 'users',
        canActivate: [permissionGuard('users')],
        loadChildren: () => import('./features/users/users.routes').then(m => m.USERS_ROUTES)
      },
      {
        path: 'rooms',
        loadComponent: () => import('./features/rooms/room-list/room-list.component').then(m => m.RoomListComponent)
      },
      {
        path: 'sessions',
        loadComponent: () => import('./features/rooms/sessions-dashboard/sessions-dashboard.component').then(m => m.SessionsDashboardComponent)
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings.component').then(m => m.SettingsComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: '/dashboard'
  }
];
