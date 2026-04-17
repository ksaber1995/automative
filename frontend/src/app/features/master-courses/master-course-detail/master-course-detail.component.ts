import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { MasterCourseService, AvailableCourse } from '../services/master-course.service';
import { MasterEnrollmentService } from '../services/master-enrollment.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  MasterCourse,
  LinkedCourseSummary,
} from '@shared/interfaces/master-course.interface';
import { MasterEnrollmentProgress } from '@shared/interfaces/master-enrollment.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-master-course-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    DialogModule,
    SelectModule,
    TooltipModule,
    TranslateModule,
    DeleteConfirmDialogComponent,
  ],
  template: `
    <div class="container-custom py-8">
      <div class="mb-6 flex justify-between items-start">
        <div>
          <p-button
            icon="pi pi-arrow-left"
            [text]="true"
            [label]="'MASTER_COURSES.DETAIL.BACK' | translate"
            (onClick)="back()"
          ></p-button>
          <h1 class="text-3xl font-bold text-gray-900 mt-2">{{ master()?.name }}</h1>
          <p class="text-gray-600 font-mono">{{ master()?.code }}</p>
          @if (master()?.branchName) {
            <p class="text-sm text-gray-500 mt-1">
              <i class="pi pi-building mr-1"></i>{{ master()?.branchName }}
            </p>
          }
        </div>
        @if (master() && authService.canWrite('master_courses')) {
          <div class="flex gap-2 flex-wrap">
            <p-button
              icon="pi pi-pencil"
              [label]="'MASTER_COURSES.DETAIL.EDIT' | translate"
              severity="secondary"
              [outlined]="true"
              (onClick)="edit()"
            ></p-button>
            <p-button
              icon="pi pi-plus"
              [label]="'MASTER_COURSES.DETAIL.ADD_COURSE' | translate"
              severity="info"
              (onClick)="openAddDialog()"
            ></p-button>
          </div>
        }
      </div>

      @if (master(); as m) {
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <p-card>
            <div class="text-sm text-gray-500">{{ 'MASTER_COURSES.DETAIL.BUNDLE_PRICE' | translate }}</div>
            <div class="text-2xl font-bold">{{ m.defaultPrice.toFixed(2) }}</div>
          </p-card>
          <p-card>
            <div class="text-sm text-gray-500">{{ 'MASTER_COURSES.DETAIL.SUM_OF_COURSES' | translate }}</div>
            <div class="text-2xl font-bold">{{ sumOfLinked().toFixed(2) }}</div>
          </p-card>
          <p-card>
            <div class="text-sm text-gray-500">{{ 'MASTER_COURSES.DETAIL.SAVINGS' | translate }}</div>
            <div class="text-2xl font-bold" [class.text-green-700]="savings() >= 0" [class.text-red-700]="savings() < 0">
              {{ savings().toFixed(2) }}
            </div>
          </p-card>
          <p-card>
            <div class="text-sm text-gray-500">{{ 'MASTER_COURSES.DETAIL.COURSE_COUNT' | translate }}</div>
            <div class="text-2xl font-bold">{{ (linked()?.length || 0) }}</div>
          </p-card>
        </div>

        @if (m.description) {
          <p-card styleClass="mb-6">
            <div class="text-sm text-gray-500 mb-2">{{ 'MASTER_COURSES.DETAIL.DESCRIPTION' | translate }}</div>
            <div class="text-gray-800 whitespace-pre-line">{{ m.description }}</div>
          </p-card>
        }
      }

      <p-card>
        <ng-template pTemplate="header">
          <div class="px-6 py-4 border-b">
            <h3 class="text-xl font-semibold">
              {{ 'MASTER_COURSES.DETAIL.LINKED_COURSES' | translate }}
              <span class="text-sm font-normal text-gray-500 ml-2">({{ linked()?.length || 0 }})</span>
            </h3>
            <p class="text-sm text-gray-500 mt-1">{{ 'MASTER_COURSES.DETAIL.BUNDLE_HINT' | translate }}</p>
          </div>
        </ng-template>

        <p-table [value]="linked() || []" [loading]="loadingLinked()" responsiveLayout="scroll">
          <ng-template pTemplate="header">
            <tr>
              <th>{{ 'MASTER_COURSES.DETAIL.COL_NAME' | translate }}</th>
              <th>{{ 'MASTER_COURSES.DETAIL.COL_CODE' | translate }}</th>
              <th class="text-right">{{ 'MASTER_COURSES.DETAIL.COL_PRICE' | translate }}</th>
              <th class="text-right">{{ 'MASTER_COURSES.DETAIL.COL_DURATION' | translate }}</th>
              <th>{{ 'MASTER_COURSES.DETAIL.COL_STATUS' | translate }}</th>
              @if (authService.canWrite('master_courses')) {
                <th>{{ 'MASTER_COURSES.DETAIL.COL_ACTIONS' | translate }}</th>
              }
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td class="font-medium">{{ row.name }}</td>
              <td><span class="font-mono">{{ row.code }}</span></td>
              <td class="text-right">{{ row.price.toFixed(2) }}</td>
              <td class="text-right">{{ row.duration }} {{ 'MASTER_COURSES.WEEKS' | translate }}</td>
              <td>
                <p-tag
                  [value]="row.isActive ? ('MASTER_COURSES.ACTIVE' | translate) : ('MASTER_COURSES.INACTIVE' | translate)"
                  [severity]="row.isActive ? 'success' : 'danger'"
                ></p-tag>
              </td>
              @if (authService.canWrite('master_courses')) {
                <td>
                  <p-button
                    icon="pi pi-times"
                    [rounded]="true"
                    [text]="true"
                    severity="danger"
                    (onClick)="confirmRemove(row)"
                    [pTooltip]="'MASTER_COURSES.DETAIL.REMOVE_COURSE' | translate"
                  ></p-button>
                </td>
              }
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td [attr.colspan]="authService.canWrite('master_courses') ? 6 : 5" class="text-center py-6 text-gray-500">
                {{ 'MASTER_COURSES.DETAIL.NO_LINKED' | translate }}
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- Enrolled students -->
      <p-card styleClass="mt-6">
        <ng-template pTemplate="header">
          <div class="px-6 py-4 border-b">
            <h3 class="text-xl font-semibold">
              Enrolled Students
              <span class="text-sm font-normal text-gray-500 ml-2">({{ enrollments()?.length || 0 }})</span>
            </h3>
          </div>
        </ng-template>

        <p-table [value]="enrollments() || []" [loading]="loadingEnrollments()" responsiveLayout="scroll">
          <ng-template pTemplate="header">
            <tr>
              <th>Student</th>
              <th>Status</th>
              <th>Payment</th>
              <th class="text-center">Completed</th>
              <th class="text-center">In Progress</th>
              <th class="text-center">Pending</th>
              <th class="text-center">Total</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-e>
            <tr>
              <td class="font-medium">{{ e.studentName }}</td>
              <td>
                <p-tag
                  [value]="e.status"
                  [severity]="e.status === 'ACTIVE' ? 'success' : e.status === 'COMPLETED' ? 'info' : 'danger'"
                ></p-tag>
              </td>
              <td>
                <p-tag
                  [value]="e.paymentStatus"
                  [severity]="e.paymentStatus === 'PAID' ? 'success' : e.paymentStatus === 'PARTIAL' ? 'warn' : 'danger'"
                ></p-tag>
              </td>
              <td class="text-center">
                <span class="text-green-700 font-semibold">{{ e.completedCourses }}</span>
              </td>
              <td class="text-center">
                <span class="text-blue-700 font-semibold">{{ e.activeCourses }}</span>
              </td>
              <td class="text-center">
                <span class="text-gray-500 font-semibold">{{ e.pendingCourses }}</span>
              </td>
              <td class="text-center font-semibold">{{ e.totalCourses }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7" class="text-center py-6 text-gray-500">No students enrolled yet.</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- Add course dialog -->
      <p-dialog
        [(visible)]="showAddDialog"
        [modal]="true"
        [header]="'MASTER_COURSES.ADD_COURSE.TITLE' | translate"
        [style]="{ width: '480px' }"
      >
        <p class="text-gray-600 mb-4">{{ 'MASTER_COURSES.ADD_COURSE.DESC' | translate }}</p>
        @if (loadingAvailable()) {
          <div class="text-center py-4"><i class="pi pi-spin pi-spinner text-2xl text-gray-400"></i></div>
        } @else if ((available()?.length || 0) === 0) {
          <div class="text-center py-4 text-gray-500">{{ 'MASTER_COURSES.ADD_COURSE.NONE' | translate }}</div>
        } @else {
          <label class="block text-sm font-medium mb-2">{{ 'MASTER_COURSES.ADD_COURSE.SELECT' | translate }}</label>
          <p-select
            [(ngModel)]="pickedCourseId"
            [options]="available() || []"
            optionLabel="name"
            optionValue="id"
            [placeholder]="'MASTER_COURSES.ADD_COURSE.PLACEHOLDER' | translate"
            [style]="{ width: '100%' }"
            appendTo="body"
          >
            <ng-template let-c pTemplate="item">
              <div class="flex justify-between items-center gap-3">
                <span>{{ c.name }} <span class="text-xs text-gray-500 font-mono ml-2">{{ c.code }}</span></span>
                <span class="text-sm text-gray-600">{{ c.price.toFixed(2) }}</span>
              </div>
            </ng-template>
          </p-select>
        }
        <ng-template pTemplate="footer">
          <p-button
            [label]="'MASTER_COURSES.ADD_COURSE.CANCEL' | translate"
            severity="secondary"
            [outlined]="true"
            (onClick)="showAddDialog = false"
          ></p-button>
          <p-button
            [label]="'MASTER_COURSES.ADD_COURSE.CONFIRM' | translate"
            severity="info"
            [loading]="adding()"
            [disabled]="!pickedCourseId"
            (onClick)="doAdd()"
          ></p-button>
        </ng-template>
      </p-dialog>

      <app-delete-confirm-dialog
        [(visible)]="showRemoveDialog"
        [header]="'MASTER_COURSES.DETAIL.REMOVE_TITLE' | translate"
        [message]="'MASTER_COURSES.DETAIL.REMOVE_MSG' | translate: { name: toRemove()?.name }"
        (confirm)="doRemove()"
      ></app-delete-confirm-dialog>
    </div>
  `,
})
export class MasterCourseDetailComponent implements OnInit {
  private service = inject(MasterCourseService);
  private enrollmentService = inject(MasterEnrollmentService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  authService = inject(AuthService);

  id!: string;
  master = signal<MasterCourse | null>(null);
  linked = signal<LinkedCourseSummary[] | null>(null);
  loadingLinked = signal(true);

  showAddDialog = false;
  available = signal<AvailableCourse[] | null>(null);
  loadingAvailable = signal(false);
  pickedCourseId: string | null = null;
  adding = signal(false);

  enrollments = signal<MasterEnrollmentProgress[] | null>(null);
  loadingEnrollments = signal(true);

  showRemoveDialog = false;
  toRemove = signal<LinkedCourseSummary | null>(null);

  sumOfLinked = computed(() =>
    (this.linked() || []).reduce((sum, c) => sum + (c.price || 0), 0)
  );
  savings = computed(() => this.sumOfLinked() - (this.master()?.defaultPrice || 0));

  ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id')!;
    this.loadMaster();
    this.loadLinked();
    this.loadEnrollments();
  }

