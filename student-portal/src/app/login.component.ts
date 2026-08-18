import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { I18nService } from './i18n.service';
import { StudentAuthService } from './auth/student-auth.service';

/** Returning students. Forgot the password → scan the card again (that IS the reset). */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="card">
      <h1>{{ i18n.t('LOGIN.HEADING') }}</h1>

      <form (ngSubmit)="submit()">
        <label for="identifier">{{ i18n.t('LOGIN.IDENTIFIER') }}</label>
        <input id="identifier" name="identifier" [(ngModel)]="identifier" autocomplete="username" required />

        <label for="password">{{ i18n.t('LOGIN.PASSWORD') }}</label>
        <input id="password" name="password" type="password" [(ngModel)]="password" autocomplete="current-password" required />

        @if (error()) { <div class="error">{{ error() }}</div> }

        <button type="submit" class="btn" [disabled]="busy() || !identifier || !password">
          {{ i18n.t(busy() ? 'LOGIN.SIGNING_IN' : 'LOGIN.SUBMIT') }}
        </button>
      </form>

      <a routerLink="/scan" class="link" style="display:block; text-align:center; margin-block-start:16px;">
        {{ i18n.t('LOGIN.FORGOT') }}
      </a>
    </div>
  `,
})
export class LoginComponent {
  i18n = inject(I18nService);
  private auth = inject(StudentAuthService);
  private router = inject(Router);

  identifier = '';
  password = '';
  busy = signal(false);
  error = signal('');

  constructor() {
    if (this.auth.signedIn()) this.router.navigate(['/exams']);
  }

  submit(): void {
    this.error.set('');
    this.busy.set(true);
    this.auth.login(this.identifier, this.password).subscribe({
      next: () => this.router.navigate(['/exams']),
      error: (err) => {
        this.busy.set(false);
        this.error.set(this.i18n.fromError(err));
      },
    });
  }
}
