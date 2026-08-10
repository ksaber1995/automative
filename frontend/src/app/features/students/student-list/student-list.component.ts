import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { formatStudentCode, normalizeStudentCode } from '../../../core/utils/student-code.util';
import { matchesSearchTokens } from '../../../core/utils/search.util';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { RadioButtonModule } from 'primeng/radiobutton';
import { CheckboxModule } from 'primeng/checkbox';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { TabsModule } from 'primeng/tabs';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { StudentService } from '../services/student.service';
import { StudentCardData, currentAcademicYear, loadCardImages, renderStudentCardPng } from '../card-render.util';
import { CardTemplate } from '../card-theme';
import { CompanyService } from '../../../core/services/company.service';
import { StudentImportDialogComponent } from '../student-import/student-import-dialog.component';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { ClassService } from '../../courses/services/class.service';
import { CourseService } from '../../courses/services/course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { shouldShowStudentCode } from '../../../core/utils/student-code.util';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { Student, AcquisitionChannel } from '@shared/interfaces/student.interface';
import { Class } from '@shared/interfaces/class.interface';
import {
  ScheduleLabels, StudentExportColumn, StudentExportRow,
  downloadStudentsPdf, exportStudentsToExcel, formatClassSchedule, studentExportColumns,
} from '../student-export.util';

interface EnrollmentCounts {
  active: number;
  completed: number;
}

@Component({
  selector: 'app-student-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    ConfirmDialogModule,
    TooltipModule,
    TabsModule,
    TranslateModule,
    DialogModule,
    InputTextModule,
    MultiSelectModule,
    RadioButtonModule,
    CheckboxModule,
    ProgressBarModule,
    StudentImportDialogComponent
  ],
  providers: [ConfirmationService],
  templateUrl: './student-list.component.html',
  styleUrl: './student-list.component.scss'
})
export class StudentListComponent implements OnInit {
  /** A card-derived code reads "A5", not 100005. */
  code = formatStudentCode;

