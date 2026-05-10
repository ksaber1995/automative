import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LanguageService } from '../../../core/services/language.service';
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
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  languageService = inject(LanguageService);

  registerForm: FormGroup;
  loading = signal(false);

  constructor() {
    this.registerForm = this.fb.group({
      // Company Information
      companyName: ['', [Validators.required, Validators.minLength(2)]],
      companyEmail: ['', [Validators.required, Validators.email]],
      companyCode: [''],

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

  onSubmit() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const { confirmPassword, ...registerData } = this.registerForm.value;

    // Strip + and any non-digits client-side so the user can paste "+20"
    // and the trunk-zero on the local number.
    const dto: RegisterDto = {
      ...registerData,
      countryCode: String(registerData.countryCode || '').replace(/\D/g, ''),
      phone: String(registerData.phone || '').replace(/\D/g, '').replace(/^0+/, ''),
    };

    this.authService.register(dto).subscribe({
      next: (response) => {
        this.notificationService.success(this.translate.instant('AUTH.REGISTER.SUCCESS'));
        this.router.navigate(['/auth/verify-phone'], {
          queryParams: {
            countryCode: response.countryCode,
            phone: response.phone,
          },
        });
      },
      error: (error) => {
        this.loading.set(false);
        this.notificationService.error(
          error.error?.message || this.translate.instant('AUTH.REGISTER.FAILED')
        );
      }
    });
  }

  // Form field getters
  get companyName() { return this.registerForm.get('companyName'); }
  get companyEmail() { return this.registerForm.get('companyEmail'); }
  get companyCode() { return this.registerForm.get('companyCode'); }
  get firstName() { return this.registerForm.get('firstName'); }
  get lastName() { return this.registerForm.get('lastName'); }
  get email() { return this.registerForm.get('email'); }
  get password() { return this.registerForm.get('password'); }
  get confirmPassword() { return this.registerForm.get('confirmPassword'); }
  get countryCode() { return this.registerForm.get('countryCode'); }
  get phone() { return this.registerForm.get('phone'); }
}
