import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { I18nService } from './i18n.service';
import { StudentAuthService } from './auth/student-auth.service';

/**
 * Spend the claim ticket: pick a username + password on a first claim, or set a
 * new password on a reset. One screen for both — the heading changes, and the
 * username field disappears on a reset because the server keeps the existing
 * name (the card proves possession, not the right to rename).
 */
@Component({
  selector: 'app-claim',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="card">
      <h1>{{ i18n.t(isReset() ? 'CLAIM.HEADING_RESET' : 'CLAIM.HEADING_NEW') }}</h1>
      <p class="muted">{{ studentName() }} — {{ i18n.t(isReset() ? 'CLAIM.SUB_RESET' : 'CLAIM.SUB_NEW') }}</p>

      <form (ngSubmit)="submit()">
        @if (!isReset()) {
          <label for="username">{{ i18n.t('CLAIM.USERNAME') }}</label>
          <input id="username" name="username" [(ngModel)]="username" autocomplete="username" required />
        }

        <label for="password">{{ i18n.t('CLAIM.PASSWORD') }}</label>
        <input id="password" name="password" type="password" [(ngModel)]="password" autocomplete="new-password" required minlength="8" />

        <label for="confirm">{{ i18n.t('CLAIM.CONFIRM') }}</label>
        <input id="confirm" name="confirm" type="password" [(ngModel)]="confirm" autocomplete="new-password" required />

        @if (error()) { <div class="error">{{ error() }}</div> }

        <button type="submit" class="btn" [disabled]="saving()">
          {{ i18n.t(saving() ? 'CLAIM.SAVING' : 'CLAIM.SUBMIT') }}
        </button>
      </form>
    </div>
  `,
})
export class ClaimComponent {
  i18n = inject(I18nService);
  private auth = inject(StudentAuthService);
  private router = inject(Router);

  isReset = computed(() => this.auth.claim()?.hasCredentials === true);
  studentName = computed(() => this.auth.claim()?.studentName ?? '');

  username = '';
  password = '';
  confirm = '';
  saving = signal(false);
  error = signal('');

  submit(): void {
    this.error.set('');
    if (this.password.length < 8) {
      this.error.set(this.i18n.t('ERRORS.STUDENT_AUTH.WEAK_PASSWORD'));
      return;
    }
    if (this.password !== this.confirm) {
      this.error.set(this.i18n.t('CLAIM.MISMATCH'));
      return;
    }
    this.saving.set(true);
    this.auth.claimFinish(this.username, this.password).subscribe({
      next: () => this.router.navigate(['/exams']),
      error: (err) => {
        this.saving.set(false);
        this.error.set(this.i18n.fromError(err));
        // A dead ticket can only be fixed by scanning again.
        if (err?.error?.code === 'ERRORS.STUDENT_AUTH.CLAIM_EXPIRED') {
          this.auth.claim.set(null);
          setTimeout(() => this.router.navigate(['/scan']), 1500);
        }
      },
    });
  }
}
