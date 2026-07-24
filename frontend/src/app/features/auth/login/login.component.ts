import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LanguageService } from '../../../core/services/language.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    CardModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    CheckboxModule,
    TranslateModule
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  languageService = inject(LanguageService);

  loginForm: FormGroup;
  loading = signal(false);
  serverError = signal('');

  constructor() {
    this.loginForm = this.fb.group({
      identifier: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      rememberMe: [false]
    });
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.serverError.set('');
    const { identifier, password } = this.loginForm.value;

    this.authService.login({ identifier: String(identifier).trim(), password }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('AUTH.LOGIN.SUCCESS'));
        // Full document load, not router.navigate — see AuthService.logout().
        // Root singletons (BranchStateService's branch cache in particular) keep
        // their data across an in-app navigation, so signing into a different
        // tenant without a reload leaves the previous tenant's branches in memory.
        window.location.href = '/dashboard';
      },
      error: (error) => {
        this.loading.set(false);
        if (error.status === 403 && error.error?.code === 'ERRORS.AUTH.EMAIL_NOT_VERIFIED') {
          this.notificationService.error(this.translate.instant('AUTH.LOGIN.EMAIL_NOT_VERIFIED'));
          this.router.navigate(['/auth/verify-email'], {
            queryParams: {
              email: error.error.email || '',
            },
          });
          return;
        }
        const code = error.error?.code;
        let msg: string;
        if (code) {
          const translated = this.translate.instant(code);
          msg = translated !== code ? translated : (error.error?.message || this.translate.instant('AUTH.LOGIN.FAILED'));
        } else {
          msg = error.error?.message || this.translate.instant('AUTH.LOGIN.FAILED');
        }
        this.serverError.set(msg);
        this.notificationService.error(msg);
      },
      complete: () => {
        this.loading.set(false);
      }
    });
  }

  get identifier() {
    return this.loginForm.get('identifier');
  }

  get password() {
    return this.loginForm.get('password');
  }
}
