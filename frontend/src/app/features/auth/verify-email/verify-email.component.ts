import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, CardModule, ButtonModule, InputTextModule, TranslateModule],
  templateUrl: './verify-email.component.html',
})
export class VerifyEmailComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);

  otpForm: FormGroup;
  loading = signal(false);
  resending = signal(false);
  resendCooldown = signal(0);

  private email = '';
  private cooldownTimer: any;

  constructor() {
    this.otpForm = this.fb.group({
      otp: [
        '',
        [
          Validators.required,
          Validators.minLength(6),
          Validators.maxLength(6),
          Validators.pattern(/^\d{6}$/),
        ],
      ],
    });
  }

  ngOnInit() {
    this.email = this.route.snapshot.queryParamMap.get('email') || '';
    if (!this.email) {
      this.router.navigate(['/auth/login']);
      return;
    }
    this.startCooldown(60);
  }

  ngOnDestroy() {
    clearInterval(this.cooldownTimer);
  }

  maskedEmail(): string {
    if (!this.email) return '';
    const [local, domain] = this.email.split('@');
    if (!domain) return this.email;
    const visible = local.slice(0, 2);
    const masked = '*'.repeat(Math.max(local.length - 2, 2));
    return `${visible}${masked}@${domain}`;
  }

  onSubmit() {
    if (this.otpForm.invalid) {
      this.otpForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const { otp } = this.otpForm.value;

    this.authService.verifyEmail(this.email, otp).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('AUTH.VERIFY_EMAIL.VERIFY_SUCCESS'));
        // Full document load — same reason as the login page: root singletons
        // keep their caches across an in-app navigation. See AuthService.logout().
        window.location.href = '/dashboard';
      },
      error: (error) => {
        this.loading.set(false);
        this.notificationService.error(
          error.error?.message || this.translate.instant('AUTH.VERIFY_EMAIL.VERIFY_FAILED')
        );
      },
    });
  }

  resendOtp() {
    this.resending.set(true);
    this.authService.resendEmailOtp(this.email).subscribe({
      next: (res: any) => {
        this.resending.set(false);
        this.notificationService.success(res.message || this.translate.instant('AUTH.VERIFY_EMAIL.RESEND_SUCCESS'));
        this.startCooldown(60);
      },
      error: (error) => {
        this.resending.set(false);
        this.notificationService.error(
          error.error?.message || this.translate.instant('AUTH.VERIFY_EMAIL.RESEND_FAILED')
        );
      },
    });
  }

  private startCooldown(seconds: number) {
    this.resendCooldown.set(seconds);
    clearInterval(this.cooldownTimer);
    this.cooldownTimer = setInterval(() => {
      this.resendCooldown.update(v => {
        if (v <= 1) {
          clearInterval(this.cooldownTimer);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
  }

  get otp() { return this.otpForm.get('otp'); }
}
