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
import { ClassService } from '../services/class.service';
import { CourseService } from '../services/course.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ClassWithDetails } from '@shared/interfaces/class.interface';
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
    DeleteConfirmDialogComponent
  ],
  template: `
    <div class="container-custom py-8">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">Classes</h1>
          <p class="text-gray-500 mt-1">Manage class schedules and sessions</p>
        </div>
        @if (!filterByCourseId) {
          <p-button label="Add Class" icon="pi pi-plus" (onClick)="selectCourseForNewClass()"></p-button>
        }
        @if (filterByCourseId) {
          <p-button label="Add Class" icon="pi pi-plus" (onClick)="createClass()"></p-button>
        }
      </div>

      <!-- Filters -->
      <p-card styleClass="mb-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="field">
            <label for="courseFilter" class="block text-sm font-medium text-gray-700 mb-2">
              Filter by Course
            </label>
            <p-select
              id="courseFilter"
              [(ngModel)]="selectedCourseId"
              [options]="courses()"
              optionLabel="label"
              optionValue="value"
              placeholder="All Courses"
              styleClass="w-full"
              (onChange)="onFilterChange()">
            </p-select>
          </div>

          <div class="field">
            <label for="branchFilter" class="block text-sm font-medium text-gray-700 mb-2">
              Filter by Branch
            </label>
            <p-select
              id="branchFilter"
              [(ngModel)]="selectedBranchId"
              [options]="branches()"
              optionLabel="label"
              optionValue="value"
              placeholder="All Branches"
              styleClass="w-full"
              (onChange)="onFilterChange()">
            </p-select>
          </div>

          <div class="field flex items-end">
            <p-button
              label="Clear Filters"
              icon="pi pi-filter-slash"
              severity="secondary"
              [outlined]="true"
              (onClick)="clearFilters()"
              styleClass="w-full">
            </p-button>
          </div>
        </div>
      </p-card>

      <p-card>
        <p-table
          [value]="classes()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Showing {first} to {last} of {totalRecords} classes"
          responsiveLayout="scroll"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="code">Code <p-sortIcon field="code"></p-sortIcon></th>
              <th pSortableColumn="name">Name <p-sortIcon field="name"></p-sortIcon></th>
              <th>Course</th>
              <th>Branch</th>
              <th>Instructor</th>
              <th>Schedule</th>
              <th>Dates</th>
              <th>Enrollment</th>
              <th pSortableColumn="isActive">Status <p-sortIcon field="isActive"></p-sortIcon></th>
              <th>Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-classItem>
            <tr>
              <td>{{ classItem.code }}</td>
              <td>{{ classItem.name }}</td>
              <td>{{ classItem.courseName || 'N/A' }}</td>
              <td>{{ classItem.branchName || 'N/A' }}</td>
              <td>{{ classItem.instructorName || 'Not assigned' }}</td>
              <td>
                <div class="text-sm">
                  @if (classItem.daysOfWeek) {
                    <div>{{ formatDaysOfWeek(classItem.daysOfWeek) }}</div>
                  }
                  @if (classItem.startTime && classItem.endTime) {
                    <div class="text-gray-500">{{ classItem.startTime }} - {{ classItem.endTime }}</div>
                  }
                  @if (!classItem.daysOfWeek && !classItem.startTime) {
                    <span class="text-gray-400">Not specified</span>
                  }
                </div>
              </td>
              <td>
                <div class="text-sm">
                  <div>{{ formatDate(classItem.startDate) }}</div>
                  <div class="text-gray-500">to {{ formatDate(classItem.endDate) }}</div>
                </div>
              </td>
              <td>
                <div class="text-sm">
                  <span class="font-medium">{{ classItem.currentEnrollment || 0 }}</span>
                  @if (classItem.maxStudents) {
                    <span class="text-gray-500"> / {{ classItem.maxStudents }}</span>
                  }
                </div>
              </td>
              <td>
                <p-tag
                  [value]="classItem.isActive ? 'Active' : 'Inactive'"
                  [severity]="classItem.isActive ? 'success' : 'danger'"
                ></p-tag>
              </td>
              <td>
                <div class="flex gap-2">
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    severity="warn"
                    (onClick)="editClass(classItem)"
                    pTooltip="Edit"
                  ></p-button>
                  @if (classItem.isActive) {
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="confirmDelete(classItem)"
                      pTooltip="Delete"
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
                  <p>No classes found</p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <app-delete-confirm-dialog
        [(visible)]="showDeleteDialog"
        [header]="'Delete Class'"
        [message]="'Are you sure you want to delete ' + classToDelete()?.name + '? This will permanently remove the class.'"
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

  classes = signal<ClassWithDetails[]>([]);
  courses = signal<any[]>([]);
  branches = signal<any[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  classToDelete = signal<ClassWithDetails | null>(null);

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
          { label: 'All Courses', value: null },
          ...courses.map(c => ({ label: c.name, value: c.id }))
        ]);
      }
    });
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set([
          { label: 'All Branches', value: null },
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
      this.notificationService.error('Please select a course first');
    }
  }

  selectCourseForNewClass() {
    this.notificationService.info('Please select a course from the dropdown or navigate to a course to create a class');
  }

  formatDaysOfWeek(days: string): string {
    if (!days) return '';
    const dayList = days.split(',').map(d => d.trim());
    const shortDays = dayList.map(d => {
      switch(d) {
        case 'SUNDAY': return 'Sun';
        case 'MONDAY': return 'Mon';
        case 'TUESDAY': return 'Tue';
        case 'WEDNESDAY': return 'Wed';
        case 'THURSDAY': return 'Thu';
        case 'FRIDAY': return 'Fri';
        case 'SATURDAY': return 'Sat';
        default: return d;
      }
    });
    return shortDays.join(', ');
  }

  formatDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
