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
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { CourseWithEnrollmentCount } from '@shared/interfaces/course.interface';

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
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  courses = signal<CourseWithEnrollmentCount[]>([]);
  branches = signal<LookupOption[]>([]);
  levels = signal<LookupOption[]>([]);
  loading = signal(true);

  selectedBranchId = signal<string | null>(null);
  selectedLevelId = signal<string | null>(null);
  selectedPaymentType = signal<'ALL' | 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION' | 'PER_SESSION'>('ALL');
  /** null = any teacher; '__none__' = courses with nobody assigned. */
  selectedInstructorId = signal<string | null>(null);
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
    ...this.branches().map(b => ({ label: b.label, value: b.id })),
  ]);

  levelOptions = computed(() => this.levels().map(l => ({ label: l.label, value: l.id })));

  /**
   * Teacher column + filter are ACADEMY-only. A teacher tenant IS the one
   * teacher, so a "who teaches this" column there would repeat the same name on
   * every row.
   */
  showTeacher = computed(() => !this.authService.isTeacher());

  /**
   * Built from the courses on screen rather than the employee lookup, so the
   * dropdown only offers teachers who actually have a course — picking a name
   * can never yield an empty list.
   */
  teacherOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const c of this.courses()) {
      if (c.instructorId && c.instructorName) seen.set(c.instructorId, c.instructorName);
    }
    const named = [...seen.entries()]
      .map(([value, label]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Offer "unassigned" only when there is one — finding the courses with no
    // teacher is the main reason to open this filter.
    const anyUnassigned = this.courses().some(c => !c.instructorId);
    return anyUnassigned
      ? [{ label: this.translate.instant('COURSES.LIST.NO_TEACHER'), value: '__none__' }, ...named]
      : named;
  });

  paymentTypeOptions = computed(() => [
    { label: this.translate.instant('COURSES.LIST.TYPE_ONE_TIME'), value: 'ONE_TIME' },
    { label: this.translate.instant('COURSES.LIST.TYPE_MONTHLY'), value: 'MONTHLY_SUBSCRIPTION' },
    { label: this.translate.instant('COURSES.LIST.TYPE_PER_SESSION'), value: 'PER_SESSION' },
  ]);

  activeCount = computed(() => this.byBranch().filter(c => c.isActive).length);
  inactiveCount = computed(() => this.byBranch().filter(c => !c.isActive).length);

  private byBranch = computed(() => {
    const branch = this.selectedBranchId();
    const level = this.selectedLevelId();
    const paymentType = this.selectedPaymentType();
    const instructor = this.selectedInstructorId();
    return this.courses().filter(c => {
      const branchMatch =
        branch === null ? true :
        branch === '__global__' ? c.branchId === null :
        c.branchId === branch;
      const levelMatch = level === null ? true
        : (c.levels?.length ? c.levels.some(l => l.id === level) : c.levelId === level);
      const paymentTypeMatch =
        paymentType === 'ALL' ? true : (c.paymentType ?? 'ONE_TIME') === paymentType;
      // '__none__' finds the courses nobody is assigned to — the reason to look
      // at this filter in the first place.
      const instructorMatch =
        instructor === null ? true :
        instructor === '__none__' ? !c.instructorId :
        c.instructorId === instructor;
      return branchMatch && levelMatch && paymentTypeMatch && instructorMatch;
    });
  });

  filteredCourses = computed(() => {
    const wantActive = this.selectedTab() === 'active';
    return this.byBranch().filter(c => c.isActive === wantActive);
  });

  ngOnInit() {
    this.loadCourses();
    this.lookupService.branches().subscribe({
      next: (branches) => this.branches.set(branches),
    });
    // Levels are academy-only — a teacher has no level filter to populate.
    if (!this.authService.isTeacher()) {
      this.lookupService.levels().subscribe({
        next: (levels) => this.levels.set(levels),
      });
    }
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

  // Comma-separated level names for the list, falling back to the legacy single name.
  levelNames(course: CourseWithEnrollmentCount): string {
    if (course.levels?.length) return course.levels.map(l => l.name).filter(Boolean).join(', ');
    return course.levelName || '—';
  }

  /**
   * The branch to show for a course.
   *
   * Prefers the name the API now sends with the row. The lookup is only a
   * fallback: it's filtered by is_active and by the caller's branch scope, so a
   * course on any branch outside that set found nothing — and the old `?? branchId`
   * then printed a raw UUID into the table.
   */
  getBranchName(course: { branchId: string | null; branchName?: string | null }): string {
    if (course.branchName) return course.branchName;
    if (!course.branchId) return this.translate.instant('COURSES.LIST.GLOBAL');
    const found = this.branches().find(b => b.id === course.branchId)?.label;
    // Never fall back to the id — a UUID in a Branch column is worse than a dash.
    return found ?? '—';
  }

  clearFilters() {
    this.selectedBranchId.set(null);
    this.selectedLevelId.set(null);
    this.selectedPaymentType.set('ALL');
    this.selectedInstructorId.set(null);
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
