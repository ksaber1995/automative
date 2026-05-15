import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { InstallmentService } from '../services/installment.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';
import { ExpenseCategory } from '@shared/enums/expense-type.enum';

@Component({
  selector: 'app-installment-form',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule, CardModule, ButtonModule,
    InputTextModule, InputNumberModule, TextareaModule, SelectModule, DatePickerModule,
    TranslateModule,
  ],
  templateUrl: './installment-form.component.html',
})
export class InstallmentFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private installmentService = inject(InstallmentService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);

  form: FormGroup;
  branches = signal<Branch[]>([]);
  branchOptions = computed(() => this.branches().map(b => ({ label: b.name, value: b.id })));
  submitting = signal(false);

  categoryOptions = Object.values(ExpenseCategory).map(c => ({ label: c, value: c }));

  totalPreview = signal(0);
  dpPreview = signal(0);
  financedPreview = computed(() => Math.max(0, this.totalPreview() - this.dpPreview()));
  monthlyPreview = signal(0);

  constructor() {
    this.form = this.fb.group({
      branchId: [null],
      name: ['', [Validators.required]],
      description: [''],
      category: ['EQUIPMENT', [Validators.required]],
      totalAmount: [0, [Validators.required, Validators.min(0.01)]],
      downpaymentAmount: [0, [Validators.min(0)]],
      monthsCount: [12, [Validators.required, Validators.min(1)]],
      startDate: [new Date(), [Validators.required]],
      vendor: [''],
      invoiceNumber: [''],
      notes: [''],
    });

    const recompute = () => {
      const v = this.form.value;
      const total = Number(v.totalAmount || 0);
      const dp = Number(v.downpaymentAmount || 0);
      const months = Number(v.monthsCount || 0);
      this.totalPreview.set(total);
      this.dpPreview.set(dp);
      const financed = Math.max(0, total - dp);
      this.monthlyPreview.set(months > 0 ? parseFloat((financed / months).toFixed(2)) : 0);
    };
    this.form.valueChanges.subscribe(() => recompute());
    recompute();
  }

  ngOnInit() {
    this.branchService.getActiveBranches().subscribe({ next: bs => this.branches.set(bs) });
  }

  cancel() { this.router.navigate(['/expenses/installments']); }

  submit() {
    if (!this.form.valid) {
      this.notificationService.error(this.translate.instant('INSTALLMENTS.FORM.MSG_REQUIRED_FIELDS'));
      return;
    }
    const v = this.form.value;
    if (Number(v.downpaymentAmount || 0) >= Number(v.totalAmount)) {
      this.notificationService.error(this.translate.instant('INSTALLMENTS.FORM.MSG_DOWNPAYMENT_INVALID'));
      return;
    }
    const startStr = v.startDate instanceof Date ? v.startDate.toISOString().split('T')[0] : v.startDate;

    this.submitting.set(true);
    this.installmentService.create({
      branchId: v.branchId || null,
      name: v.name,
      description: v.description || undefined,
      category: v.category,
      totalAmount: Number(v.totalAmount),
      downpaymentAmount: Number(v.downpaymentAmount || 0),
      monthsCount: Number(v.monthsCount),
      startDate: startStr,
      vendor: v.vendor || undefined,
      invoiceNumber: v.invoiceNumber || undefined,
      notes: v.notes || undefined,
    }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.notificationService.success(this.translate.instant('INSTALLMENTS.FORM.MSG_CREATED'));
        this.router.navigate(['/expenses/installments', res.plan.id]);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.submitting.set(false);
      },
    });
  }
}
