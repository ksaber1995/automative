import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, CardModule, ButtonModule, InputTextModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div class="w-full max-w-md">

        <!-- Logo -->
        <div class="text-center mb-8">
          <img src="assets/img/logo.png" alt="Automate Magic" class="h-12 mx-auto mb-3">
          <p class="text-gray-500 text-sm">Business Management Platform</p>
        </div>

        <p-card>
          <div class="p-2">

            <!-- Icon -->
            <div class="text-center mb-6">
              <div class="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                <i class="pi pi-envelope text-3xl text-blue-600"></i>
              </div>
              <h2 class="text-2xl font-bold text-gray-800 mb-2">Check your email</h2>
              <p class="text-gray-500 text-sm">
                We sent a 6-digit verification code to
              </p>
              <p class="text-blue-600 font-semibold text-sm mt-1">{{ maskedEmail() }}</p>
            </div>

            <!-- OTP Form -->
            <form [formGroup]="otpForm" (ngSubmit)="onSubmit()">

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  Verification Code
                </label>
                <input
                  pInputText
                  formControlName="otp"
                  type="text"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="Enter 6-digit code"
                  class="w-full text-center text-2xl font-mono tracking-widest"
                  [class.ng-invalid]="otp?.invalid && otp?.touched"
                  [class.ng-dirty]="otp?.dirty"
                  autocomplete="one-time-code"
                />
                @if (otp?.invalid && otp?.touched) {
                  <p class="text-red-500 text-xs mt-1">
                    @if (otp?.errors?.['required']) { Verification code is required. }
                    @if (otp?.errors?.['minlength'] || otp?.errors?.['maxlength']) { Code must be exactly 6 digits. }
                    @if (otp?.errors?.['pattern']) { Code must contain digits only. }
                  </p>
                }
              </div>

              <button
                pButton
                type="submit"
                label="Verify Email"
                icon="pi pi-check"
                class="w-full"
                [loading]="loading()"
                [disabled]="otpForm.invalid || loading()">
              </button>
            </form>

            <!-- Resend -->
            <div class="mt-6 text-center">
              <p class="text-sm text-gray-500 mb-2">Didn't receive the code?</p>
              @if (resendCooldown() > 0) {
                <p class="text-sm text-gray-400">
                  Resend available in <span class="font-semibold text-blue-600">{{ resendCooldown() }}s</span>
                </p>
              } @else {
                <button
                  pButton
                  type="button"
                  label="Resend Code"
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
                <i class="pi pi-arrow-left text-xs mr-1"></i>Back to login
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
