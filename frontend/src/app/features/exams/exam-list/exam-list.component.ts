import { TablePageUxDirective } from '../../../core/directives/table-page-ux.directive';
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
import { ExamService } from '../services/exam.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { ExamModel } from '@shared/interfaces/exam.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-exam-list',
  standalone: true,
  imports: [
    TablePageUxDirective,
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    SelectModule,
    TranslateModule,
    DeleteConfirmDialogComponent,
  ],
  templateUrl: './exam-list.component.html',
})
export class ExamListComponent implements OnInit {
  private service = inject(ExamService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private notifications = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  items = signal<ExamModel[]>([]);
  branches = signal<LookupOption[]>([]);
  courses = signal<LookupOption[]>([]);
  classes = signal<LookupOption[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  toDelete = signal<ExamModel | null>(null);

  selectedBranchId = signal<string | null>(null);
  selectedCourseId = signal<string | null>(null);
  selectedClassId = signal<string | null>(null);
  selectedStatus = signal<'SCHEDULED' | 'DONE' | null>(null);
  /** null = both kinds; the list is now Exams AND Homework. */
  selectedKind = signal<'EXAM' | 'HOMEWORK' | null>(null);

  statusOptions = computed(() => [
    { label: this.translate.instant('EXAMS.STATUS.SCHEDULED'), value: 'SCHEDULED' },
    { label: this.translate.instant('EXAMS.STATUS.DONE'), value: 'DONE' },
  ]);

  kindOptions = computed(() => [
    { label: this.translate.instant('EXAMS.KIND.EXAM'), value: 'EXAM' },
    { label: this.translate.instant('EXAMS.KIND.HOMEWORK'), value: 'HOMEWORK' },
  ]);

  filteredItems = computed(() => {
    const branch = this.selectedBranchId();
    const course = this.selectedCourseId();
    const cls = this.selectedClassId();
    const status = this.selectedStatus();
    const kind = this.selectedKind();
    return this.items().filter((e) => {
      if (branch && e.branchId !== branch) return false;
      if (course && e.courseId !== course) return false;
      // A course-wide row carries no class, so filtering by class leaves it out —
      // it isn't that class's exam, it's every class's.
      if (cls && e.classId !== cls) return false;
      if (status && e.status !== status) return false;
      if (kind && (kind === 'HOMEWORK') !== (e.isHomework === true)) return false;
      return true;
    });
  });

  ngOnInit() {
    this.load();
    this.lookupService.branches().subscribe({ next: (b) => this.branches.set(b) });
    this.lookupService.courses().subscribe({ next: (c) => this.courses.set(c) });
    this.loadClasses(null);
  }

  /**
   * Class names repeat across courses ("Group A" exists in half of them), so
   * picking a course narrows the class list to that course's — otherwise the
   * dropdown is a wall of ambiguous names. With no course chosen it lists all.
   */
  private loadClasses(courseId: string | null) {
    this.lookupService.classes(courseId ? { courseId } : undefined).subscribe({
      next: (c) => this.classes.set(c),
    });
  }

  onCourseFilterChange(courseId: string | null) {
    this.selectedCourseId.set(courseId);
    // The chosen class almost certainly isn't in the new course.
    this.selectedClassId.set(null);
    this.loadClasses(courseId);
  }

  load() {
    this.loading.set(true);
    this.service.getAll().subscribe({
      next: (rows) => { this.items.set(rows); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  getBranchName(branchId: string | null): string {
    if (!branchId) return '—';
    return this.branches().find(b => b.id === branchId)?.label ?? branchId;
  }

  clearFilters() {
    this.selectedBranchId.set(null);
    this.onCourseFilterChange(null);
    this.selectedStatus.set(null);
    this.selectedKind.set(null);
  }

  hasFilters(): boolean {
    return !!(this.selectedBranchId() || this.selectedCourseId() || this.selectedClassId()
      || this.selectedStatus() || this.selectedKind());
  }

  create() { this.router.navigate(['/exams/create']); }
  view(item: ExamModel) { this.router.navigate(['/exams', item.id]); }
  edit(item: ExamModel) { this.router.navigate(['/exams', item.id, 'edit']); }

  confirmDelete(item: ExamModel) {
    this.toDelete.set(item);
    this.showDeleteDialog = true;
  }

  doDelete() {
    const item = this.toDelete();
    if (!item) return;
    this.service.delete(item.id).subscribe({
      next: () => {
        this.notifications.success(this.translate.instant('EXAMS.LIST.DELETE_SUCCESS'));
        this.showDeleteDialog = false;
        this.toDelete.set(null);
        this.load();
      },
      error: () => { this.showDeleteDialog = false; },
    });
  }

  statusSeverity(status: string): 'success' | 'info' | 'warn' | 'secondary' {
    return status === 'DONE' ? 'success' : 'info';
  }
}
