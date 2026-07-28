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
  loading = signal(true);
  showDeleteDialog = false;
  toDelete = signal<ExamModel | null>(null);

  selectedBranchId = signal<string | null>(null);
  selectedCourseId = signal<string | null>(null);
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
    const status = this.selectedStatus();
    const kind = this.selectedKind();
    return this.items().filter((e) => {
      if (branch && e.branchId !== branch) return false;
      if (course && e.courseId !== course) return false;
      if (status && e.status !== status) return false;
      if (kind && (kind === 'HOMEWORK') !== (e.isHomework === true)) return false;
      return true;
    });
  });

  ngOnInit() {
    this.load();
    this.lookupService.branches().subscribe({ next: (b) => this.branches.set(b) });
    this.lookupService.courses().subscribe({ next: (c) => this.courses.set(c) });
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
    this.selectedCourseId.set(null);
    this.selectedStatus.set(null);
    this.selectedKind.set(null);
  }

  hasFilters(): boolean {
    return !!(this.selectedBranchId() || this.selectedCourseId() || this.selectedStatus() || this.selectedKind());
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
