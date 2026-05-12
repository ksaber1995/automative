import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { DebtService, CreatePaymentDto } from '../../../core/services/debt.service';
import { Debt } from '@shared/interfaces/debt.interface';
import { PaymentMethod } from '@shared/interfaces/withdrawal.interface';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-debt-payment',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    InputNumberModule,
    InputTextModule,
    ButtonModule
  ],
  templateUrl: './debt-payment.component.html',
  styleUrl: './debt-payment.component.scss'})
export class DebtPaymentComponent implements OnInit {
  private fb = inject(FormBuilder);
  private debtService = inject(DebtService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  paymentForm!: FormGroup;
  debt = signal<Debt | null>(null);
  submitting = signal(false);

  paymentMethodOptions = [
    { label: 'Cash', value: 'CASH' },
    { label: 'Check', value: 'CHECK' },
    { label: 'Bank Transfer', value: 'BANK_TRANSFER' },
    { label: 'Auto Debit', value: 'AUTO_DEBIT' },
    { label: 'Other', value: 'OTHER' }
  ];

  ngOnInit() {
    this.initForm();

    const debtId = this.route.snapshot.params['id'];
    if (debtId) {
      this.loadDebt(debtId);
    }
  }

  initForm() {
    const today = new Date().toISOString().split('T')[0];
    this.paymentForm = this.fb.group({
      paymentDate: [today, Validators.required],
      totalAmount: [null, [Validators.required, Validators.min(0.01)]],
      paymentMethod: ['', Validators.required],
      referenceNumber: [''],
      lateFee: [0, Validators.min(0)],
      notes: ['']
    });
  }

  loadDebt(id: string) {
    this.debtService.findOne(id, true).subscribe({
      next: (debt) => {
        this.debt.set(debt);
      },
      error: (err) => {
        console.error('Error loading debt:', err);
        this.notificationService.error('Failed to load debt');
        this.cancel();
      }
    });
  }

  onSubmit() {
    if (this.paymentForm.invalid || !this.debt()) {
      Object.keys(this.paymentForm.controls).forEach(key => {
        this.paymentForm.get(key)?.markAsTouched();
      });
      return;
    }

    const formValue = this.paymentForm.value;

    // Validate payment amount doesn't exceed balance
    if (formValue.totalAmount > this.debt()!.currentBalance) {
      this.notificationService.error('Payment amount cannot exceed current balance');
      return;
    }

    this.submitting.set(true);

    const paymentDto: CreatePaymentDto = {
      paymentDate: formValue.paymentDate,
      totalAmount: formValue.totalAmount,
      paymentMethod: formValue.paymentMethod as PaymentMethod,
      referenceNumber: formValue.referenceNumber || undefined,
      lateFee: formValue.lateFee || undefined,
      notes: formValue.notes || undefined
    };

    this.debtService.createPayment(this.debt()!.id, paymentDto).subscribe({
      next: () => {
        this.submitting.set(false);
        this.notificationService.success('Payment submitted successfully');
        this.router.navigate(['/debts', this.debt()!.id]);
      },
      error: (err) => {
        this.submitting.set(false);
        console.error('Error submitting payment:', err);
        this.notificationService.error(err.error?.message || 'Failed to submit payment');
      }
    });
  }

  cancel() {
    if (this.debt()) {
      this.router.navigate(['/debts', this.debt()!.id]);
    } else {
      this.router.navigate(['/debts']);
    }
  }
}
