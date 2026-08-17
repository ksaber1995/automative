import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PortalAuthService } from './portal-auth.service';

/**
 * The console's sign-in.
 *
 * No "create an account" and no password reset by design: accounts are made by
 * an existing portal user, or by hand in the database. Anyone who reaches this
 * page without one is not meant to get in.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="screen">
      <form class="box" (ngSubmit)="submit()">
        <div class="brand">Netrofit <span>Admin</span></div>
        <p class="sub">Sign in to continue.</p>

        <label class="lbl" for="email">Email</label>
        <input
          id="email" class="field" type="email" name="email" autocomplete="username"
          spellcheck="false" autofocus
          [ngModel]="email()" (ngModelChange)="email.set($event)"
        />

        <label class="lbl" for="password">Password</label>
        <input
          id="password" class="field" type="password" name="password" autocomplete="current-password"
          [ngModel]="password()" (ngModelChange)="password.set($event)"
        />

        @if (error(); as e) {
          <div class="error">{{ e }}</div>
        }

        <button class="submit" type="submit" [disabled]="busy() || !email().trim() || !password()">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>

        <p class="foot">
          Accounts are added directly — there is no registration.
        </p>
      </form>
    </div>
  `,
  styles: [`
    .screen {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 24px; background: #0f172a;
    }
    .box {
      width: 100%; max-width: 360px; background: #fff; border-radius: 14px;
      padding: 28px 26px 22px; box-shadow: 0 20px 50px rgba(0,0,0,.35);
    }
    .brand { font-size: 20px; font-weight: 800; color: #0f172a; }
    .brand span { color: #4f46e5; font-weight: 600; }
    .sub { margin: 4px 0 20px; color: #64748b; font-size: 14px; }
    .lbl { display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 5px; }
    .field {
      width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px;
      padding: 10px 12px; font-size: 14px; margin-bottom: 14px; font-family: inherit;
    }
    .field:focus { outline: 2px solid #c7d2fe; border-color: #4f46e5; }
    .submit {
      width: 100%; border: 0; background: #4f46e5; color: #fff; border-radius: 8px;
      padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer;
    }
    .submit:hover:not(:disabled) { background: #4338ca; }
    .submit:disabled { opacity: .5; cursor: default; }
    .error {
      background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
      padding: 10px 12px; border-radius: 8px; margin-bottom: 14px; font-size: 13px;
    }
    .foot { margin: 16px 0 0; color: #94a3b8; font-size: 12px; text-align: center; }
  `],
})
export class LoginComponent {
  private auth = inject(PortalAuthService);

  protected email = signal('');
  protected password = signal('');
  protected busy = signal(false);
  protected error = signal<string | null>(null);

  protected submit(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.auth.login(this.email().trim(), this.password()).subscribe({
      // Nothing to do on success — the shell watches auth.user() and swaps
      // this page out for the console.
      next: () => this.busy.set(false),
      error: (err: any) => {
        this.busy.set(false);
        this.password.set('');
        this.error.set(
          err?.status === 429
            ? 'Too many attempts. Wait a few minutes and try again.'
            : err?.error?.message || 'Could not sign in.',
        );
      },
    });
  }
}
