import { Routes } from '@angular/router';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent)
  },
  // Separate registration entry points per account type (no in-form dropdown).
  {
    path: 'register/academy',
    data: { accountType: 'ACADEMY' },
    loadComponent: () => import('./register/register.component').then(m => m.RegisterComponent)
  },
  {
    path: 'register/teacher',
    data: { accountType: 'TEACHER' },
    loadComponent: () => import('./register/register.component').then(m => m.RegisterComponent)
  },
  // A sports academy IS an academy on the advanced plan — same features, same
  // gates. All that differs is the vocabulary it is served, so it rides on the
  // academy flow with a vertical rather than being an account type of its own.
  {
    path: 'register/sports-academy',
    data: { accountType: 'ACADEMY', vertical: 'SPORTS' },
    loadComponent: () => import('./register/register.component').then(m => m.RegisterComponent)
  },
  // Legacy /auth/register → default to the academy flow.
  {
    path: 'register',
    redirectTo: 'register/academy',
    pathMatch: 'full'
  },
  {
    path: 'verify-email',
    loadComponent: () => import('./verify-email/verify-email.component').then(m => m.VerifyEmailComponent)
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent)
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./reset-password/reset-password.component').then(m => m.ResetPasswordComponent)
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  }
];
