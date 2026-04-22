import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ClassService } from '../services/class.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ClassWithDetails } from '@shared/interfaces/class.interface';

@Component({
  selector: 'app-class-detail',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
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
                  <p-button
                    icon="pi pi-external-link"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    (onClick)="viewStudent(row.studentId)"
                    pTooltip="View Student"
                  ></p-button>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="4" class="text-center py-8">
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
  `
})
export class ClassDetailComponent implements OnInit {
  private classService = inject(ClassService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  classId = '';
  classDetail = signal<ClassWithDetails | null>(null);
  enrollments = signal<any[]>([]);
  loadingClass = signal(true);
  loadingEnrollments = signal(true);

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

  statusSeverity(status: string): 'success' | 'danger' | 'warn' | 'info' | 'secondary' {
    switch (status?.toUpperCase()) {
      case 'ACTIVE': return 'success';
      case 'COMPLETED': return 'info';
      case 'DROPPED': return 'danger';
      case 'PENDING': return 'warn';
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
