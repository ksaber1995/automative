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
  selector: 'app-verify-phone',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, CardModule, ButtonModule, InputTextModule, TranslateModule],
  templateUrl: './verify-phone.component.html',
})
export class VerifyPhoneComponent implements OnInit, OnDestroy {
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

  private countryCode = '';
  private phone = '';
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
    this.countryCode = this.route.snapshot.queryParamMap.get('countryCode') || '';
    this.phone = this.route.snapshot.queryParamMap.get('phone') || '';
    if (!this.phone || !this.countryCode) {
      this.router.navigate(['/auth/login']);
      return;
    }
    // Start initial cooldown so user waits before spamming resend
    this.startCooldown(60);
  }

  ngOnDestroy() {
    clearInterval(this.cooldownTimer);
  }

  maskedPhone(): string {
    if (!this.phone) return '';
    const last = this.phone.slice(-4);
    const masked = '*'.repeat(Math.max(this.phone.length - 4, 2));
    return `+${this.countryCode} ${masked}${last}`;
  }

  onSubmit() {
    if (this.otpForm.invalid) {
      this.otpForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const { otp } = this.otpForm.value;

    this.authService.verifyPhone(this.countryCode, this.phone, otp).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('AUTH.VERIFY_PHONE.VERIFY_SUCCESS'));
        this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        this.loading.set(false);
        this.notificationService.error(
          error.error?.message || this.translate.instant('AUTH.VERIFY_PHONE.VERIFY_FAILED')
        );
      },
    });
  }

  resendOtp() {
    this.resending.set(true);
    this.authService.resendOtp(this.countryCode, this.phone).subscribe({
      next: (res: any) => {
        this.resending.set(false);
        this.notificationService.success(res.message || this.translate.instant('AUTH.VERIFY_PHONE.RESEND_SUCCESS'));
        this.startCooldown(60);
      },
      error: (error) => {
        this.resending.set(false);
        this.notificationService.error(
          error.error?.message || this.translate.instant('AUTH.VERIFY_PHONE.RESEND_FAILED')
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
