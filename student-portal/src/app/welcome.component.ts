import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18nService } from './i18n.service';
import { StudentAuthService } from './auth/student-auth.service';

/** The signed-out front door: sign in, or first-time card scan. */
@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="card" style="text-align: center; padding-block: 36px;">
      <h1>{{ i18n.t('WELCOME.HEADING') }}</h1>
      <p class="muted">{{ i18n.t('WELCOME.SUB') }}</p>
      <a routerLink="/login" class="btn" style="text-decoration: none;">{{ i18n.t('WELCOME.SIGN_IN') }}</a>
      <a routerLink="/scan" class="btn secondary" style="text-decoration: none;">{{ i18n.t('WELCOME.FIRST_TIME') }}</a>
    </div>
  `,
})
export class WelcomeComponent {
  i18n = inject(I18nService);
  private auth = inject(StudentAuthService);
  private router = inject(Router);

  constructor() {
    // Someone already signed in has no business on the front door.
    if (this.auth.signedIn()) this.router.navigate(['/exams']);
  }
}
