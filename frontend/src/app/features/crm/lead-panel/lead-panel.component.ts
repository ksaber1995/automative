import { Component, inject, input, model, output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { DatePickerModule } from 'primeng/datepicker';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CrmService } from '../services/crm.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { openWhatsappChat } from '../../../core/utils/whatsapp.util';
import { CrmActivity, CrmLead, ACTIVITY_TYPES, ActivityType } from '@shared/interfaces/crm.interface';

@Component({
  selector: 'app-lead-panel',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DialogModule, ButtonModule, SelectModule,
    InputTextModule, TextareaModule, DatePickerModule, TagModule, TooltipModule, TranslateModule,
  ],
  templateUrl: './lead-panel.component.html',
})
export class LeadPanelComponent {
  private crm = inject(CrmService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  visible = model<boolean>(false);
  lead = input<CrmLead | null>(null);
  /** Emitted when the parent should reload (activity or conversion changed state). */
  changed = output<void>();
  requestEdit = output<CrmLead>();
  requestConvert = output<CrmLead>();

  activities = signal<CrmActivity[]>([]);
  loading = signal(false);
  adding = signal(false);

  readonly activityTypes = ACTIVITY_TYPES;
  form: { type: ActivityType; subject: string; body: string; dueAt: Date | null } = this.blank();

  private loadedFor: string | null = null;

  constructor() {
    effect(() => {
      const l = this.lead();
      const open = this.visible();
      if (open && l && this.loadedFor !== l.id) {
        this.loadedFor = l.id;
        this.form = this.blank();
        this.loadActivities(l.id);
      }
      if (!open) this.loadedFor = null;
    });
  }

  private blank() {
    return { type: 'NOTE' as ActivityType, subject: '', body: '', dueAt: null as Date | null };
  }

  private loadActivities(leadId: string) {
    this.loading.set(true);
    this.crm.listActivities(leadId).subscribe({
      next: (rows) => { this.activities.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  typeLabel(t: string): string { return this.translate.instant('CRM.ACT_' + t); }

  typeIcon(t: string): string {
    switch (t) {
      case 'CALL': return 'pi pi-phone';
      case 'WHATSAPP': return 'pi pi-whatsapp';
      case 'MEETING': return 'pi pi-users';
      case 'TASK': return 'pi pi-check-square';
      case 'TRIAL': return 'pi pi-star';
      default: return 'pi pi-file-edit';
    }
  }

  isOverdue(a: CrmActivity): boolean {
    return !a.doneAt && !!a.dueAt && new Date(a.dueAt) < new Date();
  }

  addActivity() {
    const l = this.lead();
    if (!l) return;
    if (!this.form.subject.trim() && !this.form.body.trim()) {
      this.notify.error(this.translate.instant('CRM.ACT_EMPTY'));
      return;
    }
    this.adding.set(true);
    this.crm.createActivity(l.id, {
      type: this.form.type,
      subject: this.form.subject.trim() || null,
      body: this.form.body.trim() || null,
      dueAt: this.form.dueAt ? this.form.dueAt.toISOString() : null,
    }).subscribe({
      next: (act) => {
        this.activities.update(list => [act, ...list]);
        this.form = this.blank();
        this.adding.set(false);
        this.changed.emit();
      },
      error: () => this.adding.set(false),
    });
  }

  toggleDone(a: CrmActivity) {
    this.crm.updateActivity(a.id, { done: !a.doneAt }).subscribe({
      next: (updated) => { this.activities.update(list => list.map(x => x.id === a.id ? updated : x)); this.changed.emit(); },
      error: () => {},
    });
  }

  removeActivity(a: CrmActivity) {
    this.crm.deleteActivity(a.id).subscribe({
      next: () => { this.activities.update(list => list.filter(x => x.id !== a.id)); this.changed.emit(); },
      error: () => {},
    });
  }

  whatsapp() {
    const l = this.lead();
    if (!l) return;
    const text = this.translate.instant('CRM.WA_GREETING', { name: l.fullName, academy: this.authService.getCompanyName() });
    if (!openWhatsappChat(l.phone, text)) { this.notify.error(this.translate.instant('CRM.NO_PHONE')); return; }
    // Log the outreach on the timeline.
    this.crm.createActivity(l.id, { type: 'WHATSAPP', subject: this.translate.instant('CRM.WA_LOGGED'), body: text }).subscribe({
      next: (act) => { this.activities.update(list => [act, ...list]); this.changed.emit(); },
      error: () => {},
    });
  }
}
