import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { ProgressBarModule } from 'primeng/progressbar';
import { ClassService } from '../services/class.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ClassWithDetails } from '@shared/interfaces/class.interface';

@Component({
  selector: 'app-class-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    DialogModule,
    InputNumberModule,
    DatePickerModule,
    TextareaModule,
    ProgressBarModule,
  ],
  template: `
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="goBack()" pTooltip="Back to Classes"></p-button>
        <div class="flex-1">
          <h1 class="text-3xl font-bold text-gray-900">{{ classDetail()?.name || 'Class Details' }}</h1>
          <p class="text-gray-500 mt-1">{{ classDetail()?.code }}</p>
        </div>
        <p-button label="Add Student" icon="pi pi-user-plus" (onClick)="addStudent()"></p-button>
      </div>

      @if (loadingClass()) {
        <div class="text-center py-16 text-gray-400">
          <i class="pi pi-spin pi-spinner text-4xl mb-3"></i>
          <p>Loading...</p>
        </div>
      }

      @if (!loadingClass() && classDetail()) {
        <!-- Class Info -->
        <p-card styleClass="mb-6">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Course</p>
              <p class="font-semibold">{{ classDetail()?.courseName || 'N/A' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Branch</p>
              <p class="font-semibold">{{ classDetail()?.branchName || 'N/A' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Instructor</p>
              <p class="font-semibold">{{ classDetail()?.instructorName || 'Not assigned' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Schedule</p>
              <p class="font-semibold text-sm">
                @if (classDetail()?.daysOfWeek) { {{ formatDays(classDetail()!.daysOfWeek!) }} }
                @if (classDetail()?.startTime) { <span class="text-gray-500">{{ classDetail()?.startTime }} - {{ classDetail()?.endTime }}</span> }
                @if (!classDetail()?.daysOfWeek && !classDetail()?.startTime) { N/A }
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Dates</p>
              <p class="font-semibold text-sm">{{ formatDate(classDetail()?.startDate) }} → {{ formatDate(classDetail()?.endDate) }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Enrollment</p>
              <p class="font-semibold">{{ classDetail()?.studentCount ?? classDetail()?.currentEnrollment ?? 0 }}
                @if (classDetail()?.maxStudents) { <span class="text-gray-400">/ {{ classDetail()?.maxStudents }}</span> }
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Status</p>
              <p-tag [value]="classDetail()?.isActive ? 'Active' : 'Inactive'" [severity]="classDetail()?.isActive ? 'success' : 'danger'"></p-tag>
            </div>
          </div>
        </p-card>

        <!-- Students Table -->
        <p-card>
          <ng-template pTemplate="header">
            <div class="flex items-center justify-between px-4 pt-4">
              <h2 class="text-xl font-semibold text-gray-800">Enrolled Students</h2>
              <p-button label="Add Student" icon="pi pi-user-plus" severity="secondary" [outlined]="true" (onClick)="addStudent()"></p-button>
            </div>
          </ng-template>

          <p-table
            [value]="enrollments()"
            [loading]="loadingEnrollments()"
            [paginator]="true"
            [rows]="10"
            responsiveLayout="scroll"
          >
            <ng-template pTemplate="header">
              <tr>
                <th>Student</th>
                <th>Enrolled</th>
                <th>Status</th>
                <th>Payment Mode</th>
                <th>Payment Progress</th>
                <th>Payment Status</th>
                <th>Actions</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr>
                <td class="font-medium">
                  <div>{{ row.studentFirstName }} {{ row.studentLastName }}</div>
                  @if (row.enrollmentType === 'MASTER') {
                    <div class="text-xs text-purple-600 font-normal mt-0.5">Bundle: {{ row.masterCourseName }}</div>
                  }
                </td>
                <td class="text-sm">{{ formatDate(row.enrollmentDate) }}</td>
                <td>
                  <p-tag [value]="row.status" [severity]="statusSeverity(row.status)"></p-tag>
                </td>
                <td>
                  <span class="text-sm">
                    @if (row.paymentMode === 'INSTALLMENTS') {
                      <span class="inline-flex items-center gap-1 text-blue-700">
                        <i class="pi pi-credit-card text-xs"></i> Installments
                      </span>
                    } @else {
                      <span class="inline-flex items-center gap-1 text-green-700">
                        <i class="pi pi-check text-xs"></i> Full
                      </span>
                    }
                  </span>
                </td>
                <td>
                  <div class="min-w-32">
                    <div class="flex justify-between text-xs text-gray-500 mb-1">
                      <span>{{ row.amountPaid.toFixed(0) }} paid</span>
                      <span>{{ row.finalPrice.toFixed(0) }} total</span>
                    </div>
                    <p-progressbar
                      [value]="row.finalPrice > 0 ? (row.amountPaid / row.finalPrice) * 100 : 0"
                      [showValue]="false"
                      styleClass="h-2"
                      [style]="{ height: '8px' }"
                    ></p-progressbar>
                  </div>
                </td>
                <td>
                  <p-tag [value]="paymentLabel(row.paymentStatus)" [severity]="paymentSeverity(row.paymentStatus)"></p-tag>
                </td>
                <td>
                  <div class="flex gap-1">
                    @if (row.paymentStatus !== 'PAID') {
                      <p-button
                        icon="pi pi-wallet"
                        [rounded]="true"
                        [text]="true"
                        severity="success"
                        (onClick)="openPaymentDialog(row)"
                        pTooltip="Add Payment"
                      ></p-button>
                    }
                    <p-button
                      icon="pi pi-external-link"
                      [rounded]="true"
                      [text]="true"
                      severity="info"
                      (onClick)="viewStudent(row.studentId)"
                      pTooltip="View Student"
                    ></p-button>
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="7" class="text-center py-8">
                  <div class="text-gray-500">
                    <i class="pi pi-users text-4xl mb-3"></i>
                    <p>No students enrolled</p>
                    <p-button label="Add First Student" icon="pi pi-user-plus" styleClass="mt-3" (onClick)="addStudent()"></p-button>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </p-card>
      }
    </div>

    <!-- Add Payment Dialog -->
    <p-dialog
      [(visible)]="showPaymentDialog"
      [header]="'Add Payment — ' + (selectedEnrollment()?.studentFirstName || '') + ' ' + (selectedEnrollment()?.studentLastName || '')"
      [modal]="true"
      [style]="{ width: '450px' }"
      [closable]="true"
    >
      @if (selectedEnrollment()) {
        <div class="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
          <div class="flex justify-between mb-1">
            <span class="text-gray-600">Final Price:</span>
            <span class="font-semibold">{{ selectedEnrollment()!.finalPrice.toFixed(2) }}</span>
          </div>
          <div class="flex justify-between mb-1">
            <span class="text-gray-600">Paid so far:</span>
            <span class="font-semibold text-green-600">{{ selectedEnrollment()!.amountPaid.toFixed(2) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">Remaining:</span>
            <span class="font-semibold text-red-600">{{ (selectedEnrollment()!.finalPrice - selectedEnrollment()!.amountPaid).toFixed(2) }}</span>
          </div>
        </div>
      }

      <div class="grid gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Amount <span class="text-red-500">*</span></label>
          <p-inputnumber
            [(ngModel)]="paymentAmount"
            [min]="0.01"
            [max]="selectedEnrollment() ? selectedEnrollment()!.finalPrice - selectedEnrollment()!.amountPaid : 99999"
            placeholder="Payment amount"
            [style]="{ width: '100%' }"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Payment Date <span class="text-red-500">*</span></label>
          <p-datepicker
            [(ngModel)]="paymentDate"
            [showIcon]="true"
            dateFormat="yy-mm-dd"
            [style]="{ width: '100%' }"
          ></p-datepicker>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Notes</label>
          <textarea
            pTextarea
            [(ngModel)]="paymentNotes"
            rows="2"
            placeholder="Optional notes..."
            class="w-full"
          ></textarea>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="closePaymentDialog()"></p-button>
        <p-button
          label="Record Payment"
          icon="pi pi-check"
          [loading]="paymentLoading()"
          [disabled]="!paymentAmount || !paymentDate"
          (onClick)="submitPayment()"
        ></p-button>
      </ng-template>
    </p-dialog>
  `
})
export class ClassDetailComponent implements OnInit {
  private classService = inject(ClassService);
  private enrollmentService = inject(EnrollmentService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  classId = '';
  classDetail = signal<ClassWithDetails | null>(null);
  enrollments = signal<any[]>([]);
  loadingClass = signal(true);
  loadingEnrollments = signal(true);

  // Payment dialog
  showPaymentDialog = false;
  selectedEnrollment = signal<any | null>(null);
  paymentAmount: number | null = null;
  paymentDate: Date = new Date();
  paymentNotes = '';
  paymentLoading = signal(false);

  ngOnInit() {
    this.classId = this.route.snapshot.paramMap.get('id') || '';
    if (this.classId) {
      this.loadClassDetail();
      this.loadEnrollments();
    }
  }

  loadClassDetail() {
    this.loadingClass.set(true);
    this.classService.getClassWithDetails(this.classId).subscribe({
      next: (cls) => { this.classDetail.set(cls); this.loadingClass.set(false); },
      error: () => { this.notificationService.error('Failed to load class'); this.loadingClass.set(false); }
    });
  }

  loadEnrollments() {
    this.loadingEnrollments.set(true);
    this.classService.getClassEnrollments(this.classId).subscribe({
      next: (e) => { this.enrollments.set(e); this.loadingEnrollments.set(false); },
      error: () => this.loadingEnrollments.set(false)
    });
  }

  openPaymentDialog(enrollment: any) {
    this.selectedEnrollment.set(enrollment);
    this.paymentAmount = enrollment.finalPrice - enrollment.amountPaid;
    this.paymentDate = new Date();
    this.paymentNotes = '';
    this.showPaymentDialog = true;
  }

  closePaymentDialog() {
    this.showPaymentDialog = false;
    this.selectedEnrollment.set(null);
  }

  submitPayment() {
    if (!this.paymentAmount || !this.paymentDate) return;
    const enrollmentId = this.selectedEnrollment()?.enrollmentId;
    if (!enrollmentId) return;

    this.paymentLoading.set(true);
    this.enrollmentService.addPayment(enrollmentId, {
      amount: this.paymentAmount,
      paymentDate: this.paymentDate.toISOString().split('T')[0],
      notes: this.paymentNotes || undefined
    }).subscribe({
      next: () => {
        this.notificationService.success('Payment recorded successfully');
        this.paymentLoading.set(false);
        this.closePaymentDialog();
        this.loadEnrollments();
      },
      error: () => {
        this.notificationService.error('Failed to record payment');
        this.paymentLoading.set(false);
      }
    });
  }

  addStudent() {
    const cls = this.classDetail();
    const params: any = { classId: this.classId };
    if (cls?.courseId) params['courseId'] = cls.courseId;
    if (cls?.branchId) params['branchId'] = cls.branchId;
    this.router.navigate(['/enrollments/create'], { queryParams: params });
  }

  viewStudent(studentId: string) {
    this.router.navigate(['/students', studentId]);
  }

  goBack() {
    this.router.navigate(['/classes']);
  }

  paymentLabel(status: string): string {
    switch (status?.toUpperCase()) {
      case 'PAID': return 'Complete';
      case 'PARTIAL': return 'Partial';
      case 'PENDING': return 'Pending';
      default: return status || 'Unknown';
    }
  }

  statusSeverity(status: string): 'success' | 'danger' | 'warn' | 'info' | 'secondary' {
    switch (status?.toUpperCase()) {
      case 'ACTIVE': return 'success';
      case 'COMPLETED': return 'info';
      case 'DROPPED': return 'danger';
      case 'PENDING': return 'warn';
      default: return 'secondary';
    }
  }

  paymentSeverity(status: string): 'success' | 'danger' | 'warn' | 'info' | 'secondary' {
    switch (status?.toUpperCase()) {
      case 'PAID': return 'success';
      case 'PARTIAL': return 'info';
      case 'PENDING': return 'warn';
      case 'OVERDUE': return 'danger';
      default: return 'secondary';
    }
  }

  formatDays(days: string): string {
    return days.split(',').map(d => d.trim().slice(0, 3)).join(', ');
  }

  formatDate(dateString?: string): string {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
