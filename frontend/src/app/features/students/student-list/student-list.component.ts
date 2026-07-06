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
import { DialogModule } from 'primeng/dialog';
import { TreeModule } from 'primeng/tree';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, TreeNode } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { StudentService } from '../services/student.service';
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
    DialogModule,
    TreeModule,
    TranslateModule
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
  qrFilter = signal<'ALL' | 'ACTIVATED' | 'NOT_ACTIVATED'>('ALL');

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
    const qr = this.qrFilter();
    if (qr === 'ACTIVATED') filtered = filtered.filter(s => s.qrActivated);
    else if (qr === 'NOT_ACTIVATED') filtered = filtered.filter(s => !s.qrActivated);
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

  qrActivatedCount = computed(() => {
    const list = this.activeTab() === 'active'
      ? this.students().filter(s => s.isActive)
      : this.students().filter(s => !s.isActive);
    return list.filter(s => s.qrActivated).length;
  });
  qrNotActivatedCount = computed(() => {
    const list = this.activeTab() === 'active'
      ? this.students().filter(s => s.isActive)
      : this.students().filter(s => !s.isActive);
    return list.filter(s => !s.qrActivated).length;
  });

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

  // --- Download QR Codes as per-class PDFs (bundled in a ZIP) ---
  // The button opens a course/class picker; each selected class becomes its own
  // PDF (`Course/Class.pdf`) and they're all packaged into a single ZIP — the
  // PDF equivalent of the folder-per-class ZIP export below.
  pdfPreparing = signal(false);      // loading enrollments + building the tree
  generatingPdf = signal(false);     // rendering PDFs + zipping
  pdfDialogVisible = signal(false);
  pdfTreeNodes = signal<TreeNode[]>([]);
  pdfSelection: TreeNode[] = [];      // p-tree checkbox selection (parents + leaves)

  // Cached while the dialog is open so Download doesn't refetch/recompute.
  private pdfClassStudents = new Map<string, Student[]>();                       // classId -> its activated students
  private pdfClassMeta = new Map<string, { className: string; courseName: string }>();
  private pdfStudentGroups = new Map<string, string[]>();                        // studentId -> "Course - Class" labels

  /**
   * Students whose QR can be downloaded. Teachers can only export ACTIVATED QRs
   * (unactivated ones aren't live/scannable); academies get QR free, so any
   * active student with a token is exportable.
   */
  private qrDownloadableStudents(): Student[] {
    const teacher = this.authService.isTeacher();
    return this.students().filter(s => s.isActive && s.qrToken && (!teacher || s.qrActivated));
  }

  /** Open the course/class picker for the per-class PDF export. */
  async openPdfDialog() {
    const activatedStudents = this.qrDownloadableStudents();
    if (activatedStudents.length === 0) {
      this.notificationService.warning(this.translate.instant('STUDENTS.LIST.QR_NO_ACTIVATED'));
      return;
    }

    this.pdfPreparing.set(true);
    try {
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

      const courseMap = new Map(courses.map((c: any) => [c.id, c.name]));
      const classMap = new Map(classes.map((c: Class) => [c.id, { name: c.name, courseId: c.courseId }]));
      const studentById = new Map(activatedStudents.map(s => [s.id, s]));
      const studentIdSet = new Set(activatedStudents.map(s => s.id));

      const classStudents = new Map<string, Student[]>();
      const classSeen = new Map<string, Set<string>>();  // dedupe students within a class
      const classMeta = new Map<string, { className: string; courseName: string }>();
      const studentGroups = new Map<string, string[]>();
      const courseClasses = new Map<string, Set<string>>(); // courseId -> classIds (with activated students)

      for (const e of enrollments) {
        if (!studentIdSet.has(e.studentId)) continue;
        const cls = classMap.get(e.classId);
        if (!cls) continue;
        const courseName = courseMap.get(cls.courseId) || 'Unknown Course';

        if (!classMeta.has(e.classId)) classMeta.set(e.classId, { className: cls.name, courseName });
        if (!classStudents.has(e.classId)) { classStudents.set(e.classId, []); classSeen.set(e.classId, new Set()); }
        const seen = classSeen.get(e.classId)!;
        if (!seen.has(e.studentId)) {
          seen.add(e.studentId);
          classStudents.get(e.classId)!.push(studentById.get(e.studentId)!);
        }
        if (!courseClasses.has(cls.courseId)) courseClasses.set(cls.courseId, new Set());
        courseClasses.get(cls.courseId)!.add(e.classId);

        if (!studentGroups.has(e.studentId)) studentGroups.set(e.studentId, []);
        const label = `${courseName} - ${cls.name}`;
        const gl = studentGroups.get(e.studentId)!;
        if (!gl.includes(label)) gl.push(label);
      }

      // Build the course -> class tree, sorted alphabetically, with per-class counts.
      const nodes: TreeNode[] = Array.from(courseClasses.keys())
        .sort((a, b) => String(courseMap.get(a) || '').localeCompare(String(courseMap.get(b) || '')))
        .map(courseId => {
          const children: TreeNode[] = Array.from(courseClasses.get(courseId)!)
            .sort((a, b) => (classMeta.get(a)?.className || '').localeCompare(classMeta.get(b)?.className || ''))
            .map(cid => ({
              key: `class:${cid}`,
              label: `${classMeta.get(cid)?.className || 'Class'} (${classStudents.get(cid)?.length || 0})`,
              data: cid,
              leaf: true,
            }));
          return {
            key: `course:${courseId}`,
            label: String(courseMap.get(courseId) || 'Unknown Course'),
            children,
            expanded: true,
          } as TreeNode;
        });

      this.pdfClassStudents = classStudents;
      this.pdfClassMeta = classMeta;
      this.pdfStudentGroups = studentGroups;
      this.pdfTreeNodes.set(nodes);
      this.pdfSelection = this.flattenTreeNodes(nodes); // preselect everything
      this.pdfDialogVisible.set(true);
    } catch {
      this.notificationService.error(this.translate.instant('STUDENTS.LIST.QR_DOWNLOAD_ERROR'));
    } finally {
      this.pdfPreparing.set(false);
    }
  }

  /** Generate one PDF per selected class and download them all as a single ZIP. */
  async downloadSelectedPdfs() {
    const selectedClassIds = (this.pdfSelection || [])
      .filter(n => typeof n.key === 'string' && n.key.startsWith('class:'))
      .map(n => n.data as string);
    if (selectedClassIds.length === 0) {
      this.notificationService.warning(this.translate.instant('STUDENTS.LIST.QR_PDF_NO_SELECTION'));
      return;
    }

    this.generatingPdf.set(true);
    try {
      const zip = new JSZip();
      const origin = window.location.origin;
      let rendered = 0;

      for (const classId of selectedClassIds) {
        const studentsInClass = this.pdfClassStudents.get(classId) || [];
        if (studentsInClass.length === 0) continue;
        const meta = this.pdfClassMeta.get(classId);

        // A4 PDF, deflate-compressed so large classes don't blow up tab memory.
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        for (let i = 0; i < studentsInClass.length; i++) {
          const student = studentsInClass[i];
          const groups = this.pdfStudentGroups.get(student.id) || [];
          await this.renderStudentPages(pdf, student, origin, groups, i === 0);
          // Yield periodically so a large batch doesn't lock the main thread.
          if (++rendered % 25 === 0) await new Promise((r) => setTimeout(r));
        }

        const courseName = this.sanitizeName(meta?.courseName || 'Unknown Course');
        const className = this.sanitizeName(meta?.className || 'Unknown Class');
        zip.file(`${courseName}/${className}.pdf`, pdf.output('arraybuffer'));
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'qr-pdfs.zip');
      this.pdfDialogVisible.set(false);
      this.notificationService.success(this.translate.instant('STUDENTS.LIST.QR_PDF_DOWNLOAD_SUCCESS', { count: selectedClassIds.length }));
    } catch {
      this.notificationService.error(this.translate.instant('STUDENTS.LIST.QR_DOWNLOAD_ERROR'));
    } finally {
      this.generatingPdf.set(false);
    }
  }

  /** Flatten a tree into a single array (parents + children) for full selection. */
  private flattenTreeNodes(nodes: TreeNode[]): TreeNode[] {
    const out: TreeNode[] = [];
    const walk = (list: TreeNode[]) => list.forEach(n => { out.push(n); if (n.children) walk(n.children); });
    walk(nodes);
    return out;
  }

  /** Render a student's two pages (QR page + info card) into an existing PDF. */
  private async renderStudentPages(pdf: jsPDF, student: Student, origin: string, groups: string[], isFirst: boolean): Promise<void> {
    const pw = 210; // page width (mm)
    const ph = 297; // page height (mm)

    // --- QR page ---
    if (!isFirst) pdf.addPage();
    const url = `${origin}/p/s/${student.qrToken}`;
    // 500px is plenty to scan a 140mm-wide QR and keeps per-image memory low.
    const dataUrl = await QRCode.toDataURL(url, { width: 500, margin: 2 });
    const qrSize = 140;
    pdf.addImage(dataUrl, 'PNG', (pw - qrSize) / 2, (ph - qrSize) / 2, qrSize, qrSize, undefined, 'FAST');

    // --- Info card page ---
    pdf.addPage();
    const name = `${student.firstName} ${student.lastName}`.trim();
    const phone = student.phone || '';

    const cardW = 160;
    const cardX = (pw - cardW) / 2;
    let cardH = 90 + groups.length * 10;
    if (cardH < 100) cardH = 100;
    const cardY = (ph - cardH) / 2;

    // Card background
    pdf.setFillColor(245, 247, 250);
    pdf.roundedRect(cardX, cardY, cardW, cardH, 6, 6, 'F');

    // Top accent bar (clip the bottom rounded corners with a plain rect)
    pdf.setFillColor(59, 130, 246);
    pdf.roundedRect(cardX, cardY, cardW, 14, 6, 6, 'F');
    pdf.setFillColor(245, 247, 250);
    pdf.rect(cardX, cardY + 8, cardW, 6, 'F');

    // Student name
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(28);
    pdf.setTextColor(30, 41, 59);
    pdf.text(name, pw / 2, cardY + 36, { align: 'center' });

    // Phone
    let yPos = cardY + 50;
    if (phone) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(16);
      pdf.setTextColor(100, 116, 139);
      pdf.text(phone, pw / 2, yPos, { align: 'center' });
      yPos += 14;
    }

    // Divider
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.5);
    pdf.line(cardX + 20, yPos, cardX + cardW - 20, yPos);
    yPos += 10;

    // Groups (class labels)
    if (groups.length > 0) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(13);
      pdf.setTextColor(71, 85, 105);
      for (const g of groups) {
        pdf.text(g, pw / 2, yPos, { align: 'center' });
        yPos += 10;
      }
    } else {
      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(13);
      pdf.setTextColor(148, 163, 184);
      pdf.text('—', pw / 2, yPos, { align: 'center' });
    }
  }

  // --- Download QR Codes as ZIP ---
  downloadingZip = signal(false);

  async downloadQrZip() {
    this.downloadingZip.set(true);
    try {
      const activatedStudents = this.qrDownloadableStudents();
      if (activatedStudents.length === 0) {
        this.notificationService.warning(this.translate.instant('STUDENTS.LIST.QR_NO_ACTIVATED'));
        this.downloadingZip.set(false);
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

      const courseMap = new Map(courses.map((c: any) => [c.id, c.name]));
      const classMap = new Map(classes.map((c: Class) => [c.id, { name: c.name, courseId: c.courseId }]));
      const studentIdSet = new Set(activatedStudents.map(s => s.id));

      const studentEnrollments = new Map<string, { courseId: string; classId: string }[]>();
      for (const e of enrollments) {
        if (studentIdSet.has(e.studentId)) {
          if (!studentEnrollments.has(e.studentId)) studentEnrollments.set(e.studentId, []);
          studentEnrollments.get(e.studentId)!.push({ courseId: e.courseId, classId: e.classId });
        }
      }

      const zip = new JSZip();
      const origin = window.location.origin;

      for (const student of activatedStudents) {
        const url = `${origin}/p/s/${student.qrToken}`;
        const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });
        const base64 = dataUrl.split(',')[1];
        const name = `${student.firstName} ${student.lastName}`.trim();
        const phone = student.phone ? ` (${student.phone})` : '';
        const fileName = this.sanitizeName(`${name}${phone}`) + '.png';

        const enrs = studentEnrollments.get(student.id) || [];
        if (enrs.length === 0) {
          zip.file(`Uncategorized/${fileName}`, base64, { base64: true });
        } else {
          const addedPaths = new Set<string>();
          for (const enr of enrs) {
            const courseName = this.sanitizeName(courseMap.get(enr.courseId) || 'Unknown Course');
            const classInfo = classMap.get(enr.classId);
            const className = this.sanitizeName(classInfo?.name || 'Unknown Class');
            const path = `${courseName}/${className}/${fileName}`;
            if (!addedPaths.has(path)) {
              zip.file(path, base64, { base64: true });
              addedPaths.add(path);
            }
          }
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'qr-codes.zip');
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
