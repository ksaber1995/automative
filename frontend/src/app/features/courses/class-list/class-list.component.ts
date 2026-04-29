import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { TabsModule } from 'primeng/tabs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ClassService } from '../services/class.service';
import { CourseService } from '../services/course.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ClassStatus, ClassWithDetails } from '@shared/interfaces/class.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-class-list',
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
    TabsModule,
    TranslateModule,
    DeleteConfirmDialogComponent
  ],
  template: `
    <div class="container-custom py-8">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">{{ 'CLASSES.LIST.TITLE' | translate }}</h1>
          <p class="text-gray-500 mt-1">{{ 'CLASSES.LIST.SUBTITLE' | translate }}</p>
        </div>
        @if (!filterByCourseId) {
          <p-button [label]="'CLASSES.LIST.ADD' | translate" icon="pi pi-plus" (onClick)="selectCourseForNewClass()"></p-button>
        }
        @if (filterByCourseId) {
          <p-button [label]="'CLASSES.LIST.ADD' | translate" icon="pi pi-plus" (onClick)="createClass()"></p-button>
        }
      </div>

      <!-- Filters -->
      <p-card styleClass="mb-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="field">
            <label for="courseFilter" class="block text-sm font-medium text-gray-700 mb-2">
              {{ 'CLASSES.LIST.FILTER_COURSE' | translate }}
            </label>
            <p-select
              id="courseFilter"
              [(ngModel)]="selectedCourseId"
              [options]="courses()"
              optionLabel="label"
              optionValue="value"
              [placeholder]="'CLASSES.LIST.ALL_COURSES' | translate"
              styleClass="w-full"
              (onChange)="onFilterChange()">
            </p-select>
          </div>

          <div class="field">
            <label for="branchFilter" class="block text-sm font-medium text-gray-700 mb-2">
              {{ 'CLASSES.LIST.FILTER_BRANCH' | translate }}
            </label>
            <p-select
              id="branchFilter"
              [(ngModel)]="selectedBranchId"
              [options]="branches()"
              optionLabel="label"
              optionValue="value"
              [placeholder]="'CLASSES.LIST.ALL_BRANCHES' | translate"
              styleClass="w-full"
              (onChange)="onFilterChange()">
            </p-select>
          </div>

          <div class="field flex items-end">
            <p-button
              [label]="'CLASSES.LIST.CLEAR_FILTERS' | translate"
              icon="pi pi-filter-slash"
              severity="secondary"
              [outlined]="true"
              (onClick)="clearFilters()"
              styleClass="w-full">
            </p-button>
          </div>
        </div>
      </p-card>

      <p-tabs [value]="activeStatus()" (valueChange)="onStatusTabChange($event)" styleClass="mb-4">
        <p-tablist>
          <p-tab value="IN_PROGRESS">
            <i class="pi pi-spin pi-spinner mr-2"></i>In Progress
            <span class="ml-2 text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">{{ countByStatus('IN_PROGRESS') }}</span>
          </p-tab>
          <p-tab value="SCHEDULED">
            <i class="pi pi-calendar mr-2"></i>Scheduled
            <span class="ml-2 text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{{ countByStatus('SCHEDULED') }}</span>
          </p-tab>
          <p-tab value="DONE">
            <i class="pi pi-check-circle mr-2"></i>Done
            <span class="ml-2 text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-0.5">{{ countByStatus('DONE') }}</span>
          </p-tab>
        </p-tablist>
      </p-tabs>

      <p-card>
        <p-table
          [value]="filteredClasses()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          [showCurrentPageReport]="true"
          [currentPageReportTemplate]="'CLASSES.LIST.PAGE_REPORT' | translate"
          responsiveLayout="scroll"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="code">{{ 'CLASSES.LIST.COL_CODE' | translate }} <p-sortIcon field="code"></p-sortIcon></th>
              <th pSortableColumn="name">{{ 'CLASSES.LIST.COL_NAME' | translate }} <p-sortIcon field="name"></p-sortIcon></th>
              <th>{{ 'CLASSES.LIST.COL_COURSE' | translate }}</th>
              <th>{{ 'CLASSES.LIST.COL_BRANCH' | translate }}</th>
              <th>{{ 'CLASSES.LIST.COL_INSTRUCTOR' | translate }}</th>
              <th>{{ 'CLASSES.LIST.COL_SCHEDULE' | translate }}</th>
              <th>{{ 'CLASSES.LIST.COL_DATES' | translate }}</th>
              <th>{{ 'CLASSES.LIST.COL_ENROLLMENT' | translate }}</th>
              <th pSortableColumn="isActive">{{ 'CLASSES.LIST.COL_STATUS' | translate }} <p-sortIcon field="isActive"></p-sortIcon></th>
              <th>{{ 'CLASSES.LIST.COL_ACTIONS' | translate }}</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-classItem>
            <tr>
              <td>{{ classItem.code }}</td>
              <td>{{ classItem.name }}</td>
              <td>{{ classItem.courseName || 'N/A' }}</td>
              <td>{{ classItem.branchName || 'N/A' }}</td>
              <td>{{ classItem.instructorName || ('CLASSES.LIST.NOT_ASSIGNED' | translate) }}</td>
              <td>
                <div class="text-sm">
                  @if (classItem.daysOfWeek) {
                    <div>{{ formatDaysOfWeek(classItem.daysOfWeek) }}</div>
                  }
                  @if (classItem.startTime && classItem.endTime) {
                    <div class="text-gray-500">{{ classItem.startTime }} - {{ classItem.endTime }}</div>
                  }
                  @if (!classItem.daysOfWeek && !classItem.startTime) {
                    <span class="text-gray-400">{{ 'CLASSES.LIST.NOT_SPECIFIED' | translate }}</span>
                  }
                </div>
              </td>
              <td>
                <div class="text-sm">
                  <div>{{ formatDate(classItem.startDate) }}</div>
                  <div class="text-gray-500">{{ 'CLASSES.LIST.DATE_TO' | translate }} {{ formatDate(classItem.endDate) }}</div>
                </div>
              </td>
              <td>
                <div class="text-sm">
                  <span class="font-medium">{{ classItem.studentCount ?? classItem.currentEnrollment ?? 0 }}</span>
                  @if (classItem.maxStudents) {
                    <span class="text-gray-500"> / {{ classItem.maxStudents }}</span>
                  }
                </div>
              </td>
              <td>
                <p-tag
                  [value]="statusLabel(classItem.status)"
                  [severity]="statusSeverity(classItem.status)"
                ></p-tag>
              </td>
              <td>
                <div class="flex gap-2">
                  <p-button
                    icon="pi pi-eye"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    (onClick)="viewClass(classItem)"
                    [pTooltip]="'CLASSES.LIST.VIEW' | translate"
                  ></p-button>
                  @if (classItem.status !== 'DONE') {
                    <p-button
                      icon="pi pi-pencil"
                      [rounded]="true"
                      [text]="true"
                      severity="warn"
                      (onClick)="editClass(classItem)"
                      [pTooltip]="'CLASSES.LIST.EDIT' | translate"
                    ></p-button>
                  }
                  @if (classItem.isActive && classItem.status !== 'DONE') {
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="confirmDelete(classItem)"
                      [pTooltip]="'CLASSES.LIST.DELETE' | translate"
                    ></p-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="10" class="text-center py-8">
                <div class="text-gray-500">
                  <i class="pi pi-inbox text-4xl mb-3"></i>
                  <p>{{ 'CLASSES.LIST.NO_CLASSES' | translate }}</p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <app-delete-confirm-dialog
        [(visible)]="showDeleteDialog"
        [header]="'CLASSES.LIST.DELETE_TITLE' | translate"
        [message]="'CLASSES.LIST.DELETE_MSG' | translate: { name: classToDelete()?.name }"
        (confirm)="deleteClass()"
      ></app-delete-confirm-dialog>
    </div>
  `
})
export class ClassListComponent implements OnInit {
  private classService = inject(ClassService);
  private courseService = inject(CourseService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);