  private studentService = inject(StudentService);
  private lookupService = inject(LookupService);
  private enrollmentService = inject(EnrollmentService);
  private classService = inject(ClassService);
  private courseService = inject(CourseService);
  private companyService = inject(CompanyService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  /** Show the student code only once the QR is active (see student-code.util). */
  showCode = (s: Student) => shouldShowStudentCode(s);

  students = signal<Student[]>([]);
  allBranches = signal<LookupOption[]>([]);
  allCourses = signal<LookupOption[]>([]);
  loading = signal(true);
  selectedBranchId: string = '';
  /** Signal mirror of selectedBranchId so computeds can react to it. */
  branchFilter = signal('');
  selectedCourseId = signal('');
  selectedClassId = signal('');
  searchTerm = signal('');
  enrollmentCounts = signal<Record<string, EnrollmentCounts>>({});
  // studentId → set of courseIds the student is enrolled in (drives the course filter).
  studentCourseMap = signal<Map<string, Set<string>>>(new Map());
  // studentId → set of classIds, from the same enrollments (drives the class filter).
  studentClassMap = signal<Map<string, Set<string>>>(new Map());
  // Every class, kept whole so the dropdown can narrow itself by branch/course.
  allClasses = signal<Class[]>([]);
  /** Non-dropped enrolments, so the export can name each student's classes. */
  enrollments = signal<{ studentId: string; classId: string; courseId?: string }[]>([]);
  exporting = signal(false);
  exportingPdf = signal(false);
  activeTab = signal<'active' | 'inactive'>('active');

  // Type-to-confirm permanent-delete dialog state.
  deleteDialogVisible = false;
  studentToDelete: Student | null = null;
  deleteConfirmText = '';

  // The lookup returns active branches only, so all entries are selectable/active.
  branches = computed(() => this.allBranches());

  branchNameById = computed(() => {
    const map = new Map<string, string>();
    for (const b of this.allBranches()) map.set(b.id, b.label);
    return map;
  });

  // A branch present in the active-only lookup is active; anything else (a student
  // on a since-deactivated branch) resolves to inactive.
  branchActiveById = computed(() => {
    const map = new Map<string, boolean>();
    for (const b of this.allBranches()) map.set(b.id, true);
    return map;
  });

  /**
   * The classes worth offering: those of the chosen course, or of the chosen
   * branch when no course is picked. Class names repeat across courses ("Group
   * A" is in half of them), so an unnarrowed list is a wall of ambiguous names.
   */
  classOptions = computed(() => {
    const courseId = this.selectedCourseId();
    // Mirrors selectedBranchId, which is a plain ngModel field — a computed()
    // can't track it, so the branch change has to arrive as a signal.
    const branchId = this.branchFilter();
    return this.allClasses()
      .filter(c => (!courseId || c.courseId === courseId)
                && (!branchId || !c.branchId || c.branchId === branchId))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  filteredStudents = computed(() => {
    const list = this.students();
    let filtered = this.activeTab() === 'active'
      ? list.filter(s => s.isActive)
      : list.filter(s => !s.isActive);
    const courseId = this.selectedCourseId();
    if (courseId) {
      const map = this.studentCourseMap();
      filtered = filtered.filter(s => map.get(s.id)?.has(courseId));
    }
    const classId = this.selectedClassId();
    if (classId) {
      const map = this.studentClassMap();
      filtered = filtered.filter(s => map.get(s.id)?.has(classId));
    }
    const term = this.searchTerm();
    if (!term.trim()) return filtered;
    // Every word of the term must appear somewhere across these fields, in any
    // order — a name is searched by the parts people remember. Matching the term
    // as one contiguous run of "first last" used to miss anyone with a middle
    // name, which is most of the roster.
    return filtered.filter(s => matchesSearchTokens(term, [
      s.name,
      s.parentName,
      // Student code and phone numbers (student / parent) stay searchable.
      formatStudentCode(s.studentCode),
      s.studentCode,
      s.phone,
      s.parentPhone,
      // School is only reachable from here — it has no filter of its own,
      // because the same school gets typed a dozen different ways.
      s.schoolName,
    ]));
  });

  activeCount = computed(() => this.students().filter(s => s.isActive).length);
  inactiveCount = computed(() => this.students().filter(s => !s.isActive).length);

  onSearchChange(value: string) {
    this.searchTerm.set(value);
  }

  ngOnInit() {
    this.loadBranches();
    this.loadCourses();
    this.loadStudents();
    this.loadEnrollmentCounts();
  }

  loadCourses() {
    // Permission-free courses lookup (lookups.courses is auth-only, no granular
    // permission) so the filter works even for users without course-read access.
    //
    // Scoped to the selected branch: the list only holds that branch's students,
    // so a course belonging to another branch can never match one of them —
    // offering it is offering a filter that always comes back empty.
    this.lookupService.courses(this.selectedBranchId || undefined).subscribe({
      next: (courses) => {
        this.allCourses.set(courses);
        // The course already picked may not run in the newly-chosen branch. Clear
        // it rather than leave a filter applied that its own dropdown no longer
        // offers — the list would look empty for no visible reason.
        const picked = this.selectedCourseId();
        if (picked && !courses.some(c => c.id === picked)) {
          this.selectedCourseId.set('');
        }
        // The course may have just widened or cleared, moving the class list with it.
        this.dropClassIfUnoffered();
      },
    });
  }

  loadEnrollmentCounts() {
    let enrollments: { studentId: string; classId: string; courseId?: string }[] = [];
    let classes: Class[] = [];
    let pending = 2;
    const finalize = () => {
      pending--;
      if (pending !== 0) return;
      const classDoneById = new Map(
        classes.map(c => [c.id, c.status === 'DONE' || c.isFinished === true])
      );
      const classCourseById = new Map(classes.map(c => [c.id, c.courseId]));
      const map: Record<string, EnrollmentCounts> = {};
      const courseMap = new Map<string, Set<string>>();
      const classMap = new Map<string, Set<string>>();
      for (const e of enrollments) {
        if (!map[e.studentId]) map[e.studentId] = { active: 0, completed: 0 };
        if (classDoneById.get(e.classId)) map[e.studentId].completed++;
        else map[e.studentId].active++;
        // Build the student → courses set for the course filter (courseId comes
        // from the enrollment, falling back to the enrollment's class).
        const courseId = e.courseId || classCourseById.get(e.classId);
        if (courseId) {
          if (!courseMap.has(e.studentId)) courseMap.set(e.studentId, new Set());
          courseMap.get(e.studentId)!.add(courseId);
        }
        // Same enrollments drive the class filter — no extra request.
        if (e.classId) {
          if (!classMap.has(e.studentId)) classMap.set(e.studentId, new Set());
          classMap.get(e.studentId)!.add(e.classId);
        }
      }
      this.enrollmentCounts.set(map);
      this.studentCourseMap.set(courseMap);
      this.studentClassMap.set(classMap);
      // Kept whole for the export, which needs the class behind each enrolment,
      // not just how many there were. DROPPED is left out: that student is no
      // longer in the class, so listing them against its time would be wrong.
      this.enrollments.set(enrollments.filter((e: any) => e.status !== 'DROPPED'));
    };
    this.enrollmentService.getAllEnrollments().subscribe({
      next: (list) => { enrollments = list; finalize(); },
      error: () => finalize(),
    });
    this.classService.getAllClasses().subscribe({
      next: (list) => { classes = list; this.allClasses.set(list); finalize(); },
      error: () => finalize(),
    });
  }

  getCounts(studentId: string): EnrollmentCounts {
    return this.enrollmentCounts()[studentId] || { active: 0, completed: 0 };
  }

  // --- Export the list ------------------------------------------------------
  // Exports exactly what the filters are showing, not the whole database: the
  // tab, branch, course, class and search box have already been used to answer
  // a question, and the export is that answer.

  /**
   * One row per student-and-class. A student in two classes has two class times,
   * and folding them into a single cell would defeat sorting or filtering by
   * class in Excel. A student with no enrolment still gets a row.
   */
  /**
   * Branch is only worth a column when it can differ between rows: a solo teacher
   * has no branches to tell apart, and a single-branch academy would get the same
   * value repeated on every row.
   */
  private exportColumns(): StudentExportColumn[] {
    return studentExportColumns({
      includeBranch: !this.authService.isTeacher() && this.allBranches().length > 1,
    });
  }

  /** Day names and AM/PM follow the UI language, so an Arabic export reads Arabic. */
  private scheduleLabels(): ScheduleLabels {
    return {
      dayLabel: (day: string) => {
        if (!day) return '';
        const key = `CLASSES.LIST.DAY_${day.toUpperCase()}`;
        const label = this.translate.instant(key);
        // ngx-translate echoes the key back when it is missing — fall back to the
        // English short form rather than printing "CLASSES.LIST.DAY_MONDAY".
        return label && label !== key ? label : day.slice(0, 3).toUpperCase();
      },
      am: this.translate.instant('STUDENTS.EXPORT.AM'),
      pm: this.translate.instant('STUDENTS.EXPORT.PM'),
    };
  }

  private buildExportRows(): StudentExportRow[] {
    const classById = new Map(this.allClasses().map((c) => [c.id, c]));
    const courseNameById = new Map(this.allCourses().map((c) => [c.id, c.label]));
    const byStudent = new Map<string, { studentId: string; classId: string; courseId?: string }[]>();
    for (const e of this.enrollments()) {
      if (!byStudent.has(e.studentId)) byStudent.set(e.studentId, []);
      byStudent.get(e.studentId)!.push(e);
    }
    const dash = '';
    const labels = this.scheduleLabels();
    const rows: StudentExportRow[] = [];

    for (const s of this.filteredStudents()) {
      const base = {
        // The same "A5" the list shows, not the raw 100005 — and blank until the
        // QR is active, matching the column on screen.
        code: this.showCode(s) ? formatStudentCode(s.studentCode) : dash,
        name: s.name || dash,
        phone: s.phone || dash,
        parentName: s.parentName || dash,
        parentPhone: s.parentPhone || dash,
        school: s.schoolName || dash,
        branch: this.getBranchName(s.branchId) || dash,
        status: this.translate.instant(s.isActive ? 'STUDENTS.EXPORT.ACTIVE' : 'STUDENTS.EXPORT.INACTIVE'),
      };

      // Only the classes still offered by the current filters — exporting a
      // class the user filtered out would contradict what they asked for.
      const classId = this.selectedClassId();
      const courseId = this.selectedCourseId();
      const enrolments = (byStudent.get(s.id) || []).filter((e) => {
        if (classId && e.classId !== classId) return false;
        if (courseId && (e.courseId || classById.get(e.classId)?.courseId) !== courseId) return false;
        return true;
      });

      if (!enrolments.length) {
        rows.push({ ...base, course: dash, class: dash, schedule: dash });
        continue;
      }
      for (const e of enrolments) {
        const cls = classById.get(e.classId);
        const cid = e.courseId || cls?.courseId;
        rows.push({
          ...base,
          course: (cid && courseNameById.get(cid)) || dash,
          class: cls?.name || dash,
          schedule: formatClassSchedule(cls, labels, dash),
        });
      }
    }
    return rows;
  }

  private exportHeaders(columns: StudentExportColumn[]): string[] {
    return columns.map((c) => this.translate.instant(c.labelKey));
  }

  /** What the filters narrowed to, printed under the title so a saved file says what it is. */
  private exportSubtitle(rows: number): string {
    const parts = [this.translate.instant(
      this.activeTab() === 'active' ? 'STUDENTS.EXPORT.ACTIVE' : 'STUDENTS.EXPORT.INACTIVE'
    )];
    const branch = this.getBranchName(this.selectedBranchId);
    if (branch) parts.push(branch);
    const course = this.allCourses().find((c) => c.id === this.selectedCourseId())?.label;
    if (course) parts.push(course);
    const cls = this.allClasses().find((c) => c.id === this.selectedClassId())?.name;
    if (cls) parts.push(cls);
    if (this.searchTerm().trim()) parts.push(`"${this.searchTerm().trim()}"`);
    return this.translate.instant('STUDENTS.EXPORT.SUBTITLE', {
      filters: parts.join(' · '),
      rows,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    });
  }

  private exportFileStem(): string {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `students-${stamp}`;
  }

  exportExcel(): void {
    const rows = this.buildExportRows();
    if (!rows.length) {
      this.notificationService.error(this.translate.instant('STUDENTS.EXPORT.EMPTY'));
      return;
    }
    this.exporting.set(true);
    try {
      const columns = this.exportColumns();
      exportStudentsToExcel(
        rows,
        columns,
        this.exportHeaders(columns),
        `${this.exportFileStem()}.xlsx`,
        this.translate.instant('STUDENTS.LIST.TITLE'),
        (this.translate.currentLang || 'en').startsWith('ar'),
      );
      this.notificationService.success(this.translate.instant('STUDENTS.EXPORT.DONE', { count: rows.length }));
    } catch {
      this.notificationService.error(this.translate.instant('STUDENTS.EXPORT.FAILED'));
    } finally {
      this.exporting.set(false);
    }
  }

  async exportPdf(): Promise<void> {
    const rows = this.buildExportRows();
    if (!rows.length) {
      this.notificationService.error(this.translate.instant('STUDENTS.EXPORT.EMPTY'));
      return;
    }
    // Rendering is a page-at-a-time canvas capture, so a long roster takes a few
    // seconds — the button has to show it is working.
    this.exportingPdf.set(true);
    try {
      const columns = this.exportColumns();
      await downloadStudentsPdf({
        rows,
        columns,
        headers: this.exportHeaders(columns),
        title: this.translate.instant('STUDENTS.LIST.TITLE'),
        subtitle: this.exportSubtitle(rows.length),
        filename: `${this.exportFileStem()}.pdf`,
        rtl: (this.translate.currentLang || 'en').startsWith('ar'),
      });
      this.notificationService.success(this.translate.instant('STUDENTS.EXPORT.DONE', { count: rows.length }));
    } catch {
      this.notificationService.error(this.translate.instant('STUDENTS.EXPORT.FAILED'));
    } finally {
      this.exportingPdf.set(false);
    }
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
      next: (branches) => {
        this.allBranches.set(branches);
      }
    });
  }

  getBranchName(branchId: string | undefined | null): string {
    if (!branchId) return '';
    return this.branchNameById().get(branchId) || '';
  }

  isBranchActive(branchId: string | undefined | null): boolean {
    if (!branchId) return false;
    return this.branchActiveById().get(branchId) === true;
  }

  hasNoEnrollments(studentId: string): boolean {
    const counts = this.getCounts(studentId);
    return counts.active === 0 && counts.completed === 0;
  }

  loadStudents() {
    this.loading.set(true);
    if (this.selectedBranchId) {
      this.studentService.getStudentsByBranch(this.selectedBranchId).subscribe({
        next: (students) => {
          this.students.set(students);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        }
      });
    } else {
      this.studentService.getAllStudents().subscribe({
        next: (students) => {
          this.students.set(students);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        }
      });
    }
  }

  onBranchFilterChange() {
    this.branchFilter.set(this.selectedBranchId);
    this.loadCourses();
    this.loadStudents();
    this.dropClassIfUnoffered();
  }

  onCourseFilterChange(courseId: string) {
    this.selectedCourseId.set(courseId);
    this.dropClassIfUnoffered();
  }

  /**
   * A class the dropdown no longer offers must not stay applied — the list would
   * look empty for no visible reason, the same trap loadCourses() avoids for the
   * course filter.
   */
  private dropClassIfUnoffered() {
    const picked = this.selectedClassId();
    if (picked && !this.classOptions().some(c => c.id === picked)) {
      this.selectedClassId.set('');
    }
  }

  onTabChange(tab: 'active' | 'inactive') {
    if (this.activeTab() === tab) return;
    this.activeTab.set(tab);
    if (this.selectedBranchId) {
      this.selectedBranchId = '';
      this.branchFilter.set('');
      // Back to every branch, so the course list widens again.
      this.loadCourses();
      this.loadStudents();
    }
  }

  viewStudent(student: Student) {
    this.router.navigate(['/students', student.id]);
  }

  editStudent(student: Student) {
    this.router.navigate(['/students', student.id, 'edit']);
  }

  /**
   * The student has left the academy. A soft deactivation, not a delete: the
   * record and all its history stay put, the student moves to the Inactive tab,
   * and the tick button there brings them back if they return. The endpoint is
   * the same soft DELETE the API has always exposed — only reachable from the UI
   * now, since the trash button next to it is the permanent one.
   */
  markStudentLeft(student: Student) {
    this.confirmationService.confirm({
      message: this.translate.instant('STUDENTS.LEAVE_CONFIRM', { name: student.name }),
      header: this.translate.instant('STUDENTS.LEAVE_HEADER'),
      icon: 'pi pi-sign-out',
      accept: () => {
        this.studentService.deleteStudent(student.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('STUDENTS.LEFT', { name: student.name }));
            this.loadStudents();
          }
        });
      }
    });
  }

  activateStudent(student: Student) {
    this.confirmationService.confirm({
      message: this.translate.instant('STUDENTS.ACTIVATE_CONFIRM', {
        name: student.name,
      }),
      header: this.translate.instant('STUDENTS.ACTIVATE_HEADER'),
      icon: 'pi pi-check-circle',
      accept: () => {
        this.studentService.reactivateStudent(student.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('STUDENTS.ACTIVATED'));
            this.loadStudents();
          }
        });
      }
    });
  }

  // Permanent delete is always allowed, but it is destructive — so instead of a
  // one-click confirm we make the user type "delete" into a dialog. The billing
  // warning is shown too when the student carries subscription/billing history.
  hardDeleteStudent(student: Student) {
    this.studentToDelete = student;
    this.deleteConfirmText = '';
    this.deleteDialogVisible = true;
  }

  /** The type-to-confirm gate: the delete button stays disabled until this is true. */
  get canConfirmDelete(): boolean {
    return this.deleteConfirmText.trim().toLowerCase() === 'delete';
  }

  confirmHardDelete() {
    const student = this.studentToDelete;
    if (!student || !this.canConfirmDelete) return;
    this.studentService.hardDeleteStudent(student.id).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('STUDENTS.HARD_DELETED'));
        this.deleteDialogVisible = false;
        this.studentToDelete = null;
        this.loadStudents();
      }
    });
  }

  createStudent() {
    this.router.navigate(['/students/create']);
  }

  importVisible = signal(false);

  openImport() {
    this.importVisible.set(true);
  }

  getChannelLabel(channel: AcquisitionChannel | null | undefined): string {
    if (!channel) return '';
    return this.translate.instant('STUDENTS.FORM.CHANNEL_' + channel);
  }

  getAge(dateOfBirth: string): number {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  // Age for the list. Date of birth is optional, and very young ages usually mean
  // a placeholder/typo'd date — so show nothing unless the age is a real 2+.
  ageDisplay(dateOfBirth: string | null | undefined): string {
    if (!dateOfBirth) return '—';
    const age = this.getAge(dateOfBirth);
    if (isNaN(age) || age < 2) return '—';
    return `${age} ${this.translate.instant('STUDENTS.LIST.YEARS')}`;
  }

  // --- Download student ID cards as a ZIP ---
  // One PNG ID card per student per class, filed under `Course/Class/`. A student
  // in two classes therefore gets two cards, since the card names the course,
  // class and level it was issued for.
  downloadingZip = signal(false);

  // --- Export scope dialog ---
  // The export can be a few thousand cards, so it asks what to print before doing
  // the work: everything, or only the courses / classes / teachers picked here.
  zipDialogOpen = signal(false);
  zipScope = signal<'all' | 'filter'>('all');
  zipCourseIds = signal<string[]>([]);
  zipClassIds = signal<string[]>([]);
  zipTeacherIds = signal<string[]>([]);
  zipClassOptions = signal<LookupOption[]>([]);
  zipTeacherOptions = signal<LookupOption[]>([]);
  loadingZipOptions = signal(false);

  /**
   * Put every card at the root of the ZIP instead of under `Course/Class/`. For a
   * print run the folder tree is just clicking to do — one folder means one
   * select-all-and-print.
   */
  zipFlat = signal(false);

  // Export progress. Rendering and compressing are separate phases — each reports
  // its own 0-100, so the bar never sits parked while work is still happening.
  zipPhase = signal<'render' | 'zip' | null>(null);
  zipPercent = signal(0);
  zipDone = signal(0);
  zipTotal = signal(0);

  /**
   * A TEACHER company IS the teacher — there are no colleagues to filter by, so the
   * picker would be a dropdown of one (or none). Academies get it.
   */
  showTeacherFilter = computed(() => !this.authService.isTeacher());

  /** Nothing ticked under "selected only" — there'd be no cards to render. */
  zipFilterEmpty = computed(() =>
    this.zipScope() === 'filter' &&
    !this.zipCourseIds().length && !this.zipClassIds().length && !this.zipTeacherIds().length);

  openZipDialog(): void {
    this.zipDialogOpen.set(true);
    if (this.zipClassOptions().length || this.loadingZipOptions()) return;

    // Teachers come off the classes themselves (a class names its instructor), so
    // the picker only offers teachers who actually have a class to print.
    this.loadingZipOptions.set(true);
    forkJoin({
      classes: this.classService.getAllClasses(),
      employees: this.lookupService.employees(),
    }).subscribe({
      next: ({ classes, employees }) => {
        this.zipClassOptions.set(classes.map((c) => ({ id: c.id, label: c.name })));
        const withClasses = new Set(classes.map((c) => c.instructorId).filter(Boolean) as string[]);
        this.zipTeacherOptions.set(employees.filter((e) => withClasses.has(e.id)));
        this.loadingZipOptions.set(false);
      },
      error: () => this.loadingZipOptions.set(false),
    });
  }

  /**
   * Students whose card can be downloaded — any active student with a token
   * (QR is active by default for all tenants).
   */
  private qrDownloadableStudents(): Student[] {
    return this.students().filter(s => s.isActive && s.qrToken);
  }

  async downloadQrZip() {
    // The dialog stays open so the progress bar has somewhere to live — a few
    // thousand cards is a long wait with no feedback otherwise.
    this.downloadingZip.set(true);
    this.zipPhase.set('render');
    this.zipDone.set(0);
    this.zipTotal.set(0);
    this.zipPercent.set(0);
    try {
      const activatedStudents = this.qrDownloadableStudents();
      if (activatedStudents.length === 0) {
        this.notificationService.warning(this.translate.instant('STUDENTS.LIST.QR_NO_ACTIVATED'));
        return;
      }

      const [enrollments, classes, courses] = await new Promise<[any[], Class[], any[]]>((resolve, reject) => {
        forkJoin({
          enrollments: this.enrollmentService.getAllEnrollments(),
          classes: this.classService.getAllClasses(),
          courses: this.courseService.getAllCourses(),
        }).subscribe({
          next: (res) => resolve([res.enrollments, res.classes, res.courses]),
          error: reject,
        });
      });

      // Which classes are in scope? A class is in if it was picked directly, or its
      // course was, or its teacher was — the three pickers widen the selection
      // rather than narrowing each other. null = no filtering at all.
      const scoped = this.zipScope() === 'filter';
      const pickedCourses = new Set(this.zipCourseIds());
      const pickedClasses = new Set(this.zipClassIds());
      const pickedTeachers = new Set(this.zipTeacherIds());
      const allowedClassIds: Set<string> | null = scoped
        ? new Set(classes
            .filter((c) => pickedClasses.has(c.id)
              || pickedCourses.has(c.courseId)
              || (c.instructorId != null && pickedTeachers.has(c.instructorId)))
            .map((c) => c.id))
        : null;

      const courseMap = new Map<string, { name: string; levelName: string }>(
        courses.map((c: any) => [c.id, { name: c.name, levelName: c.levelName || '' }])
      );
      const classMap = new Map(classes.map((c: Class) => [c.id, { name: c.name, courseId: c.courseId }]));
      const studentIdSet = new Set(activatedStudents.map(s => s.id));

      const studentEnrollments = new Map<string, string[]>();   // studentId -> classIds
      for (const e of enrollments) {
        if (!studentIdSet.has(e.studentId)) continue;
        if (allowedClassIds && !allowedClassIds.has(e.classId)) continue;
        if (!studentEnrollments.has(e.studentId)) studentEnrollments.set(e.studentId, []);
        studentEnrollments.get(e.studentId)!.push(e.classId);
      }

      // Under a filter, a student with no in-scope class has nothing to print —
      // including them would file an unlabelled card under Uncategorized, which is
      // exactly what the user asked NOT to get when they narrowed the export.
      const exportStudents = allowedClassIds
        ? activatedStudents.filter((s) => (studentEnrollments.get(s.id)?.length ?? 0) > 0)
        : activatedStudents;

      if (exportStudents.length === 0) {
        this.notificationService.warning(this.translate.instant('STUDENTS.LIST.QR_ZIP_NO_MATCH'));
        return;
      }

      // Load the card design first: it picks the template for the per-student
      // fronts as well as the shared back, so a printed pair always matches.
      const design = await firstValueFrom(this.companyService.getCardDesign()).catch(() => null);
      const template = design?.template as CardTemplate | undefined;
      // Decoded once for the whole batch — not once per student.
      const images = await loadCardImages(design);

      const zip = new JSZip();
      const flat = this.zipFlat();
      const usedNames = new Set<string>();   // flat mode only — keeps same-named cards apart
      const origin = window.location.origin;
      const companyName = this.authService.getCompanyName();
      const year = currentAcademicYear();
      const canvas = document.createElement('canvas');   // reused for every card
      await document.fonts.ready;                        // Arabic must shape before we rasterise
      let rendered = 0;
      this.zipTotal.set(exportStudents.length);

      for (const student of exportStudents) {
        const card: StudentCardData = {
          companyName,
          name: student.name,
          code: formatStudentCode(student.studentCode),
          level: '',
          school: student.schoolName || '',
          // The student's live class and course, which the list endpoint now
          // returns. These were hard-coded blank, so the two rows they feed
          // printed empty on every card the app has ever produced.
          group: student.className || '',
          year,
          subject: student.courseName || '',
          qrUrl: `${origin}/p/s/${student.qrToken}`,
        };
        const phone = student.phone ? ` (${student.phone})` : '';
        const baseName = this.sanitizeName(`${card.name}${phone}`);

        const classIds = studentEnrollments.get(student.id) || [];
        if (classIds.length === 0) {
          const png = await renderStudentCardPng(card, canvas, template, images, design);
          const path = flat ? this.uniqueFileName(usedNames, baseName) : `Uncategorized/${baseName}.png`;
          zip.file(path, png, { base64: true });
        } else {
          const addedFolders = new Set<string>();
          for (const classId of classIds) {
            const classInfo = classMap.get(classId);
            const course = classInfo ? courseMap.get(classInfo.courseId) : undefined;
            const courseName = this.sanitizeName(course?.name || 'Unknown Course');
            const className = this.sanitizeName(classInfo?.name || 'Unknown Class');
            const folder = `${courseName}/${className}`;
            if (addedFolders.has(folder)) continue;
            addedFolders.add(folder);

            const png = await renderStudentCardPng({
              ...card,
              level: course?.levelName || '',
              group: classInfo?.name || '',
              subject: course?.name || '',
            }, canvas, template, images, design);
            // Flat still means one card per class, so the class name goes into the
            // filename — with no folders it is the only thing left to tell the
            // student's two cards apart.
            const path = flat
              ? this.uniqueFileName(usedNames, classIds.length > 1 ? `${baseName} - ${className}` : baseName)
              : `${folder}/${baseName}.png`;
            zip.file(path, png, { base64: true });
          }
        }

        // Yield periodically so a large batch doesn't lock the main thread — and so
        // the progress bar actually repaints. Every 5 keeps the bar moving without
        // paying the ~4ms timer clamp on every single student.
        this.zipDone.set(++rendered);
        this.zipPercent.set(Math.round((rendered / exportStudents.length) * 100));
        if (rendered % 5 === 0) await new Promise((r) => setTimeout(r));
      }

      // Compressing a few thousand PNGs is itself a long step, so it gets its own
      // phase on the bar rather than leaving it parked at 100%.
      this.zipPhase.set('zip');
      this.zipPercent.set(0);
      const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        this.zipPercent.set(Math.round(meta.percent));
      });
      saveAs(blob, 'student-cards.zip');
      this.notificationService.success(this.translate.instant('STUDENTS.LIST.QR_DOWNLOAD_SUCCESS', { count: exportStudents.length }));
      this.zipDialogOpen.set(false);
    } catch {
      this.notificationService.error(this.translate.instant('STUDENTS.LIST.QR_DOWNLOAD_ERROR'));
    } finally {
      this.downloadingZip.set(false);
      this.zipPhase.set(null);
    }
  }

  /**
   * A ZIP entry name is its identity, so a repeat overwrites the earlier card
   * instead of sitting beside it. Folders normally keep namesakes apart; flat
   * mode has none, so a clash gets " (2)", " (3)", … instead.
   */
  private uniqueFileName(taken: Set<string>, base: string): string {
    let name = `${base}.png`;
    for (let n = 2; taken.has(name); n++) name = `${base} (${n}).png`;
    taken.add(name);
    return name;
  }

  private sanitizeName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
  }
}
