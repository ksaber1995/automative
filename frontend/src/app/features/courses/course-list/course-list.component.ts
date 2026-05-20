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
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { TabsModule, Tab, TabList, TabPanel, TabPanels } from 'primeng/tabs';
import { ConfirmationService } from 'primeng/api';
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
    ConfirmDialogModule,
    DialogModule,
    TabsModule,
    Tab,
    TabList,
    TabPanel,
    TabPanels,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './course-list.component.html'
})
export class CourseListComponent implements OnInit {
  private courseService = inject(CourseService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  authService = inject(AuthService);

  courses = signal<CourseWithEnrollmentCount[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);

  selectedBranchId = signal<string | null>(null);
  selectedTab = signal<'active' | 'inactive'>('active');

  // Blocker dialog shown when the API returns a 409 with the list of classes
  // that prevent course deactivation.
  showBlockerDialog = signal(false);
  blockerCourseName = signal('');
  blockerHasInProgress = signal(false);
  blockerClasses = signal<{ id: string; name: string; code: string }[]>([]);

  private translate = inject(TranslateService);

  branchOptions = computed(() => [
    { label: this.translate.instant('COURSES.LIST.GLOBAL_NO_BRANCH'), value: '__global__' },
    ...this.branches().map(b => ({ label: b.name, value: b.id })),
  ]);

  activeCount = computed(() => this.byBranch().filter(c => c.isActive).length);
  inactiveCount = computed(() => this.byBranch().filter(c => !c.isActive).length);

  private byBranch = computed(() => {
    const branch = this.selectedBranchId();
    return this.courses().filter(c => {
      if (branch === null) return true;
      if (branch === '__global__') return c.branchId === null;
      return c.branchId === branch;
    });
  });

  filteredCourses = computed(() => {
    const wantActive = this.selectedTab() === 'active';
    return this.byBranch().filter(c => c.isActive === wantActive);
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

  // Hard-delete: only allowed when no one has ever enrolled (direct or via bundle).
  // Backend re-checks; UI guard just hides the button when it would 409.
  canDelete(course: CourseWithEnrollmentCount): boolean {
    return (course.enrollmentCount || 0) === 0;
  }

  deleteCourse(course: CourseWithEnrollmentCount) {
    this.confirmationService.confirm({
      header: this.translate.instant('COURSES.LIST.DELETE_TITLE'),
      message: this.translate.instant('COURSES.LIST.DELETE_MSG', { name: course.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.courseService.deleteCourse(course.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('COURSES.DELETED'));
            this.loadCourses();
          },
        });
      },
    });
  }

  deactivateCourse(course: CourseWithEnrollmentCount) {
    this.confirmationService.confirm({
      header: this.translate.instant('COURSES.LIST.DEACTIVATE_TITLE'),
      message: this.translate.instant('COURSES.LIST.DEACTIVATE_MSG', { name: course.name }),
      icon: 'pi pi-ban',
      accept: () => {
        this.courseService.deactivateCourse(course.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('COURSES.LIST.DEACTIVATED'));
            this.loadCourses();
          },
          error: (err) => {
            const body = err?.error;
            if (err?.status === 409 && Array.isArray(body?.classes)) {
              this.blockerCourseName.set(course.name);
              this.blockerClasses.set(body.classes);
              this.blockerHasInProgress.set(body.code === 'ERRORS.COURSES.HAS_IN_PROGRESS_CLASSES');
              this.showBlockerDialog.set(true);
            }
          },
        });
      },
    });
  }

  openBlockingClass(c: { id: string }) {
    this.showBlockerDialog.set(false);
    this.router.navigate(['/classes', c.id]);
  }

  activateCourse(course: CourseWithEnrollmentCount) {
    this.courseService.activateCourse(course.id).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('COURSES.LIST.ACTIVATED'));
        this.loadCourses();
      },
    });
  }
}
