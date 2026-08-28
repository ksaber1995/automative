import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EducationalBooksService } from '../services/educational-books.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { EducationalBooksCourseSummary, EducationalBooksCourseDetail } from '@shared/interfaces/course-product.interface';
import { printBooksReport } from '../books-report.util';

@Component({
  selector: 'app-educational-books-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TagModule, SelectModule,
    DialogModule, TranslateModule,
  ],
  templateUrl: './educational-books-list.component.html',
})
export class EducationalBooksListComponent implements OnInit {
  private educationalBooksService = inject(EducationalBooksService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  authService = inject(AuthService);

  courses = signal<EducationalBooksCourseSummary[]>([]);
  branches = signal<LookupOption[]>([]);
  loading = signal(false);
  selectedBranchId = signal<string | null>(null);
  selectedCourseName = signal<string | null>(null);

  branchOptions = computed(() =>
    this.branches().map((b) => ({ label: b.label, value: b.id })),
  );

  courseNameOptions = computed(() => {
    const names = new Set(this.courses().map(c => c.courseName));
    return Array.from(names).sort().map(n => ({ label: n, value: n }));
  });

  filteredCourses = computed(() => {
    let result = this.courses();
    const branch = this.selectedBranchId();
    if (branch) {
      result = result.filter((c) => c.branchId === branch || c.branchId === null);
    }
    const courseName = this.selectedCourseName();
    if (courseName) {
      result = result.filter((c) => c.courseName === courseName);
    }
    return result;
  });

  ngOnInit() {
    this.loadCourses();
    this.lookupService.branches().subscribe({
      next: (b) => this.branches.set(b),
    });
  }

  loadCourses() {
    this.loading.set(true);
    this.educationalBooksService.getCourses().subscribe({
      next: (data) => {
        this.courses.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading courses:', err);
        this.loading.set(false);
      },
    });
  }

  view(course: EducationalBooksCourseSummary) {
    this.router.navigate(['/educational-books', course.courseId]);
  }

  // ── The printed buyers report: one course, one class, or everything ────────
  private translate = inject(TranslateService);
  private languageService = inject(LanguageService);

  printDialogVisible = signal(false);
  printCourseId = signal<string | null>(null);   // null = every listed course
  printClassId = signal<string | null>(null);    // only when one course chosen
  printing = signal(false);
  /** The chosen course's detail, fetched when it is picked — carries its classes. */
  private printCourseDetail = signal<EducationalBooksCourseDetail | null>(null);

  printCourseOptions = computed(() =>
    this.filteredCourses().map((c) => ({
      label: c.branchName ? `${c.courseName} — ${c.branchName}` : c.courseName,
      value: c.courseId,
    })),
  );

  printClassOptions = computed(() => {
    const detail = this.printCourseDetail();
    if (!detail || detail.courseId !== this.printCourseId()) return [];
    const byId = new Map<string, string>();
    for (const p of detail.products) {
      for (const s of [...p.buyers, ...p.nonBuyers]) {
        if (s.classId && s.className) byId.set(s.classId, s.className);
      }
    }
    return [...byId.entries()]
      .map(([value, label]) => ({ label, value }))
      .sort((a, z) => a.label.localeCompare(z.label));
  });

  openPrintDialog(): void {
    this.printCourseId.set(null);
    this.printClassId.set(null);
    this.printCourseDetail.set(null);
    this.printDialogVisible.set(true);
  }

  /** Picking a course fetches its detail so the class filter can offer its classes. */
  onPrintCourseChange(courseId: string | null): void {
    this.printCourseId.set(courseId);
    this.printClassId.set(null);
    this.printCourseDetail.set(null);
    if (!courseId) return;
    this.educationalBooksService.getCourseDetail(courseId).subscribe({
      next: (detail) => this.printCourseDetail.set(detail),
      error: () => {},
    });
  }

  confirmPrint(): void {
    if (this.printing()) return;
    const t = (k: string, p?: object) => this.translate.instant(k, p);
    const rtl = this.languageService.isRtl();
    const courseId = this.printCourseId();

    if (courseId) {
      const ready = this.printCourseDetail();
      const classId = this.printClassId();
      const finish = (detail: EducationalBooksCourseDetail) => {
        this.printing.set(false);
        this.printDialogVisible.set(false);
        printBooksReport({
          details: [detail],
          classId,
          className: this.printClassOptions().find((o) => o.value === classId)?.label ?? null,
          t, rtl,
        });
      };
      if (ready && ready.courseId === courseId) { finish(ready); return; }
      this.printing.set(true);
      this.educationalBooksService.getCourseDetail(courseId).subscribe({
        next: finish,
        error: () => this.printing.set(false),
      });
      return;
    }

    // Every course currently listed (the page's branch/course filters count).
    const ids = this.filteredCourses().map((c) => c.courseId);
    if (!ids.length) return;
    this.printing.set(true);
    forkJoin(ids.map((id) => this.educationalBooksService.getCourseDetail(id))).subscribe({
      next: (details) => {
        this.printing.set(false);
        this.printDialogVisible.set(false);
        printBooksReport({ details, t, rtl });
      },
      error: () => this.printing.set(false),
    });
  }
}
