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
import { DuesService } from '../services/dues.service';
import { BranchService } from '../../branches/services/branch.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
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
  ],
  template: `
    <div class="space-y-4">
      <!-- Header -->
      <div class="flex justify-between items-center">
        <div>
          <h2 class="text-2xl font-bold text-gray-800">Installment Dues</h2>
          <p class="text-gray-500 text-sm mt-1">All students with outstanding installment balances</p>
        </div>
        <div class="flex items-center gap-4">
          <div class="text-right">
            <p class="text-xs text-gray-500 uppercase tracking-wide">Total Remaining</p>
            <p class="font-bold text-red-600 text-xl">{{ totalRemaining().toFixed(2) }} EGP</p>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <p-card>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1">Branch</label>
            <p-select
              [(ngModel)]="filterBranch"
              [options]="branchOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="All Branches"
              [showClear]="true"
              [style]="{ width: '100%' }"
              (onChange)="load()"
            ></p-select>
          </div>
          <div class="flex items-end">
            <button pButton label="Clear Filters" icon="pi pi-filter-slash"
              class="p-button-outlined" (click)="clearFilters()"></button>
          </div>
        </div>
      </p-card>

      <!-- Table -->
      <p-card>
        <p-table
          [value]="dues()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="15"
          [rowsPerPageOptions]="[15, 30, 50]"
          [globalFilterFields]="['studentName', 'courseName', 'branchName']"
          responsiveLayout="scroll"
          styleClass="p-datatable-sm"
          sortField="remaining"
          [sortOrder]="-1"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="studentName">Student <p-sortIcon field="studentName"></p-sortIcon></th>
              <th pSortableColumn="courseName">Course <p-sortIcon field="courseName"></p-sortIcon></th>
              <th pSortableColumn="branchName">Branch <p-sortIcon field="branchName"></p-sortIcon></th>
              <th pSortableColumn="enrollmentDate">Enrolled <p-sortIcon field="enrollmentDate"></p-sortIcon></th>
              <th class="text-right">Total</th>
              <th class="text-right">Paid</th>
              <th pSortableColumn="remaining" class="text-right">Remaining <p-sortIcon field="remaining"></p-sortIcon></th>
              <th>Progress</th>
              <th>Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-due>
            <tr>
              <td>
                <span class="font-medium cursor-pointer text-blue-600 hover:underline"
                  (click)="viewStudent(due)">{{ due.studentName }}</span>
              </td>
              <td class="text-sm text-gray-600">{{ due.courseName }}</td>
              <td class="text-sm text-gray-500">{{ due.branchName }}</td>
              <td class="text-sm">{{ formatDate(due.enrollmentDate) }}</td>
              <td class="text-right font-medium">{{ due.finalPrice.toFixed(2) }}</td>
              <td class="text-right text-green-600">{{ due.amountPaid.toFixed(2) }}</td>
              <td class="text-right font-bold text-red-600">{{ due.remaining.toFixed(2) }}</td>
              <td style="min-width: 120px">
                <p-progressbar
                  [value]="getProgress(due)"
                  [showValue]="true"
                  styleClass="h-2"
                ></p-progressbar>
              </td>
              <td>
                <div class="flex gap-1">
                  <p-button
                    icon="pi pi-plus-circle"
                    [rounded]="true"
                    [text]="true"
                    severity="success"
                    pTooltip="Add Payment"
                    (onClick)="openPaymentDialog(due)"
                  ></p-button>
                  <p-button
                    icon="pi pi-user"
                    [rounded]="true"
                    [text]="true"
                    severity="secondary"
                    pTooltip="View Student"
                    (onClick)="viewStudent(due)"
                  ></p-button>
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9" class="text-center py-12">
                <div class="text-gray-400">
                  <i class="pi pi-check-circle text-4xl mb-3 block text-green-400"></i>
                  <p class="text-lg text-green-600 font-medium">All clear!</p>
                  <p class="text-sm mt-1">No outstanding installment balances</p>
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="footer">
            @if (dues().length > 0) {
              <tr>
                <td colspan="4" class="text-right font-semibold text-gray-600">Totals:</td>
                <td class="text-right font-bold">{{ totalFinal().toFixed(2) }}</td>
                <td class="text-right font-bold text-green-600">{{ totalPaid().toFixed(2) }}</td>
                <td class="text-right font-bold text-red-600">{{ totalRemaining().toFixed(2) }}</td>
                <td colspan="2"></td>
              </tr>
            }
          </ng-template>
        </p-table>
      </p-card>
    </div>

    <!-- Add Payment Dialog -->
    <p-dialog
      header="Add Payment"
      [(visible)]="showPaymentDialog"
      [modal]="true"
      [style]="{ width: '420px' }"
      [closable]="true"
    >
      @if (selectedDue()) {
        <div class="space-y-4">
          <div class="bg-gray-50 rounded-lg p-3">
            <p class="font-medium text-gray-800">{{ selectedDue()!.studentName }}</p>
            <p class="text-sm text-gray-500">{{ selectedDue()!.courseName }}</p>
            <div class="flex justify-between mt-2 text-sm">
              <span class="text-gray-600">Remaining Balance:</span>
              <span class="font-bold text-red-600">{{ selectedDue()!.remaining.toFixed(2) }} EGP</span>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Amount</label>
            <p-inputnumber
              [(ngModel)]="paymentAmount"
              [min]="0.01"
              [max]="selectedDue()!.remaining"
              [minFractionDigits]="2"
              [maxFractionDigits]="2"
              [style]="{ width: '100%' }"
              placeholder="Enter amount"
            ></p-inputnumber>
            <p class="text-xs text-gray-400 mt-1">Max: {{ selectedDue()!.remaining.toFixed(2) }} EGP</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
            <p-datepicker
              [(ngModel)]="paymentDate"
              [showIcon]="true"
              dateFormat="yy-mm-dd"
              [style]="{ width: '100%' }"
            ></p-datepicker>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              pTextarea
              [(ngModel)]="paymentNotes"
              [rows]="2"
              style="width: 100%"
              placeholder="Add any notes..."
            ></textarea>
          </div>
        </div>
      }

      <ng-template pTemplate="footer">
        <button pButton label="Cancel" class="p-button-text" (click)="showPaymentDialog = false"></button>
        <button pButton label="Record Payment" icon="pi pi-check"
          [loading]="actionLoading()"
          [disabled]="!paymentAmount || paymentAmount <= 0"
          (click)="submitPayment()">
        </button>
      </ng-template>
    </p-dialog>
  `,
})
export class DuesListComponent implements OnInit {
  private duesService = inject(DuesService);
  private enrollmentService = inject(EnrollmentService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);

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

    this.enrollmentService.addPayment(due.id, {
      amount: this.paymentAmount,
      paymentDate: dateStr,
      notes: this.paymentNotes || undefined,
    }).subscribe({
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
