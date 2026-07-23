import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { DatePickerModule } from 'primeng/datepicker';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CrmService } from '../services/crm.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { CrmActivity, TASK_PRIORITIES, TaskPriority } from '@shared/interfaces/crm.interface';

@Component({
  selector: 'app-crm-tasks',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule,
    DialogModule, SelectModule, InputTextModule, TextareaModule, DatePickerModule,
    TooltipModule, ConfirmDialogModule, TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './crm-tasks.component.html',
})
export class CrmTasksComponent implements OnInit {
  private crm = inject(CrmService);
  private employeeService = inject(EmployeeService);
  private lookup = inject(LookupService);
  private notify = inject(NotificationService);
  private confirm = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  loading = signal(false);
  saving = signal(false);
  tasks = signal<CrmActivity[]>([]);
  employees = signal<{ label: string; value: string }[]>([]);
  leads = signal<{ label: string; value: string }[]>([]);
  branches = signal<LookupOption[]>([]);

  filterStatus = signal<'open' | 'overdue' | 'done' | 'all'>('open');
  filterAssignee: string | null = null;
  filterBranch: string | null = null;
  search = '';

  readonly priorities = TASK_PRIORITIES;
  statusOptions: { label: string; value: 'open' | 'overdue' | 'done' | 'all' }[] = [];
  assigneeFilterOptions = computed(() => [
    { label: this.translate.instant('CRM.T_ALL_ASSIGNEES'), value: null as string | null },
    ...this.employees(),
  ]);
  branchFilterOptions = computed(() => [
    { label: this.translate.instant('CRM.ALL_BRANCHES'), value: null as string | null },
    ...this.branches().map(b => ({ label: b.label, value: b.id as string | null })),
  ]);

  // Dialog
  dialogVisible = signal(false);
  editingId = signal<string | null>(null);
  form: any = this.blank();

  private blank() {
    return { subject: '', body: '', assignedEmployeeId: null, priority: 'MEDIUM' as TaskPriority, dueAt: null as Date | null, leadId: null, branchId: null as string | null };
  }

  ngOnInit() {
    if (!this.authService.canUseCrm()) return;
    this.buildStatusOptions();
    this.translate.onLangChange.subscribe(() => this.buildStatusOptions());
    this.employeeService.getAllEmployees().subscribe({
      next: (list: any[]) => this.employees.set(list.filter(e => e.isActive).map(e => ({ label: `${e.firstName} ${e.lastName}`.trim(), value: e.id }))),
    });
    this.crm.listLeads().subscribe({ next: (rows) => this.leads.set(rows.filter(l => !l.convertedStudentId).map(l => ({ label: l.fullName, value: l.id }))) });
    this.lookup.branches().subscribe({ next: (b) => this.branches.set(b) });
    this.load();
  }

  private buildStatusOptions() {
    this.statusOptions = [
      { label: this.translate.instant('CRM.T_OPEN'), value: 'open' },
      { label: this.translate.instant('CRM.T_OVERDUE'), value: 'overdue' },
      { label: this.translate.instant('CRM.T_DONE'), value: 'done' },
      { label: this.translate.instant('CRM.T_ALL'), value: 'all' },
    ];
  }

  load() {
    this.loading.set(true);
    this.crm.listTasks({
      status: this.filterStatus(),
      assigneeId: this.filterAssignee || undefined,
      branchId: this.filterBranch || undefined,
      search: this.search || undefined,
    }).subscribe({
      next: (rows) => { this.tasks.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  setStatus(s: 'open' | 'overdue' | 'done' | 'all') { this.filterStatus.set(s); this.load(); }

  isOverdue(t: CrmActivity): boolean { return !t.doneAt && !!t.dueAt && new Date(t.dueAt) < new Date(); }

  priorityLabel(p?: string): string { return this.translate.instant('CRM.PRIO_' + (p || 'MEDIUM')); }
  prioritySeverity(p?: string): 'secondary' | 'warn' | 'danger' {
    if (p === 'HIGH') return 'danger';
    if (p === 'LOW') return 'secondary';
    return 'warn';
  }

  branchName(id?: string | null): string {
    if (!id) return '—';
    return this.branches().find(b => b.id === id)?.label || '—';
  }

  openCreate() {
    this.editingId.set(null);
    this.form = this.blank();
    if (this.branches().length === 1) this.form.branchId = this.branches()[0].id;
    this.dialogVisible.set(true);
  }

  openEdit(t: CrmActivity) {
    this.editingId.set(t.id);
    this.form = {
      subject: t.subject || '',
      body: t.body || '',
      assignedEmployeeId: t.assignedEmployeeId || null,
      priority: t.priority || 'MEDIUM',
      dueAt: t.dueAt ? new Date(t.dueAt) : null,
      leadId: t.leadId || null,
      branchId: t.branchId || null,
    };
    this.dialogVisible.set(true);
  }

  save() {
    if (!this.form.subject?.trim()) { this.notify.error(this.translate.instant('CRM.T_TITLE_REQUIRED')); return; }
    this.saving.set(true);
    const dto = {
      subject: this.form.subject.trim(),
      body: this.form.body || null,
      assignedEmployeeId: this.form.assignedEmployeeId || null,
      priority: this.form.priority,
      dueAt: this.form.dueAt ? this.form.dueAt.toISOString() : null,
      leadId: this.form.leadId || null,
      branchId: this.form.branchId || null,
    };
    const id = this.editingId();
    const req = id ? this.crm.updateTask(id, dto) : this.crm.createTask(dto);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.dialogVisible.set(false);
        this.notify.success(this.translate.instant(id ? 'CRM.T_UPDATED' : 'CRM.T_CREATED'));
        this.load();
      },
      error: () => this.saving.set(false),
    });
  }

  toggleDone(t: CrmActivity) {
    this.crm.updateTask(t.id, { done: !t.doneAt }).subscribe({
      next: () => this.load(),
      error: () => {},
    });
  }

  confirmDelete(t: CrmActivity) {
    this.confirm.confirm({
      header: this.translate.instant('CRM.T_DELETE_TITLE'),
      message: this.translate.instant('CRM.T_DELETE_MSG', { title: t.subject }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('CRM.DELETE'),
      rejectLabel: this.translate.instant('CRM.CANCEL'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.crm.deleteActivity(t.id).subscribe({
          next: () => { this.tasks.update(list => list.filter(x => x.id !== t.id)); this.notify.success(this.translate.instant('CRM.T_DELETED')); },
          error: () => {},
        });
      },
    });
  }
}
