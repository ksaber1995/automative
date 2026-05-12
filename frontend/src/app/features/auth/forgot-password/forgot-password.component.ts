import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RecaptchaService } from '../../../core/services/recaptcha.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, CardModule, ButtonModule, InputTextModule, TranslateModule],
  templateUrl: './forgot-password.component.html',
})
export class ForgotPasswordComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private recaptcha = inject(RecaptchaService);

  form: FormGroup;
  loading = signal(false);
  submitted = signal(false);
  successMessage = signal('');

  constructor() {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
  }

  async onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const email = String(this.form.value.email || '').trim();

    let recaptchaToken = '';
    try {
      recaptchaToken = await this.recaptcha.execute('forgot_password');
    } catch (err) {
      console.error('reCAPTCHA execute failed:', err);
    }

    this.authService.forgotPassword(email, recaptchaToken).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.submitted.set(true);
        this.successMessage.set(res.message || this.translate.instant('AUTH.FORGOT_PASSWORD.SUCCESS'));
      },
      error: (err) => {
        this.loading.set(false);
        this.notificationService.error(
          err.error?.message || this.translate.instant('AUTH.FORGOT_PASSWORD.FAILED')
        );
      },
    });
  }

  get email() { return this.form.get('email'); }
}
