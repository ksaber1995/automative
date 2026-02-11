import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AccordionModule } from 'primeng/accordion';
import { PanelModule } from 'primeng/panel';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { CourseService } from '../services/course.service';
import { ClassService } from '../services/class.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Course } from '@shared/interfaces/course.interface';
import { ClassWithDetails } from '@shared/interfaces/class.interface';

@Component({
  selector: 'app-course-detail',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    AccordionModule,
    PanelModule,
    ConfirmDialogModule,
    TooltipModule
  ],
  providers: [ConfirmationService],
  templateUrl: './course-detail.component.html',
  styleUrl: './course-detail.component.scss'
})
export class CourseDetailComponent implements OnInit {
  private courseService = inject(CourseService);
  private classService = inject(ClassService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  course = signal<Course | null>(null);
  classes = signal<ClassWithDetails[]>([]);
  loading = signal(true);
  courseId: string | null = null;

  ngOnInit() {
    this.courseId = this.route.snapshot.paramMap.get('id');
    if (this.courseId) {
      this.loadCourse(this.courseId);
      this.loadClasses(this.courseId);
    }
  }

  loadCourse(id: string) {
    this.loading.set(true);
    this.courseService.getCourseById(id).subscribe({
      next: (course) => {
        this.course.set(course);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load course');
        this.loading.set(false);
        this.router.navigate(['/courses']);
      }
    });
  }

  loadClasses(courseId: string) {
    this.classService.getClassesByCourse(courseId).subscribe({
      next: async (classes) => {
        // Load details for each class
        const classesWithDetails = await Promise.all(
          classes.map(cls =>
            this.classService.getClassWithDetails(cls.id).toPromise()
          )
        );
        this.classes.set(classesWithDetails.filter(c => c !== undefined) as ClassWithDetails[]);
      },
      error: () => {
        this.notificationService.error('Failed to load classes');
      }
    });
  }

  editCourse() {
    this.router.navigate(['/courses', this.courseId, 'edit']);
  }

  backToList() {
    this.router.navigate(['/courses']);
  }

  createClass() {
    this.router.navigate(['/courses', this.courseId, 'classes', 'create']);
  }

  editClass(classId: string) {
    this.router.navigate(['/courses', this.courseId, 'classes', classId, 'edit']);
  }

  deleteClass(classId: string) {
    this.confirmationService.confirm({
      message: 'Are you sure you want to deactivate this class?',
      header: 'Confirm Deactivation',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.classService.deleteClass(classId).subscribe({
          next: () => {
            this.notificationService.success('Class deactivated successfully');
            if (this.courseId) {
              this.loadClasses(this.courseId);
            }
          },
          error: () => {
            this.notificationService.error('Failed to deactivate class');
          }
        });
      }
    });
  }

  getPaymentStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' {
    switch (status) {
      case 'PAID': return 'success';
      case 'PARTIAL': return 'info';
      case 'PENDING': return 'warn';
      case 'OVERDUE': return 'danger';
      default: return 'info';
    }
  }

  getEnrollmentStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' {
    switch (status) {
      case 'ACTIVE': return 'success';
      case 'COMPLETED': return 'info';
      case 'DROPPED': return 'danger';
      case 'PENDING': return 'warn';
      default: return 'info';
    }
  }

  formatSchedule(schedule: any): string {
    if (!schedule) return 'N/A';
    const days = schedule.days.join(', ');
    return `${days} ${schedule.startTime} - ${schedule.endTime}`;
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
}
