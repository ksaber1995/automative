import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes, UrlTree } from '@angular/router';
import { StudentAuthService } from './auth/student-auth.service';
import { WelcomeComponent } from './welcome.component';
import { ScanComponent } from './scan.component';
import { ClaimComponent } from './claim.component';
import { LoginComponent } from './login.component';
import { ExamsComponent } from './exams.component';
import { ExamSitComponent } from './exam-sit.component';
import { ExamResultComponent } from './exam-result.component';
import { ResultsComponent } from './results.component';

/**
 * Signed-in pages. The check is only "is a token present" — if it is stale the
 * first API call 401s and the interceptor routes back to /login, so there is no
 * async session resolution to wait on here.
 */
const authGuard: CanActivateFn = (): boolean | UrlTree => {
  const auth = inject(StudentAuthService);
  const router = inject(Router);
  return auth.signedIn() ? true : router.parseUrl('/');
};

/** /claim is only reachable with a live scan in hand; a reload means rescanning. */
const claimGuard: CanActivateFn = (): boolean | UrlTree => {
  const auth = inject(StudentAuthService);
  const router = inject(Router);
  return auth.claim() ? true : router.parseUrl('/scan');
};

export const routes: Routes = [
  { path: '', component: WelcomeComponent, title: 'بوابة الامتحانات · Netrofit' },
  { path: 'scan', component: ScanComponent, title: 'بوابة الامتحانات · Netrofit' },
  { path: 'claim', component: ClaimComponent, canActivate: [claimGuard], title: 'بوابة الامتحانات · Netrofit' },
  { path: 'login', component: LoginComponent, title: 'بوابة الامتحانات · Netrofit' },
  { path: 'exams', component: ExamsComponent, canActivate: [authGuard], title: 'بوابة الامتحانات · Netrofit' },
  { path: 'exams/:examId/sit', component: ExamSitComponent, canActivate: [authGuard], title: 'بوابة الامتحانات · Netrofit' },
  { path: 'exams/:examId/result', component: ExamResultComponent, canActivate: [authGuard], title: 'بوابة الامتحانات · Netrofit' },
  { path: 'results', component: ResultsComponent, canActivate: [authGuard], title: 'بوابة الامتحانات · Netrofit' },
  { path: '**', redirectTo: '' },
];
