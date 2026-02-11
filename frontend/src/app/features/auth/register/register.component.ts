import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RegisterDto } from '@shared/interfaces/user.interface';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, CardModule, ButtonModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss'
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);

  registerForm: FormGroup;
  loading = signal(false);

  industries = [
    'Education & Training',
    'Technology',
    'Healthcare',
    'Retail',
    'Manufacturing',
    'Finance',
    'Consulting',
    'Other'
  ];

  timezones = [
    'Africa/Cairo',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
    'Asia/Dubai',
    'Asia/Riyadh'
  ];

  constructor() {
    this.registerForm = this.fb.group({
      // Company Information
      companyName: ['', [Validators.required, Validators.minLength(2)]],
      companyEmail: ['', [Validators.required, Validators.email]],
      companyCode: [''],
      industry: [''],
      timezone: ['Africa/Cairo'],

      // User Information (Company Owner)
      firstName: ['', [Validators.required]],
      lastName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      phone: ['']
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

    // Type-safe registration data
    const dto: RegisterDto = registerData;

    this.authService.register(dto).subscribe({
      next: (response) => {
        this.notificationService.success(
          `Welcome to Automate Magic! Company "${response.company?.name}" has been created successfully.`
        );
        setTimeout(() => {
          this.router.navigate(['/dashboard']);
        }, 1500);
      },
      error: (error) => {
        this.loading.set(false);
        this.notificationService.error(
          error.error?.message || 'Registration failed. Please try again.'
        );
      }
    });
  }

  // Form field getters
  get companyName() { return this.registerForm.get('companyName'); }
  get companyEmail() { return this.registerForm.get('companyEmail'); }
  get companyCode() { return this.registerForm.get('companyCode'); }
  get industry() { return this.registerForm.get('industry'); }
  get timezone() { return this.registerForm.get('timezone'); }
  get firstName() { return this.registerForm.get('firstName'); }
  get lastName() { return this.registerForm.get('lastName'); }
  get email() { return this.registerForm.get('email'); }
  get password() { return this.registerForm.get('password'); }
  get confirmPassword() { return this.registerForm.get('confirmPassword'); }
  get phone() { return this.registerForm.get('phone'); }
}
