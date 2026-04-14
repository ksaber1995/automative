import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, CardModule, ButtonModule, InputTextModule, TranslateModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div class="w-full max-w-md">

        <!-- Logo -->
        <div class="text-center mb-8">
          <img src="assets/img/logo.png" [alt]="'AUTH.VERIFY_EMAIL.BRAND' | translate" class="h-12 mx-auto mb-3">
          <p class="text-gray-500 text-sm">{{ 'AUTH.VERIFY_EMAIL.BRAND_SUBTITLE' | translate }}</p>
        </div>

        <p-card>
          <div class="p-2">

            <!-- Icon -->
            <div class="text-center mb-6">
              <div class="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                <i class="pi pi-envelope text-3xl text-blue-600"></i>
              </div>
              <h2 class="text-2xl font-bold text-gray-800 mb-2">{{ 'AUTH.VERIFY_EMAIL.TITLE' | translate }}</h2>
              <p class="text-gray-500 text-sm">
                {{ 'AUTH.VERIFY_EMAIL.SENT_TO' | translate }}
              </p>
              <p class="text-blue-600 font-semibold text-sm mt-1">{{ maskedEmail() }}</p>
            </div>

            <!-- OTP Form -->
            <form [formGroup]="otpForm" (ngSubmit)="onSubmit()">

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ 'AUTH.VERIFY_EMAIL.OTP_LABEL' | translate }}
                </label>
                <input
                  pInputText
                  formControlName="otp"
                  type="text"
                  inputmode="numeric"
                  maxlength="6"
                  [placeholder]="'AUTH.VERIFY_EMAIL.OTP_PLACEHOLDER' | translate"
                  class="w-full text-center text-2xl font-mono tracking-widest"
                  [class.ng-invalid]="otp?.invalid && otp?.touched"
                  [class.ng-dirty]="otp?.dirty"
                  autocomplete="one-time-code"
                />
                @if (otp?.invalid && otp?.touched) {
                  <p class="text-red-500 text-xs mt-1">
                    @if (otp?.errors?.['required']) { {{ 'AUTH.VERIFY_EMAIL.OTP_REQUIRED' | translate }} }
                    @if (otp?.errors?.['minlength'] || otp?.errors?.['maxlength']) { {{ 'AUTH.VERIFY_EMAIL.OTP_LENGTH' | translate }} }
                    @if (otp?.errors?.['pattern']) { {{ 'AUTH.VERIFY_EMAIL.OTP_DIGITS' | translate }} }
                  </p>
                }
              </div>

              <button
                pButton
                type="submit"
                [label]="'AUTH.VERIFY_EMAIL.VERIFY_BTN' | translate"
                icon="pi pi-check"
                class="w-full"
                [loading]="loading()"
                [disabled]="otpForm.invalid || loading()">
              </button>
            </form>

            <!-- Resend -->
            <div class="mt-6 text-center">
              <p class="text-sm text-gray-500 mb-2">{{ 'AUTH.VERIFY_EMAIL.NO_CODE' | translate }}</p>
              @if (resendCooldown() > 0) {
                <p class="text-sm text-gray-400">
                  {{ 'AUTH.VERIFY_EMAIL.RESEND_COOLDOWN' | translate: { seconds: resendCooldown() } }}
                </p>
              } @else {
                <button
                  pButton
                  type="button"
                  [label]="'AUTH.VERIFY_EMAIL.RESEND_BTN' | translate"
                  icon="pi pi-refresh"
                  class="p-button-text p-button-sm"
                  [loading]="resending()"
                  [disabled]="resending()"
                  (click)="resendOtp()">
                </button>
              }
            </div>

            <!-- Back to login -->
            <div class="mt-4 text-center">
              <a routerLink="/auth/login" class="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                <i class="pi pi-arrow-left text-xs mr-1"></i>{{ 'AUTH.VERIFY_EMAIL.BACK_LOGIN' | translate }}
              </a>
            </div>

          </div>
        </p-card>
      </div>
    </div>
  `,
})
export class VerifyEmailComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

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
    }
    // Start initial cooldown so user waits before spamming resend
    this.startCooldown(60);
  }

  ngOnDestroy() {
    clearInterval(this.cooldownTimer);
  }

  maskedEmail(): string {
    if (!this.email) return '';
    const [local, domain] = this.email.split('@');
    if (!local || !domain) return this.email;
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
        this.notificationService.success('Email verified successfully! Welcome to Automate Magic.');
        this.router.navigate(['/dashboard']);
      },
      error: (error) => {
        this.loading.set(false);
        this.notificationService.error(
          error.error?.message || 'Verification failed. Please check the code and try again.'
        );
      },
    });
  }

  resendOtp() {
    this.resending.set(true);
    this.authService.resendOtp(this.email).subscribe({
      next: (res: any) => {
        this.resending.set(false);
        this.notificationService.success(res.message || 'A new code has been sent to your email.');
        this.startCooldown(60);
      },
      error: (error) => {
        this.resending.set(false);
        this.notificationService.error(
          error.error?.message || 'Failed to resend code. Please try again.'
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
