import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { permissionGuard, roleGuard, notTeacherGuard } from './core/guards/permission.guard';
import { LayoutComponent } from './core/layout/layout.component';
import { UserRole } from '@shared/enums/user-role.enum';

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
    // Public, unauthenticated student profile reached by scanning a student's
    // QR code. Mounted here (outside LayoutComponent + authGuard) so it has no
    // app chrome and requires no login. The :qrToken is the only credential.
    path: 'p/s/:qrToken',
    loadComponent: () => import('./features/public/public-student/public-student.component').then(m => m.PublicStudentComponent)
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
        data: { breadcrumb: 'BREADCRUMBS.BRANCHES' },
        loadChildren: () => import('./features/branches/branches.routes').then(m => m.BRANCHES_ROUTES)
      },
      {
        path: 'courses',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.COURSES' },
        loadChildren: () => import('./features/courses/courses.routes').then(m => m.COURSES_ROUTES)
      },
      {
        path: 'monthly-subscriptions',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.MONTHLY_SUBSCRIPTIONS' },
        loadComponent: () => import('./features/monthly-subscriptions/monthly-subscriptions-dashboard/monthly-subscriptions-dashboard.component').then(m => m.MonthlySubscriptionsDashboardComponent)
      },
      {
        path: 'master-courses',
        canActivate: [permissionGuard('academy'), notTeacherGuard],
        data: { breadcrumb: 'BREADCRUMBS.MASTER_COURSES' },
        loadChildren: () => import('./features/master-courses/master-courses.routes').then(m => m.MASTER_COURSES_ROUTES)
      },
      {
        path: 'levels',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.LEVELS' },
        loadComponent: () => import('./features/levels/level-list/level-list.component').then(m => m.LevelListComponent)
      },
      {
        path: 'events',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.EVENTS' },
        loadChildren: () => import('./features/events/events.routes').then(m => m.EVENTS_ROUTES)
      },
      {
        path: 'exams',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.EXAMS' },
        loadChildren: () => import('./features/exams/exams.routes').then(m => m.EXAMS_ROUTES)
      },
      {
        path: 'classes',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.CLASSES' },
        loadComponent: () => import('./features/courses/class-list/class-list.component').then(m => m.ClassListComponent)
      },
      {
        path: 'classes/create',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.CLASSES_CREATE' },
        loadComponent: () => import('./features/courses/class-form/class-form.component').then(m => m.ClassFormComponent)
      },
      {
        path: 'classes/:id',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.CLASSES_DETAIL' },
        loadComponent: () => import('./features/courses/class-detail/class-detail.component').then(m => m.ClassDetailComponent)
      },
      {
        path: 'students',
        canActivate: [permissionGuard('students')],
        data: { breadcrumb: 'BREADCRUMBS.STUDENTS' },
        loadChildren: () => import('./features/students/students.routes').then(m => m.STUDENTS_ROUTES)
      },
      {
        path: 'enrollments',
        canActivate: [permissionGuard('enrollments')],
        data: { breadcrumb: 'BREADCRUMBS.ENROLLMENTS' },
        loadChildren: () => import('./features/enrollments/enrollments.routes').then(m => m.ENROLLMENTS_ROUTES)
      },
      {
        path: 'employees',
        canActivate: [permissionGuard('employees')],
        data: { breadcrumb: 'BREADCRUMBS.EMPLOYEES' },
        loadChildren: () => import('./features/employees/employees.routes').then(m => m.EMPLOYEES_ROUTES)
      },
      {
        path: 'revenues',
        canActivate: [permissionGuard('revenues')],
        data: { breadcrumb: 'BREADCRUMBS.REVENUES' },
        loadChildren: () => import('./features/revenues/revenues.routes').then(m => m.revenuesRoutes)
      },
      {
        path: 'expenses',
        canActivate: [permissionGuard('expenses')],
        data: { breadcrumb: 'BREADCRUMBS.EXPENSES' },
        loadChildren: () => import('./features/expenses/expenses.routes').then(m => m.EXPENSES_ROUTES)
      },
      {
        path: 'reports',
        canActivate: [permissionGuard('reports')],
        data: { breadcrumb: 'BREADCRUMBS.REPORTS' },
        loadChildren: () => import('./features/reports/reports.routes').then(m => m.REPORTS_ROUTES)
      },
      {
        path: 'refunds',
        canActivate: [permissionGuard('refunds')],
        data: { breadcrumb: 'BREADCRUMBS.REFUNDS' },
        loadChildren: () => import('./features/refunds/refunds.routes').then(m => m.REFUNDS_ROUTES)
      },
      {
        path: 'dues',
        canActivate: [permissionGuard('enrollments')],
        data: { breadcrumb: 'BREADCRUMBS.DUES' },
        loadChildren: () => import('./features/dues/dues.routes').then(m => m.DUES_ROUTES)
      },
      {
        path: 'debts',
        canActivate: [permissionGuard('debts')],
        data: { breadcrumb: 'BREADCRUMBS.DEBTS' },
        loadChildren: () => import('./features/debts/debts.routes').then(m => m.DEBTS_ROUTES)
      },
      {
        path: 'products',
        canActivate: [permissionGuard('products')],
        data: { breadcrumb: 'BREADCRUMBS.PRODUCTS' },
        loadChildren: () => import('./features/products/products.routes').then(m => m.PRODUCTS_ROUTES)
      },
      {
        path: 'educational-books',
        canActivate: [permissionGuard('product_sales')],
        data: { breadcrumb: 'BREADCRUMBS.EDUCATIONAL_BOOKS' },
        loadChildren: () => import('./features/educational-books/educational-books.routes').then(m => m.EDUCATIONAL_BOOKS_ROUTES)
      },
      {
        path: 'users',
        canActivate: [permissionGuard('users')],
        data: { breadcrumb: 'BREADCRUMBS.USERS' },
        loadChildren: () => import('./features/users/users.routes').then(m => m.USERS_ROUTES)
      },
      {
        path: 'rooms',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.ROOMS' },
        loadComponent: () => import('./features/rooms/room-list/room-list.component').then(m => m.RoomListComponent)
      },
      {
        path: 'sessions',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.SESSIONS' },
        loadComponent: () => import('./features/rooms/sessions-dashboard/sessions-dashboard.component').then(m => m.SessionsDashboardComponent)
      },
      {
        path: 'sessions/:id/attendance',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.SESSIONS' },
        loadComponent: () => import('./features/rooms/session-attendance/session-attendance.component').then(m => m.SessionAttendanceComponent)
      },
      {
        path: 'timetable',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.TIMETABLE' },
        loadComponent: () => import('./features/timetable/timetable.component').then(m => m.TimetableComponent)
      },
      {
        path: 'attendance/teachers',
        canActivate: [permissionGuard('academy')],
        data: { breadcrumb: 'BREADCRUMBS.ATTENDANCE_TEACHERS' },
        loadComponent: () => import('./features/attendance/teacher-attendance-list/teacher-attendance-list.component').then(m => m.TeacherAttendanceListComponent)
      },
      {
        path: 'cash',
        canActivate: [permissionGuard('cash')],
        data: { breadcrumb: 'BREADCRUMBS.CASH' },
        loadChildren: () => import('./features/cash/cash.routes').then(m => m.CASH_ROUTES)
      },
      {
        path: 'settings',
        canActivate: [roleGuard([UserRole.GLOBAL_ADMIN, UserRole.ADMIN, UserRole.BRANCH_ADMIN])],
        data: { breadcrumb: 'BREADCRUMBS.SETTINGS' },
        loadComponent: () => import('./features/settings/settings.component').then(m => m.SettingsComponent)
      },
      {
        path: 'company-profile',
        data: { breadcrumb: 'BREADCRUMBS.COMPANY_PROFILE' },
        loadComponent: () => import('./features/company-profile/company-profile.component').then(m => m.CompanyProfileComponent)
      },
      {
        path: 'whatsapp-templates',
        data: { breadcrumb: 'BREADCRUMBS.WHATSAPP_TEMPLATES' },
        loadComponent: () => import('./features/whatsapp-templates/whatsapp-templates.component').then(m => m.WhatsappTemplatesComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: '/dashboard'
  }
];
