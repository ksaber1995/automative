import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
import { DragDropModule } from 'primeng/dragdrop';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LeadPanelComponent } from '../lead-panel/lead-panel.component';
import { CrmService } from '../services/crm.service';
import { CourseService } from '../../courses/services/course.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { openWhatsappChat } from '../../../core/utils/whatsapp.util';
import { CrmLead, CrmActivity, LEAD_STAGES, LeadStage } from '@shared/interfaces/crm.interface';
import { ACQUISITION_CHANNELS } from '@shared/interfaces/student.interface';

type Sev = 'secondary' | 'info' | 'warn' | 'success' | 'danger' | 'contrast';

@Component({
  selector: 'app-leads-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule,
    DialogModule, SelectModule, InputTextModule, TextareaModule, DatePickerModule,
    TooltipModule, ConfirmDialogModule, DragDropModule, TranslateModule, LeadPanelComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './leads-list.component.html',
})
export class LeadsListComponent implements OnInit {
  private crm = inject(CrmService);
  private courseService = inject(CourseService);
  private lookup = inject(LookupService);
  private notify = inject(NotificationService);
  private confirm = inject(ConfirmationService);
  private translate = inject(TranslateService);
  private router = inject(Router);
  authService = inject(AuthService);

  loading = signal(false);
  saving = signal(false);
  leads = signal<CrmLead[]>([]);
  branches = signal<LookupOption[]>([]);
  courses = signal<{ label: string; value: string }[]>([]);

  filterStage = signal<string | null>(null);
  search = '';
  toCallOnly = signal(false);

  viewMode = signal<'list' | 'board'>('list');

  // Board grouping (excludes the LOST column-heavy noise but keeps all stages).
  leadsByStage = computed(() => {
    const map: Record<string, CrmLead[]> = {};
    for (const s of LEAD_STAGES) map[s] = [];
    for (const l of this.leads()) (map[l.stage] ||= []).push(l);
    return map;
  });
  private draggedLead: CrmLead | null = null;

  // Lead panel (detail + activities)
  panelVisible = signal(false);
  selectedLead = signal<CrmLead | null>(null);

  // Lost-reason capture
  lostVisible = signal(false);
  lostReason = '';
  private lostTarget: CrmLead | null = null;

  readonly stages = LEAD_STAGES;
  stageFilterOptions = computed(() => [
    { label: this.translate.instant('CRM.ALL_STAGES'), value: null },
    ...LEAD_STAGES.map(s => ({ label: this.translate.instant('CRM.STAGE_' + s), value: s })),
  ]);
  sourceOptions = ACQUISITION_CHANNELS.map(c => ({ label: this.translate.instant('CRM.SRC_' + c), value: c }));

  // Add/edit dialog
  dialogVisible = signal(false);
  editingId = signal<string | null>(null);
  form: any = this.blankForm();

  private blankForm() {
    return { fullName: '', phone: '', email: '', source: null, interestedCourseId: null, branchId: null, stage: 'NEW' as LeadStage, nextActionAt: null as Date | null, notes: '' };
  }

  ngOnInit() {
    if (!this.authService.canUseCrm()) return; // template shows the upgrade notice
    this.lookup.branches().subscribe({ next: (b) => this.branches.set(b) });
    this.courseService.getAllCourses().subscribe({ next: (c) => this.courses.set(c.map(x => ({ label: x.name, value: x.id }))) });
    this.load();
  }

