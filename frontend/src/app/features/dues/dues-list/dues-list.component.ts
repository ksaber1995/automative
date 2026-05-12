import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { ProgressBarModule } from 'primeng/progressbar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DuesService } from '../services/dues.service';
import { BranchService } from '../../branches/services/branch.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { MasterEnrollmentService } from '../../master-courses/services/master-enrollment.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DueEnrollment } from '@shared/interfaces/enrollment.interface';

@Component({
  selector: 'app-dues-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    CardModule, TableModule, ButtonModule, TagModule,
    SelectModule, TooltipModule, DialogModule,
    InputNumberModule, DatePickerModule, TextareaModule, ProgressBarModule,
    TranslateModule, TagModule,
  ],
  templateUrl: './dues-list.component.html',
})
export class DuesListComponent implements OnInit {
  private duesService = inject(DuesService);
  private enrollmentService = inject(EnrollmentService);
  private masterEnrollmentService = inject(MasterEnrollmentService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  dues = signal<DueEnrollment[]>([]);
  loading = signal(true);
  actionLoading = signal(false);

  filterBranch: string | null = null;
  branchOptions: { label: string; value: string }[] = [];

  totalFinal = computed(() => this.dues().reduce((s, d) => s + d.finalPrice, 0));
  totalPaid = computed(() => this.dues().reduce((s, d) => s + d.amountPaid, 0));
  totalRemaining = computed(() => this.dues().reduce((s, d) => s + d.remaining, 0));

  // Payment dialog
  selectedDue = signal<DueEnrollment | null>(null);
  showPaymentDialog = false;
  paymentAmount: number | null = null;
  paymentDate: Date = new Date();
  paymentNotes = '';

  ngOnInit() {
    this.loadBranches();
    this.load();
  }

  loadBranches() {
    this.branchService.getAllBranches().subscribe({
      next: (branches) => {
        this.branchOptions = branches.map(b => ({ label: b.name, value: b.id }));
      },
      error: () => {}
    });
  }

  load() {
    this.loading.set(true);
    this.duesService.getDues(this.filterBranch || undefined).subscribe({
      next: (data) => {
        this.dues.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load dues');
        this.loading.set(false);
      }
    });
  }

  clearFilters() {
    this.filterBranch = null;
    this.load();
  }

  getProgress(due: DueEnrollment): number {
    if (due.finalPrice === 0) return 100;
    return Math.round((due.amountPaid / due.finalPrice) * 100);
  }

  openPaymentDialog(due: DueEnrollment) {
    this.selectedDue.set(due);
    this.paymentAmount = null;
    this.paymentDate = new Date();
    this.paymentNotes = '';
    this.showPaymentDialog = true;
  }

  submitPayment() {
    const due = this.selectedDue();
    if (!due || !this.paymentAmount || !this.paymentDate) return;

    this.actionLoading.set(true);
    const dateStr = this.paymentDate.toISOString().split('T')[0];
    const dto = { amount: this.paymentAmount, paymentDate: dateStr, notes: this.paymentNotes || undefined };

    const request$ = due.type === 'MASTER_ENROLLMENT'
      ? this.masterEnrollmentService.addPayment(due.id, dto)
      : this.enrollmentService.addPayment(due.id, dto);

    request$.subscribe({
      next: () => {
        this.notificationService.success('Payment recorded successfully');
        this.showPaymentDialog = false;
        this.actionLoading.set(false);
        this.load();
      },
      error: (err) => {
        this.notificationService.error(err?.error?.message || 'Failed to record payment');
        this.actionLoading.set(false);
      }
    });
  }

  viewStudent(due: DueEnrollment) {
    this.router.navigate(['/students', due.studentId]);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }
}
