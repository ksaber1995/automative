import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { CourseService } from '../services/course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Course } from '@shared/interfaces/course.interface';

@Component({
  selector: 'app-course-list',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    ConfirmDialogModule,
    TooltipModule
  ],
  providers: [ConfirmationService],
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
              <th pSortableColumn="level">Level <p-sortIcon field="level"></p-sortIcon></th>
              <th pSortableColumn="duration">Duration</th>
              <th pSortableColumn="price">Price <p-sortIcon field="price"></p-sortIcon></th>
              <th>Max Students</th>
              <th pSortableColumn="isActive">Status <p-sortIcon field="isActive"></p-sortIcon></th>
              <th>Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-course>
            <tr>
              <td>{{ course.code }}</td>
              <td>{{ course.name }}</td>
              <td><p-tag [value]="course.level" severity="info"></p-tag></td>
              <td>{{ course.duration }}</td>
              <td>\${{ course.price.toFixed(2) }}</td>
              <td>{{ course.maxStudents || 'N/A' }}</td>
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
                      (onClick)="deleteCourse(course)"
                      pTooltip="Deactivate"
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
      <p-confirmDialog></p-confirmDialog>
    </div>
  `
})
export class CourseListComponent implements OnInit {
  private courseService = inject(CourseService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  courses = signal<Course[]>([]);
  loading = signal(true);

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

  viewCourse(course: Course) {
    this.router.navigate(['/courses', course.id]);
  }

  editCourse(course: Course) {
    this.router.navigate(['/courses', course.id, 'edit']);
  }

  deleteCourse(course: Course) {
    this.confirmationService.confirm({
      message: `Are you sure you want to deactivate ${course.name}?`,
      header: 'Confirm Deactivation',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.courseService.deleteCourse(course.id).subscribe({
          next: () => {
            this.notificationService.success('Course deactivated successfully');
            this.loadCourses();
          }
        });
      }
    });
  }

  createCourse() {
    this.router.navigate(['/courses/create']);
  }
}
