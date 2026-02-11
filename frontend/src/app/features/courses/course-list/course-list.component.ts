import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { CourseService } from '../services/course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Course, CourseWithEnrollmentCount } from '@shared/interfaces/course.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-course-list',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    DeleteConfirmDialogComponent
  ],
  template: `
    <div class="container-custom py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-900">Courses</h1>
        <p-button label="Add Course" icon="pi pi-plus" (onClick)="createCourse()"></p-button>
      </div>

      <p-card>
        <p-table
          [value]="courses()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Showing {first} to {last} of {totalRecords} courses"
          responsiveLayout="scroll"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="code">Code <p-sortIcon field="code"></p-sortIcon></th>
              <th pSortableColumn="name">Name <p-sortIcon field="name"></p-sortIcon></th>
              <th pSortableColumn="duration">Duration (weeks)</th>
              <th pSortableColumn="price">Price <p-sortIcon field="price"></p-sortIcon></th>
              <th>Max Students</th>
              <th>Enrollments</th>
              <th pSortableColumn="isActive">Status <p-sortIcon field="isActive"></p-sortIcon></th>
              <th>Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-course>
            <tr>
              <td>{{ course.code }}</td>
              <td>{{ course.name }}</td>
              <td>{{ course.duration }} weeks</td>
              <td>\${{ course.price.toFixed(2) }}</td>
              <td>{{ course.maxStudents || 'Unlimited' }}</td>
              <td>
                <p-tag [value]="course.enrollmentCount || 0" severity="info"></p-tag>
              </td>
              <td>
                <p-tag
                  [value]="course.isActive ? 'Active' : 'Inactive'"
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
                    pTooltip="View"
                  ></p-button>
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    severity="warn"
                    (onClick)="editCourse(course)"
                    pTooltip="Edit"
                  ></p-button>
                  @if (course.isActive) {
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="confirmDelete(course)"
                      pTooltip="Delete"
                    ></p-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8" class="text-center py-8">
                <div class="text-gray-500">
                  <i class="pi pi-inbox text-4xl mb-3"></i>
                  <p>No courses found</p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <app-delete-confirm-dialog
        [(visible)]="showDeleteDialog"
        [header]="'Delete Course'"
        [message]="'Are you sure you want to delete ' + courseToDelete()?.name + '? This will permanently remove the course and all associated data.'"
        (confirm)="deleteCourse()"
      ></app-delete-confirm-dialog>
    </div>
  `
})
export class CourseListComponent implements OnInit {
  private courseService = inject(CourseService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);

  courses = signal<CourseWithEnrollmentCount[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  courseToDelete = signal<CourseWithEnrollmentCount | null>(null);

  ngOnInit() {
    this.loadCourses();
  }

  loadCourses() {
    this.loading.set(true);
    this.courseService.getAllCourses().subscribe({
      next: (courses) => {
        this.courses.set(courses);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  viewCourse(course: CourseWithEnrollmentCount) {
    this.router.navigate(['/courses', course.id]);
  }

  editCourse(course: CourseWithEnrollmentCount) {
    this.router.navigate(['/courses', course.id, 'edit']);
  }

  confirmDelete(course: CourseWithEnrollmentCount) {
    this.courseToDelete.set(course);
    this.showDeleteDialog = true;
  }

  deleteCourse() {
    const course = this.courseToDelete();
    if (!course) return;

    this.courseService.deleteCourse(course.id).subscribe({
      next: () => {
        this.notificationService.success('Course deleted successfully');
        this.loadCourses();
        this.showDeleteDialog = false;
        this.courseToDelete.set(null);
      },
      error: () => {
        this.notificationService.error('Failed to delete course');
        this.showDeleteDialog = false;
      }
    });
  }

  createCourse() {
    this.router.navigate(['/courses/create']);
  }
}