  classes = signal<ClassWithDetails[]>([]);
  courses = signal<any[]>([]);
  branches = signal<any[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  classToDelete = signal<ClassWithDetails | null>(null);
  activeStatus = signal<ClassStatus>('IN_PROGRESS');

  filteredClasses = () => this.classes().filter(c => (c.status ?? this.deriveStatus(c)) === this.activeStatus());

  countByStatus(status: ClassStatus): number {
    return this.classes().filter(c => (c.status ?? this.deriveStatus(c)) === status).length;
  }

  onStatusTabChange(val: string | number | undefined) {
    const v = (val?.toString() ?? 'IN_PROGRESS') as ClassStatus;
    this.activeStatus.set(v);
  }

  statusLabel(status?: ClassStatus | string): string {
    switch (status) {
      case 'IN_PROGRESS': return 'In Progress';
      case 'SCHEDULED': return 'Scheduled';
      case 'DONE': return 'Done';
      default: return 'Unknown';
    }
  }

  statusSeverity(status?: ClassStatus | string): 'success' | 'info' | 'secondary' | 'warn' {
    switch (status) {
      case 'IN_PROGRESS': return 'success';
      case 'SCHEDULED': return 'info';
      case 'DONE': return 'secondary';
      default: return 'warn';
    }
  }

  private deriveStatus(c: ClassWithDetails): ClassStatus {
    if (c.isFinished) return 'DONE';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (c.startDate && new Date(c.startDate).getTime() > today.getTime()) return 'SCHEDULED';
    return 'IN_PROGRESS';
  }

  // Filter from route params (when viewing classes for a specific course)
  filterByCourseId: string | null = null;

  // User-selected filters
  selectedCourseId: string | null = null;
  selectedBranchId: string | null = null;

  ngOnInit() {
    // Check if we're filtering by course from route params
    this.filterByCourseId = this.route.snapshot.paramMap.get('courseId');

    this.loadCourses();
    this.loadBranches();
    this.loadClasses();
  }

  loadCourses() {
    this.courseService.getActiveCourses().subscribe({
      next: (courses) => {
        this.courses.set([
          { label: this.translate.instant('CLASSES.LIST.ALL_COURSES'), value: null },
          ...courses.map(c => ({ label: c.name, value: c.id }))
        ]);
      }
    });
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set([
          { label: this.translate.instant('CLASSES.LIST.ALL_BRANCHES'), value: null },
          ...branches.map(b => ({ label: b.name, value: b.id }))
        ]);
      }
    });
  }

  loadClasses() {
    this.loading.set(true);
    const courseId = this.filterByCourseId || this.selectedCourseId;
    const branchId = this.selectedBranchId;

    if (courseId) {
      this.classService.getClassesByCourse(courseId).subscribe({
        next: (classes) => {
          this.classes.set(this.filterByBranch(classes, branchId));
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
    } else if (branchId) {
      this.classService.getClassesByBranch(branchId).subscribe({
        next: (classes) => {
          this.classes.set(classes);
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
    } else {
      this.classService.getAllClasses().subscribe({
        next: (classes) => {
          this.classes.set(classes);
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
    }
  }

  filterByBranch(classes: any[], branchId: string | null) {
    if (!branchId) return classes;
    return classes.filter(c => c.branchId === branchId);
  }

  onFilterChange() {
    this.loadClasses();
  }

  clearFilters() {
    this.selectedCourseId = null;
    this.selectedBranchId = null;
    this.loadClasses();
  }

  viewClass(classItem: ClassWithDetails) {
    this.router.navigate(['/classes', classItem.id]);
  }

  editClass(classItem: ClassWithDetails) {
    this.router.navigate(['/courses', classItem.courseId, 'classes', classItem.id, 'edit']);
  }

  confirmDelete(classItem: ClassWithDetails) {
    this.classToDelete.set(classItem);
    this.showDeleteDialog = true;
  }

  deleteClass() {
    const classItem = this.classToDelete();
    if (!classItem) return;

    this.classService.deleteClass(classItem.id).subscribe({
      next: () => {
        this.notificationService.success('Class deleted successfully');
        this.loadClasses();
        this.showDeleteDialog = false;
        this.classToDelete.set(null);
      },
      error: () => {
        this.notificationService.error('Failed to delete class');
        this.showDeleteDialog = false;
      }
    });
  }

  createClass() {
    const courseId = this.filterByCourseId || this.selectedCourseId;
    if (courseId) {
      this.router.navigate(['/courses', courseId, 'classes', 'create']);
    } else {
      this.router.navigate(['/classes/create']);
    }
  }

  selectCourseForNewClass() {
    this.router.navigate(['/classes/create']);
  }

  formatDaysOfWeek(days: string): string {
    if (!days) return '';
    const dayList = days.split(',').map(d => d.trim());
    const shortDays = dayList.map(d => {
      return this.translate.instant('CLASSES.LIST.DAY_' + d);
    });
    return shortDays.join(', ');
  }

  formatDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
