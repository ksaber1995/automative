import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { TabsModule } from 'primeng/tabs';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { StudentService } from '../services/student.service';
import { StudentCardData, currentAcademicYear, renderCardBackPng, renderStudentCardPng } from '../card-render.util';
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
    StudentImportDialogComponent
  ],
  providers: [ConfirmationService],
  templateUrl: './student-list.component.html',
  styleUrl: './student-list.component.scss'
})
export class StudentListComponent implements OnInit {
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
  showCode = (s: Student) => shouldShowStudentCode(s, this.authService.isTeacher());

  students = signal<Student[]>([]);
  allBranches = signal<LookupOption[]>([]);
  allCourses = signal<LookupOption[]>([]);
  loading = signal(true);
  selectedBranchId: string = '';
  selectedCourseId = signal('');
  searchTerm = signal('');
  enrollmentCounts = signal<Record<string, EnrollmentCounts>>({});
  // studentId → set of courseIds the student is enrolled in (drives the course filter).
  studentCourseMap = signal<Map<string, Set<string>>>(new Map());
  activeTab = signal<'active' | 'inactive'>('active');

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
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return filtered;
    return filtered.filter(s => {
      const full = `${s.firstName ?? ''} ${s.lastName ?? ''}`.toLowerCase();
      return full.includes(term)
        || (s.firstName ?? '').toLowerCase().includes(term)
        || (s.lastName ?? '').toLowerCase().includes(term)
        || (s.parentName ?? '').toLowerCase().includes(term)
        // Also match by student code and phone numbers (student / parent).
        || String(s.studentCode ?? '').includes(term)
        || (s.phone ?? '').toLowerCase().includes(term)
        || (s.parentPhone ?? '').toLowerCase().includes(term);
    });
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
    this.lookupService.courses().subscribe({
      next: (courses) => this.allCourses.set(courses),
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
      }
      this.enrollmentCounts.set(map);
      this.studentCourseMap.set(courseMap);
    };
    this.enrollmentService.getAllEnrollments().subscribe({
      next: (list) => { enrollments = list; finalize(); },
      error: () => finalize(),
    });
    this.classService.getAllClasses().subscribe({
      next: (list) => { classes = list; finalize(); },
      error: () => finalize(),
    });
  }

  getCounts(studentId: string): EnrollmentCounts {
    return this.enrollmentCounts()[studentId] || { active: 0, completed: 0 };
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
    this.loadStudents();
  }

  onTabChange(tab: 'active' | 'inactive') {
    if (this.activeTab() === tab) return;
    this.activeTab.set(tab);
    if (this.selectedBranchId) {
      this.selectedBranchId = '';
      this.loadStudents();
    }
  }

  viewStudent(student: Student) {
    this.router.navigate(['/students', student.id]);
  }

  editStudent(student: Student) {
    this.router.navigate(['/students', student.id, 'edit']);
  }

  deleteStudent(student: Student) {
    this.confirmationService.confirm({
      message: this.translate.instant('STUDENTS.DEACTIVATE_CONFIRM', {
        name: `${student.firstName} ${student.lastName}`,
      }),
      header: this.translate.instant('STUDENTS.DEACTIVATE_HEADER'),
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.studentService.deleteStudent(student.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('STUDENTS.DEACTIVATED'));
            this.loadStudents();
          }
        });
      }
    });
  }

  activateStudent(student: Student) {
    this.confirmationService.confirm({
      message: this.translate.instant('STUDENTS.ACTIVATE_CONFIRM', {
        name: `${student.firstName} ${student.lastName}`,
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

  hardDeleteStudent(student: Student) {
    this.confirmationService.confirm({
      message: this.translate.instant('STUDENTS.HARD_DELETE_CONFIRM', {
        name: `${student.firstName} ${student.lastName}`,
      }),
      header: this.translate.instant('STUDENTS.HARD_DELETE_HEADER'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.studentService.hardDeleteStudent(student.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('STUDENTS.HARD_DELETED'));
            this.loadStudents();
          }
        });
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

  // --- Download student ID cards as a ZIP ---
  // One PNG ID card per student per class, filed under `Course/Class/`. A student
  // in two classes therefore gets two cards, since the card names the course,
  // class and level it was issued for.
  downloadingZip = signal(false);

  /**
   * Students whose card can be downloaded — any active student with a token
   * (QR is active by default for all tenants).
   */
  private qrDownloadableStudents(): Student[] {
    return this.students().filter(s => s.isActive && s.qrToken);
  }

  async downloadQrZip() {
    this.downloadingZip.set(true);
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

      const courseMap = new Map<string, { name: string; levelName: string }>(
        courses.map((c: any) => [c.id, { name: c.name, levelName: c.levelName || '' }])
      );
      const classMap = new Map(classes.map((c: Class) => [c.id, { name: c.name, courseId: c.courseId }]));
      const studentIdSet = new Set(activatedStudents.map(s => s.id));

      const studentEnrollments = new Map<string, string[]>();   // studentId -> classIds
      for (const e of enrollments) {
        if (studentIdSet.has(e.studentId)) {
          if (!studentEnrollments.has(e.studentId)) studentEnrollments.set(e.studentId, []);
          studentEnrollments.get(e.studentId)!.push(e.classId);
        }
      }

      // Load the card design first: it picks the template for the per-student
      // fronts as well as the shared back, so a printed pair always matches.
      const design = await firstValueFrom(this.companyService.getCardDesign()).catch(() => null);
      const template = design?.template;

      const zip = new JSZip();
      const origin = window.location.origin;
      const companyName = this.authService.getCompanyName();
      const year = currentAcademicYear();
      const canvas = document.createElement('canvas');   // reused for every card
      await document.fonts.ready;                        // Arabic must shape before we rasterise
      let rendered = 0;

      for (const student of activatedStudents) {
        const card: StudentCardData = {
          companyName,
          name: `${student.firstName} ${student.lastName}`.trim(),
          code: student.studentCode != null ? `#${student.studentCode}` : '',
          level: '',
          group: '',
          year,
          subject: '',
          qrUrl: `${origin}/p/s/${student.qrToken}`,
        };
        const phone = student.phone ? ` (${student.phone})` : '';
        const fileName = this.sanitizeName(`${card.name}${phone}`) + '.png';

        const classIds = studentEnrollments.get(student.id) || [];
        if (classIds.length === 0) {
          zip.file(`Uncategorized/${fileName}`, await renderStudentCardPng(card, canvas, template), { base64: true });
        } else {
          const addedPaths = new Set<string>();
          for (const classId of classIds) {
            const classInfo = classMap.get(classId);
            const course = classInfo ? courseMap.get(classInfo.courseId) : undefined;
            const courseName = this.sanitizeName(course?.name || 'Unknown Course');
            const className = this.sanitizeName(classInfo?.name || 'Unknown Class');
            const path = `${courseName}/${className}/${fileName}`;
            if (addedPaths.has(path)) continue;
            addedPaths.add(path);

            const png = await renderStudentCardPng({
              ...card,
              level: course?.levelName || '',
              group: classInfo?.name || '',
              subject: course?.name || '',
            }, canvas, template);
            zip.file(path, png, { base64: true });
          }
        }

        // Yield periodically so a large batch doesn't lock the main thread.
        if (++rendered % 10 === 0) await new Promise((r) => setTimeout(r));
      }

      // The back face is identical for every student, so it ships once at the ZIP
      // root. Optional: if it fails, the student cards are still worth delivering.
      if (design) {
        try {
          zip.file('card-back.png', await renderCardBackPng(design, canvas), { base64: true });
        } catch {
          console.warn('Card back face skipped — could not render the card design.');
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'student-cards.zip');
      this.notificationService.success(this.translate.instant('STUDENTS.LIST.QR_DOWNLOAD_SUCCESS', { count: activatedStudents.length }));
    } catch {
      this.notificationService.error(this.translate.instant('STUDENTS.LIST.QR_DOWNLOAD_ERROR'));
    } finally {
      this.downloadingZip.set(false);
    }
  }

  private sanitizeName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
  }
}
