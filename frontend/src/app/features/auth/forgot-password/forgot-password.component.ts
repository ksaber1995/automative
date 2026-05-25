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
  fullPhone = signal('');

  constructor() {
    this.form = this.fb.group({
      countryCode: ['20', [Validators.required, Validators.pattern(/^\d{1,5}$/)]],
      phone: ['', [Validators.required, Validators.pattern(/^\d{4,15}$/)]],
    });
  }

  async onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const countryCode = String(this.form.value.countryCode || '').replace(/\D/g, '');
    const phone = String(this.form.value.phone || '').replace(/\D/g, '').replace(/^0+/, '');
    const combined = `${countryCode}${phone}`;
    this.fullPhone.set(combined);

    let recaptchaToken = '';
    try {
      recaptchaToken = await this.recaptcha.execute('forgot_password');
    } catch (err) {
      console.error('reCAPTCHA execute failed:', err);
    }

    this.authService.forgotPassword(combined, recaptchaToken).subscribe({
      next: () => {
        this.loading.set(false);
        this.submitted.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        this.notificationService.error(
          err.error?.message || this.translate.instant('AUTH.FORGOT_PASSWORD.FAILED')
        );
      },
    });
  }

  goToReset() {
    this.router.navigate(['/auth/reset-password'], {
      queryParams: { phone: this.fullPhone() },
    });
  }

  get countryCode() { return this.form.get('countryCode'); }
  get phone() { return this.form.get('phone'); }
}