  load() {
    this.loading.set(true);
    this.crm.listLeads({
      stage: this.filterStage() || undefined,
      search: this.search || undefined,
      toCall: this.toCallOnly() ? 'true' : undefined,
    }).subscribe({
      next: (rows) => { this.leads.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  toggleToCall() { this.toCallOnly.update(v => !v); this.load(); }

  stageLabel(s: string): string { return this.translate.instant('CRM.STAGE_' + s); }

  stageSeverity(s: string): Sev {
    switch (s) {
      case 'NEW': return 'info';
      case 'CONTACTED': return 'secondary';
      case 'TRIAL': return 'warn';
      case 'NEGOTIATION': return 'contrast';
      case 'WON': return 'success';
      case 'LOST': return 'danger';
      default: return 'secondary';
    }
  }

  branchName(id?: string | null): string {
    if (!id) return '—';
    return this.branches().find(b => b.id === id)?.label || '—';
  }

  openCreate() {
    this.editingId.set(null);
    this.form = this.blankForm();
    if (this.branches().length === 1) this.form.branchId = this.branches()[0].id;
    this.dialogVisible.set(true);
  }

  openEdit(lead: CrmLead) {
    this.editingId.set(lead.id);
    this.form = {
      fullName: lead.fullName,
      phone: lead.phone || '',
      email: lead.email || '',
      source: lead.source || null,
      interestedCourseId: lead.interestedCourseId || null,
      branchId: lead.branchId || null,
      stage: lead.stage,
      nextActionAt: lead.nextActionAt ? new Date(lead.nextActionAt) : null,
      notes: lead.notes || '',
    };
    this.dialogVisible.set(true);
  }

  save() {
    if (!this.form.fullName?.trim()) {
      this.notify.error(this.translate.instant('CRM.NAME_REQUIRED'));
      return;
    }
    this.saving.set(true);
    const dto: any = {
      fullName: this.form.fullName.trim(),
      phone: this.form.phone || null,
      email: this.form.email || null,
      source: this.form.source || null,
      interestedCourseId: this.form.interestedCourseId || null,
      branchId: this.form.branchId || null,
      stage: this.form.stage,
      notes: this.form.notes || null,
      nextActionAt: this.form.nextActionAt ? this.toDateStr(this.form.nextActionAt) : null,
    };
    const id = this.editingId();
    const req = id ? this.crm.updateLead(id, dto) : this.crm.createLead(dto);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.dialogVisible.set(false);
        this.notify.success(this.translate.instant(id ? 'CRM.UPDATED' : 'CRM.CREATED'));
        this.load();
      },
      error: () => this.saving.set(false),
    });
  }

  /** Inline stage change from the table dropdown / board drop. */
  changeStage(lead: CrmLead, stage: LeadStage) { this.applyStage(lead, stage); }

  private applyStage(lead: CrmLead, stage: LeadStage) {
    if (stage === lead.stage) return;
    // Moving to LOST captures a reason first.
    if (stage === 'LOST') { this.lostTarget = lead; this.lostReason = ''; this.lostVisible.set(true); return; }
    this.saveStage(lead, stage, null);
  }

  private saveStage(lead: CrmLead, stage: LeadStage, lostReason: string | null) {
    const dto: any = { stage };
    if (stage === 'LOST') dto.lostReason = lostReason;
    this.crm.updateLead(lead.id, dto).subscribe({
      next: (updated) => this.leads.update(list => list.map(l => l.id === lead.id ? updated : l)),
      error: () => {},
    });
  }

  confirmLost() {
    if (!this.lostTarget) return;
    this.saveStage(this.lostTarget, 'LOST', this.lostReason.trim() || null);
    this.lostVisible.set(false);
    this.lostTarget = null;
  }

  // ── Board drag & drop ──
  dragStart(lead: CrmLead) { this.draggedLead = lead; }
  dragEnd() { this.draggedLead = null; }
  dropTo(stage: LeadStage) {
    const lead = this.draggedLead;
    this.draggedLead = null;
    if (lead && lead.stage !== stage && !lead.convertedStudentId) this.applyStage(lead, stage);
  }

  // ── Lead panel ──
  openPanel(lead: CrmLead) { this.selectedLead.set(lead); this.panelVisible.set(true); }

  /** Tasks now live on their own page (assignable to employees). */
  goToTasks() { this.router.navigate(['/crm/tasks']); }

  whatsapp(lead: CrmLead) {
    const text = this.translate.instant('CRM.WA_GREETING', { name: lead.fullName, academy: this.authService.getCompanyName() });
    if (!openWhatsappChat(lead.phone, text)) {
      this.notify.error(this.translate.instant('CRM.NO_PHONE'));
      return;
    }
    this.logWhatsapp(lead, text);
  }

  /** Log an outbound WhatsApp on the lead's timeline (best-effort). */
  private logWhatsapp(lead: CrmLead, text: string) {
    this.crm.createActivity(lead.id, {
      type: 'WHATSAPP',
      subject: this.translate.instant('CRM.WA_LOGGED'),
      body: text,
    }).subscribe({ next: () => {}, error: () => {} });
  }

  /** Overdue follow-up: an open task whose due date has passed. */
  needsFollowup(lead: CrmLead): boolean {
    return !!lead.nextTaskDueAt && new Date(lead.nextTaskDueAt) < new Date();
  }

  // ── Bulk WhatsApp (click-to-chat, one send per click, each logged) ──
  bulkVisible = signal(false);
  bulkMessage = '';
  bulkQueue = signal<CrmLead[]>([]);
  bulkIndex = signal(0);
  bulkSent = signal(0);

  openBulk() {
    const recipients = this.leads().filter(l => l.phone && !l.convertedStudentId);
    if (recipients.length === 0) { this.notify.warning(this.translate.instant('CRM.BULK_NO_RECIPIENTS')); return; }
    this.bulkQueue.set(recipients);
    this.bulkIndex.set(0);
    this.bulkSent.set(0);
    this.bulkMessage = this.translate.instant('CRM.BULK_DEFAULT');
    this.bulkVisible.set(true);
  }

  bulkCurrent(): CrmLead | null {
    const q = this.bulkQueue();
    const i = this.bulkIndex();
    return i < q.length ? q[i] : null;
  }

  private renderBulk(lead: CrmLead): string {
    return (this.bulkMessage || '').replace(/\{\{\s*name\s*\}\}/g, lead.fullName);
  }

  bulkSendNext() {
    const lead = this.bulkCurrent();
    if (!lead) return;
    const text = this.renderBulk(lead);
    if (openWhatsappChat(lead.phone, text)) {
      this.logWhatsapp(lead, text);
      this.bulkSent.update(n => n + 1);
    }
    this.bulkIndex.update(i => i + 1);
    if (this.bulkIndex() >= this.bulkQueue().length) {
      this.notify.success(this.translate.instant('CRM.BULK_FINISHED', { count: this.bulkSent() }));
      this.bulkVisible.set(false);
    }
  }

  bulkSkip() {
    this.bulkIndex.update(i => i + 1);
    if (this.bulkIndex() >= this.bulkQueue().length) this.bulkVisible.set(false);
  }

  confirmConvert(lead: CrmLead) {
    this.confirm.confirm({
      header: this.translate.instant('CRM.CONVERT_TITLE'),
      message: this.translate.instant('CRM.CONVERT_MSG', { name: lead.fullName }),
      icon: 'pi pi-user-plus',
      acceptLabel: this.translate.instant('CRM.CONVERT_ACCEPT'),
      rejectLabel: this.translate.instant('CRM.CANCEL'),
      accept: () => {
        this.crm.convertLead(lead.id).subscribe({
          next: (res) => {
            this.notify.success(this.translate.instant('CRM.CONVERTED'));
            this.load();
            this.router.navigate(['/students', res.studentId]);
          },
          error: () => {},
        });
      },
    });
  }

  confirmDelete(lead: CrmLead) {
    this.confirm.confirm({
      header: this.translate.instant('CRM.DELETE_TITLE'),
      message: this.translate.instant('CRM.DELETE_MSG', { name: lead.fullName }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('CRM.DELETE_ACCEPT'),
      rejectLabel: this.translate.instant('CRM.CANCEL'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.crm.deleteLead(lead.id).subscribe({
          next: () => { this.notify.success(this.translate.instant('CRM.DELETED')); this.leads.update(l => l.filter(x => x.id !== lead.id)); },
          error: () => {},
        });
      },
    });
  }

  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
