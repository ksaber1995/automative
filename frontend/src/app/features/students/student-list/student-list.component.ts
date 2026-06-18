import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { TabsModule } from 'primeng/tabs';
import { RadioButtonModule } from 'primeng/radiobutton';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { StudentService } from '../services/student.service';
import { BranchService } from '../../branches/services/branch.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { ClassService } from '../../courses/services/class.service';
import { CourseService } from '../../courses/services/course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { Student, AcquisitionChannel } from '@shared/interfaces/student.interface';
import { Branch } from '@shared/interfaces/branch.interface';
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
    DialogModule,
    TooltipModule,
    TabsModule,
    RadioButtonModule,
    TranslateModule
  ],
  providers: [ConfirmationService],
  templateUrl: './student-list.component.html',
  styleUrl: './student-list.component.scss'
})
export class StudentListComponent implements OnInit {
  private studentService = inject(StudentService);
  private branchService = inject(BranchService);
  private enrollmentService = inject(EnrollmentService);
  private classService = inject(ClassService);
  private courseService = inject(CourseService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  students = signal<Student[]>([]);
  allBranches = signal<Branch[]>([]);
  loading = signal(true);
  selectedBranchId: string = '';
  searchTerm = signal('');
  enrollmentCounts = signal<Record<string, EnrollmentCounts>>({});
  activeTab = signal<'active' | 'inactive'>('active');
  qrFilter = signal<'ALL' | 'ACTIVATED' | 'NOT_ACTIVATED'>('ALL');

  branches = computed(() => {
    const all = this.allBranches();
    return this.activeTab() === 'inactive' ? all : all.filter(b => b.isActive);
  });

  branchNameById = computed(() => {
    const map = new Map<string, string>();
    for (const b of this.allBranches()) map.set(b.id, b.name);
    return map;
  });

  branchActiveById = computed(() => {
    const map = new Map<string, boolean>();
    for (const b of this.allBranches()) map.set(b.id, b.isActive);
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
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return filtered;
    return filtered.filter(s => {
      const full = `${s.firstName ?? ''} ${s.lastName ?? ''}`.toLowerCase();
      return full.includes(term)
        || (s.firstName ?? '').toLowerCase().includes(term)
        || (s.lastName ?? '').toLowerCase().includes(term)
        || (s.parentName ?? '').toLowerCase().includes(term);
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
    this.loadStudents();
    this.loadEnrollmentCounts();
  }

  loadEnrollmentCounts() {
    let enrollments: { studentId: string; classId: string }[] = [];
    let classes: Class[] = [];
    let pending = 2;
    const finalize = () => {
      pending--;
      if (pending !== 0) return;
      const classDoneById = new Map(
        classes.map(c => [c.id, c.status === 'DONE' || c.isFinished === true])
      );
      const map: Record<string, EnrollmentCounts> = {};
      for (const e of enrollments) {
        if (!map[e.studentId]) map[e.studentId] = { active: 0, completed: 0 };
        if (classDoneById.get(e.classId)) map[e.studentId].completed++;
        else map[e.studentId].active++;
      }
      this.enrollmentCounts.set(map);
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
    this.branchService.getAllBranches().subscribe({
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

  // --- Download QR Codes ---
  showDownloadDialog = signal(false);
  downloadMode: 'by-course' | 'by-course-class' = 'by-course';
  downloading = signal(false);

  openDownloadDialog() {
    this.showDownloadDialog.set(true);
  }

  closeDownloadDialog() {
    this.showDownloadDialog.set(false);
  }

  async downloadQrCodes() {
    this.downloading.set(true);
    try {
      const activatedStudents = this.students().filter(s => s.isActive && s.qrActivated && s.qrToken);
      if (activatedStudents.length === 0) {
        this.notificationService.warning(this.translate.instant('STUDENTS.LIST.QR_NO_ACTIVATED'));
        this.downloading.set(false);
        return;
      }

      // Load enrollments, classes, courses in parallel
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

      // Build student -> enrollments mapping
      const studentEnrollments = new Map<string, { courseId: string; classId: string }[]>();
      for (const e of enrollments) {
        if (studentIdSet.has(e.studentId)) {
          if (!studentEnrollments.has(e.studentId)) studentEnrollments.set(e.studentId, []);
          studentEnrollments.get(e.studentId)!.push({ courseId: e.courseId, classId: e.classId });
        }
      }

      const zip = new JSZip();
      const mode = this.downloadMode;
      const origin = window.location.origin;

      for (const student of activatedStudents) {
        const url = `${origin}/p/s/${student.qrToken}`;
        const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });
        const base64 = dataUrl.split(',')[1];
        const fileName = this.buildQrFileName(student);

        const enrs = studentEnrollments.get(student.id) || [];
        if (enrs.length === 0) {
          // No enrollments — put in "Uncategorized" folder
          zip.file(`Uncategorized/${fileName}`, base64, { base64: true });
        } else {
          const addedPaths = new Set<string>();
          for (const enr of enrs) {
            const courseName = this.sanitizeName(courseMap.get(enr.courseId) || 'Unknown Course');
            let path: string;
            if (mode === 'by-course') {
              path = `${courseName}/${fileName}`;
            } else {
              const classInfo = classMap.get(enr.classId);
              const className = this.sanitizeName(classInfo?.name || 'Unknown Class');
              path = `${courseName}/${className}/${fileName}`;
            }
            if (!addedPaths.has(path)) {
              zip.file(path, base64, { base64: true });
              addedPaths.add(path);
            }
          }
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'qr-codes.zip');
      this.showDownloadDialog.set(false);
      this.notificationService.success(this.translate.instant('STUDENTS.LIST.QR_DOWNLOAD_SUCCESS', { count: activatedStudents.length }));
    } catch {
      this.notificationService.error(this.translate.instant('STUDENTS.LIST.QR_DOWNLOAD_ERROR'));
    } finally {
      this.downloading.set(false);
    }
  }

  private buildQrFileName(student: Student): string {
    const name = `${student.firstName} ${student.lastName}`.trim();
    const phone = student.phone ? ` (${student.phone})` : '';
    return this.sanitizeName(`${name}${phone}`) + '.png';
  }

  private sanitizeName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
  }
}
