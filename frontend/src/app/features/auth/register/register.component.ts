import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LanguageService } from '../../../core/services/language.service';
import { RecaptchaService } from '../../../core/services/recaptcha.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RegisterDto } from '@shared/interfaces/user.interface';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, CardModule, ButtonModule, TranslateModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss'
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private recaptcha = inject(RecaptchaService);
  languageService = inject(LanguageService);

  registerForm: FormGroup;
  loading = signal(false);
  serverError = signal('');
  // Account type is fixed by the route (/auth/register/academy|teacher), not a
  // dropdown. The login page links to each entry point separately.
  accountType = signal<'ACADEMY' | 'TEACHER'>('ACADEMY');

  constructor() {
    this.registerForm = this.fb.group({
      // Company Information
      companyName: ['', [Validators.required, Validators.minLength(2)]],
      // Account type: ACADEMY (institution) or TEACHER (individual). Set from the route.
      type: ['ACADEMY', [Validators.required]],
      // TODO: re-enable later. Hidden for now to simplify onboarding.
      // companyEmail: ['', [Validators.required, Validators.email]],
      // companyCode: [''],

      // User Information (Company Owner)
      firstName: ['', [Validators.required]],
      lastName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      countryCode: ['20', [Validators.required, Validators.pattern(/^\+?\d{1,5}$/)]],
      phone: ['', [Validators.required, Validators.pattern(/^\d{4,15}$/)]]
    }, {
      validators: this.passwordMatchValidator
    });

    // Drive the (hidden) type control from the route data so each link
    // (/auth/register/academy, /auth/register/teacher) registers the right kind.
    this.route.data.subscribe((data) => {
      const t = data['accountType'] === 'TEACHER' ? 'TEACHER' : 'ACADEMY';
      this.accountType.set(t);
      this.registerForm.get('type')?.setValue(t);
    });
  }

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password');
    const confirmPassword = form.get('confirmPassword');

    if (password && confirmPassword && password.value !== confirmPassword.value) {
      confirmPassword.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }

    return null;
  }

  async onSubmit() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.serverError.set('');
    const { confirmPassword, ...registerData } = this.registerForm.value;

    let recaptchaToken = '';
    try {
      recaptchaToken = await this.recaptcha.execute('register');
    } catch (err) {
      console.error('reCAPTCHA execute failed:', err);
    }

    // Strip + and any non-digits client-side so the user can paste "+20"
    // and the trunk-zero on the local number.
    const dto: RegisterDto = {
      ...registerData,
      // Industry is hidden in the UI for now but still required downstream —
      // hard-coded here until we expose a picker.
      industry: 'Tech Center',
      countryCode: String(registerData.countryCode || '').replace(/\D/g, ''),
      phone: String(registerData.phone || '').replace(/\D/g, '').replace(/^0+/, ''),
      recaptchaToken,
    };

    this.authService.register(dto).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('AUTH.REGISTER.SUCCESS'));
        // ── OTP verification temporarily disabled — go straight to login ──
        this.router.navigate(['/auth/login']);
        // ──────────────────────────────────────────────────────────────────
      },
      error: (error) => {
        this.loading.set(false);
        const msg = error.error?.message || this.translate.instant('AUTH.REGISTER.FAILED');
        this.serverError.set(msg);
        this.notificationService.error(msg);
      }
    });
  }

  // Form field getters
  get companyName() { return this.registerForm.get('companyName'); }
  get type() { return this.registerForm.get('type'); }
  // TODO: re-enable later. Hidden for now to simplify onboarding.
  // get companyEmail() { return this.registerForm.get('companyEmail'); }
  // get companyCode() { return this.registerForm.get('companyCode'); }
  get firstName() { return this.registerForm.get('firstName'); }
  get lastName() { return this.registerForm.get('lastName'); }
  get email() { return this.registerForm.get('email'); }
  get password() { return this.registerForm.get('password'); }
  get confirmPassword() { return this.registerForm.get('confirmPassword'); }
  get countryCode() { return this.registerForm.get('countryCode'); }
  get phone() { return this.registerForm.get('phone'); }
}
