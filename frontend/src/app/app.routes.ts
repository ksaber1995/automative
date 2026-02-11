import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
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
        loadChildren: () => import('./features/dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES)
      },
      {
        path: 'branches',
        loadChildren: () => import('./features/branches/branches.routes').then(m => m.BRANCHES_ROUTES)
      },
      {
        path: 'courses',
        loadChildren: () => import('./features/courses/courses.routes').then(m => m.COURSES_ROUTES)
      },
      {
        path: 'classes',
        loadComponent: () => import('./features/courses/class-list/class-list.component').then(m => m.ClassListComponent)
      },
      {
        path: 'students',
        loadChildren: () => import('./features/students/students.routes').then(m => m.STUDENTS_ROUTES)
      },
      {
        path: 'enrollments',
        loadChildren: () => import('./features/enrollments/enrollments.routes').then(m => m.ENROLLMENTS_ROUTES)
      },
      {
        path: 'employees',
        loadChildren: () => import('./features/employees/employees.routes').then(m => m.EMPLOYEES_ROUTES)
      },
      {
        path: 'revenues',
        loadChildren: () => import('./features/revenues/revenues.routes').then(m => m.revenuesRoutes)
      },
      {
        path: 'expenses',
        loadChildren: () => import('./features/expenses/expenses.routes').then(m => m.EXPENSES_ROUTES)
      },
      {
        path: 'reports',
        loadChildren: () => import('./features/reports/reports.routes').then(m => m.REPORTS_ROUTES)
      },
      {
        path: 'withdrawals',
        loadChildren: () => import('./features/withdrawals/withdrawals.routes').then(m => m.WITHDRAWALS_ROUTES)
      },
      {
        path: 'debts',
        loadChildren: () => import('./features/debts/debts.routes').then(m => m.DEBTS_ROUTES)
      },
      {
        path: 'products',
        loadChildren: () => import('./features/products/products.routes').then(m => m.PRODUCTS_ROUTES)
      }
    ]
  },
  {
    path: '**',
    redirectTo: '/dashboard'
  }
];
