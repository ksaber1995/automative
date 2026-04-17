import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CourseService } from '../services/course.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { CourseWithEnrollmentCount } from '@shared/interfaces/course.interface';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-course-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    SelectModule,
    TranslateModule,
  ],
  template: `
    <div class="container-custom py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-900">{{ 'COURSES.LIST.TITLE' | translate }}</h1>
        <p-button [label]="'COURSES.LIST.ADD' | translate" icon="pi pi-plus" (onClick)="createCourse()"></p-button>
      </div>

      <p-card>
        <!-- Filters -->
        <div class="flex flex-wrap gap-3 mb-4">
          <p-select
            [options]="branchOptions()"
            [ngModel]="selectedBranchId()"
            (ngModelChange)="selectedBranchId.set($event)"
            optionLabel="label"
            optionValue="value"
            placeholder="All Branches"
            [showClear]="true"
            [style]="{ minWidth: '200px' }"
          ></p-select>

          <p-select
            [options]="statusOptions"
            [ngModel]="selectedStatus()"
            (ngModelChange)="selectedStatus.set($event)"
            optionLabel="label"
            optionValue="value"
            placeholder="All Statuses"
            [showClear]="true"
            [style]="{ minWidth: '160px' }"
          ></p-select>

          @if (selectedBranchId() || selectedStatus() !== null) {
            <p-button
              label="Clear"
              icon="pi pi-times"
              severity="secondary"
              [outlined]="true"
              (onClick)="clearFilters()"
            ></p-button>
          }

          @if (selectedBranchId() || selectedStatus() !== null) {
            <span class="ml-auto text-sm text-gray-500 self-center">
              {{ filteredCourses().length }} / {{ courses().length }} courses
            </span>
          }
        </div>

        <p-table
          [value]="filteredCourses()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          [showCurrentPageReport]="true"
          [currentPageReportTemplate]="'COURSES.LIST.PAGE_REPORT' | translate"
          responsiveLayout="scroll"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="code">{{ 'COURSES.LIST.COL_CODE' | translate }} <p-sortIcon field="code"></p-sortIcon></th>
              <th pSortableColumn="name">{{ 'COURSES.LIST.COL_NAME' | translate }} <p-sortIcon field="name"></p-sortIcon></th>
              <th>Branch</th>
              <th pSortableColumn="duration">{{ 'COURSES.LIST.COL_DURATION' | translate }}</th>
              <th pSortableColumn="price">{{ 'COURSES.LIST.COL_PRICE' | translate }} <p-sortIcon field="price"></p-sortIcon></th>
              <th>{{ 'COURSES.LIST.COL_MAX_STUDENTS' | translate }}</th>
              <th>{{ 'COURSES.LIST.COL_ENROLLMENTS' | translate }}</th>
              <th pSortableColumn="isActive">{{ 'COURSES.LIST.COL_STATUS' | translate }} <p-sortIcon field="isActive"></p-sortIcon></th>
              <th>{{ 'COURSES.LIST.COL_ACTIONS' | translate }}</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-course>
            <tr>
              <td>{{ course.code }}</td>
              <td>{{ course.name }}</td>
              <td>{{ getBranchName(course.branchId) }}</td>
              <td>{{ course.duration }} {{ 'COURSES.LIST.WEEKS' | translate }}</td>
              <td>{{ course.price.toFixed(2) }}</td>
              <td>{{ course.maxStudents || ('COURSES.LIST.UNLIMITED' | translate) }}</td>
              <td>
                <p-tag [value]="course.enrollmentCount || 0" severity="info"></p-tag>
              </td>
              <td>
                <p-tag
                  [value]="course.isActive ? ('COURSES.LIST.ACTIVE' | translate) : ('COURSES.LIST.INACTIVE' | translate)"
                  [severity]="course.isActive ? 'success' : 'danger'"
                ></p-tag>
              </td>
              <td>
                <div class="flex gap-2">
                  <p-button
                    icon="pi pi-eye"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    (onClick)="viewCourse(course)"
                    [pTooltip]="'COURSES.LIST.VIEW' | translate"
                  ></p-button>
                  @if (authService.canWrite('courses')) {
                    <p-button
                      icon="pi pi-pencil"
                      [rounded]="true"
                      [text]="true"
                      severity="warn"
                      (onClick)="editCourse(course)"
                      [pTooltip]="'COURSES.LIST.EDIT' | translate"
                    ></p-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9" class="text-center py-8">
                <div class="text-gray-500">
                  <i class="pi pi-inbox text-4xl mb-3"></i>
                  <p>{{ 'COURSES.LIST.NO_COURSES' | translate }}</p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `
})
export class CourseListComponent implements OnInit {
  private courseService = inject(CourseService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  authService = inject(AuthService);

  courses = signal<CourseWithEnrollmentCount[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);

  selectedBranchId = signal<string | null>(null);
  selectedStatus = signal<boolean | null>(null);

  statusOptions = [
    { label: 'Active', value: true },
    { label: 'Inactive', value: false },
  ];

  branchOptions = computed(() => [
    { label: 'Global (No Branch)', value: '__global__' },
    ...this.branches().map(b => ({ label: b.name, value: b.id })),
  ]);

  filteredCourses = computed(() => {
    const branch = this.selectedBranchId();
    const status = this.selectedStatus();
    return this.courses().filter(c => {
      if (branch !== null) {
        if (branch === '__global__') { if (c.branchId !== null) return false; }
        else { if (c.branchId !== branch) return false; }
      }
      if (status !== null && c.isActive !== status) return false;
      return true;
    });
  });

  ngOnInit() {
    this.loadCourses();
    this.branchService.getAllBranches().subscribe({
      next: (branches) => this.branches.set(branches),
    });
  }

  loadCourses() {
    this.loading.set(true);
    this.courseService.getAllCourses().subscribe({
      next: (courses) => {
        this.courses.set(courses);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load courses');
        this.loading.set(false);
      }
    });
  }

  getBranchName(branchId: string | null): string {
    if (!branchId) return 'Global';
    return this.branches().find(b => b.id === branchId)?.name ?? branchId;
  }

  clearFilters() {
    this.selectedBranchId.set(null);
    this.selectedStatus.set(null);
  }

  viewCourse(course: CourseWithEnrollmentCount) {
    this.router.navigate(['/courses', course.id]);
  }

  editCourse(course: CourseWithEnrollmentCount) {
    this.router.navigate(['/courses', course.id, 'edit']);
  }

  createCourse() {
    this.router.navigate(['/courses/create']);
  }
}