  loadMaster() {
    this.service.getById(this.id).subscribe({
      next: (m) => this.master.set(m),
      error: () => {
        this.notifications.error('Failed to load master course');
        this.router.navigate(['/master-courses']);
      },
    });
  }

  loadLinked() {
    this.loadingLinked.set(true);
    this.service.getLinkedCourses(this.id).subscribe({
      next: (rows) => { this.linked.set(rows); this.loadingLinked.set(false); },
      error: () => { this.loadingLinked.set(false); },
    });
  }

  loadEnrollments() {
    this.loadingEnrollments.set(true);
    this.enrollmentService.listByMaster(this.id).subscribe({
      next: (rows) => { this.enrollments.set(rows); this.loadingEnrollments.set(false); },
      error: () => { this.loadingEnrollments.set(false); },
    });
  }

  openAddDialog() {
    this.pickedCourseId = null;
    this.available.set(null);
    this.loadingAvailable.set(true);
    this.showAddDialog = true;
    this.service.getAvailableCourses(this.id).subscribe({
      next: (rows) => { this.available.set(rows); this.loadingAvailable.set(false); },
      error: () => { this.loadingAvailable.set(false); this.available.set([]); },
    });
  }

  doAdd() {
    if (!this.pickedCourseId) return;
    this.adding.set(true);
    this.service.addCourse(this.id, this.pickedCourseId).subscribe({
      next: () => {
        this.adding.set(false);
        this.showAddDialog = false;
        this.notifications.success('Course added to master');
        this.loadLinked();
      },
      error: (err) => {
        this.adding.set(false);
        this.notifications.error(err?.error?.message || 'Failed to add course');
      },
    });
  }

  confirmRemove(row: LinkedCourseSummary) {
    this.toRemove.set(row);
    this.showRemoveDialog = true;
  }

  doRemove() {
    const row = this.toRemove();
    if (!row) return;
    this.service.removeCourse(this.id, row.id).subscribe({
      next: () => {
        this.notifications.success('Course removed');
        this.showRemoveDialog = false;
        this.toRemove.set(null);
        this.loadLinked();
      },
      error: (err) => {
        this.notifications.error(err?.error?.message || 'Failed to remove');
        this.showRemoveDialog = false;
      },
    });
  }

  edit() { this.router.navigate(['/master-courses', this.id, 'edit']); }
  back() { this.router.navigate(['/master-courses']); }
}
