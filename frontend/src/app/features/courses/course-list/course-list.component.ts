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
  templateUrl: './course-list.component.html'
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

  private translate = inject(TranslateService);

  statusOptions = computed(() => [
    { label: this.translate.instant('COURSES.LIST.ACTIVE'), value: true },
    { label: this.translate.instant('COURSES.LIST.INACTIVE'), value: false },
  ]);

  branchOptions = computed(() => [
    { label: this.translate.instant('COURSES.LIST.GLOBAL_NO_BRANCH'), value: '__global__' },
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
        this.notificationService.error(this.translate.instant('COURSES.LIST.LOAD_ERROR'));
        this.loading.set(false);
      }
    });
  }

  getBranchName(branchId: string | null): string {
    if (!branchId) return this.translate.instant('COURSES.LIST.GLOBAL');
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
