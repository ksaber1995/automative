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
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { CourseService } from '../services/course.service';
import { BranchService } from '../../branches/services/branch.service';
import { LevelService } from '../../levels/services/level.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { CourseWithEnrollmentCount } from '@shared/interfaces/course.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { Level } from '@shared/interfaces/level.interface';

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
    AmountPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './course-list.component.html'
})
export class CourseListComponent implements OnInit {
  private courseService = inject(CourseService);
  private branchService = inject(BranchService);
  private levelService = inject(LevelService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  courses = signal<CourseWithEnrollmentCount[]>([]);
  branches = signal<Branch[]>([]);
  levels = signal<Level[]>([]);
  loading = signal(true);

  selectedBranchId = signal<string | null>(null);
  selectedLevelId = signal<string | null>(null);
  selectedPaymentType = signal<'ALL' | 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION'>('ALL');
  selectedTab = signal<'active' | 'inactive'>('active');

  // Blocker dialog shown when the API returns a 409 with the list of classes
  // that prevent course deactivation.
  showBlockerDialog = signal(false);
  blockerCourseName = signal('');
  blockerHasInProgress = signal(false);
  blockerClasses = signal<{ id: string; name: string }[]>([]);

  private translate = inject(TranslateService);

  branchOptions = computed(() => [
    { label: this.translate.instant('COURSES.LIST.GLOBAL_NO_BRANCH'), value: '__global__' },
    ...this.branches().map(b => ({ label: b.name, value: b.id })),
  ]);

  levelOptions = computed(() => this.levels().map(l => ({ label: l.name, value: l.id })));

  paymentTypeOptions = computed(() => [
    { label: this.translate.instant('COURSES.LIST.TYPE_ONE_TIME'), value: 'ONE_TIME' },
    { label: this.translate.instant('COURSES.LIST.TYPE_MONTHLY'), value: 'MONTHLY_SUBSCRIPTION' },
  ]);

  activeCount = computed(() => this.byBranch().filter(c => c.isActive).length);
  inactiveCount = computed(() => this.byBranch().filter(c => !c.isActive).length);

  private byBranch = computed(() => {
    const branch = this.selectedBranchId();
    const level = this.selectedLevelId();
    const paymentType = this.selectedPaymentType();
    return this.courses().filter(c => {
      const branchMatch =
        branch === null ? true :
        branch === '__global__' ? c.branchId === null :
        c.branchId === branch;
      const levelMatch = level === null ? true : c.levelId === level;
      const paymentTypeMatch =
        paymentType === 'ALL' ? true : (c.paymentType ?? 'ONE_TIME') === paymentType;
      return branchMatch && levelMatch && paymentTypeMatch;
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
    this.levelService.getAllLevels().subscribe({
      next: (levels) => this.levels.set(levels),
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
    this.selectedLevelId.set(null);
    this.selectedPaymentType.set('ALL');
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
