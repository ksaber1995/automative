import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { saveAs } from 'file-saver';
import { CrmService } from '../services/crm.service';
import { CrmNavComponent } from '../crm-nav/crm-nav.component';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { openWhatsappChat } from '../../../core/utils/whatsapp.util';
import { CrmLead, CrmList } from '@shared/interfaces/crm.interface';

/**
 * CRM Lists — named groups of leads, like a WhatsApp broadcast list. A lead can
 * sit in many lists; adding one that is already a member is a no-op server-side.
 *
 * Messaging a list reuses the CRM's existing click-to-chat queue: one chat opens
 * per click (browsers block a burst of window.open, and there is no Meta API
 * here — every message is sent from the staff member's own number), and each send
 * is logged on that lead's timeline.
 *
 * Academy-only, on the Advanced plan: canUseCrm() hides it here, and the API's
 * crmDenied() enforces it for real.
 */
@Component({
  selector: 'app-crm-lists',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TableModule, TagModule,
    DialogModule, InputTextModule, TextareaModule, TooltipModule, ConfirmDialogModule,
    TranslateModule, CrmNavComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './crm-lists.component.html',
})
export class CrmListsComponent implements OnInit {
  private crm = inject(CrmService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);
  private confirm = inject(ConfirmationService);
  authService = inject(AuthService);

  lists = signal<CrmList[]>([]);
  loading = signal(false);

  /** The list being viewed; null = the overview of all lists. */
  active = signal<CrmList | null>(null);
  members = signal<CrmLead[]>([]);
  loadingMembers = signal(false);

  // Create / rename
  formVisible = signal(false);
  editing = signal<CrmList | null>(null);
  formName = '';
  formDescription = '';
  saving = signal(false);

  // Add-leads picker
  pickerVisible = signal(false);
  allLeads = signal<CrmLead[]>([]);
  loadingLeads = signal(false);
  pickerSearch = signal('');
  picked = signal<Set<string>>(new Set());
  adding = signal(false);

  /** Leads not already in the list, filtered by the picker's search box. */
  pickerLeads = computed(() => {
    const already = new Set(this.members().map((m) => m.id));
    const q = this.pickerSearch().trim().toLowerCase();
    return this.allLeads()
      .filter((l) => !already.has(l.id))
      .filter((l) => !q
        || l.fullName.toLowerCase().includes(q)
        || (l.phone ?? '').toLowerCase().includes(q));
  });

  ngOnInit(): void {
    if (!this.authService.canUseCrm()) return;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.crm.listLists().subscribe({
      next: (rows) => { this.lists.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),   // interceptor toasts the server error
    });
  }

  open(list: CrmList): void {
    this.active.set(list);
    this.loadMembers(list.id);
  }

  back(): void {
    this.active.set(null);
    this.members.set([]);
    this.load();   // member counts may have changed
  }

  private loadMembers(id: string): void {
    this.loadingMembers.set(true);
    this.crm.listMembers(id).subscribe({
      next: (rows) => { this.members.set(rows); this.loadingMembers.set(false); },
      error: () => this.loadingMembers.set(false),
    });
  }

  // ── Create / rename / delete ────────────────────────────────────────────────
  openCreate(): void {
    this.editing.set(null);
    this.formName = '';
    this.formDescription = '';
    this.formVisible.set(true);
  }

  openRename(list: CrmList): void {
    this.editing.set(list);
    this.formName = list.name;
    this.formDescription = list.description ?? '';
    this.formVisible.set(true);
  }

  saveList(): void {
    const name = this.formName.trim();
    if (!name) {
      this.notify.error(this.translate.instant('CRM.LISTS_NAME_REQUIRED'));
      return;
    }
    this.saving.set(true);
    const dto = { name, description: this.formDescription.trim() || null };
    const editing = this.editing();
    const call = editing ? this.crm.updateList(editing.id, dto) : this.crm.createList(dto);

    call.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.formVisible.set(false);
        this.notify.success(this.translate.instant(editing ? 'CRM.LISTS_SAVED' : 'CRM.LISTS_CREATED'));
        if (editing && this.active()?.id === saved.id) this.active.set(saved);
        this.load();
      },
      error: () => this.saving.set(false),   // interceptor toasts (e.g. duplicate name)
    });
  }

  confirmDelete(list: CrmList): void {
    this.confirm.confirm({
      header: this.translate.instant('CRM.LISTS_DELETE_TITLE'),
      message: this.translate.instant('CRM.LISTS_DELETE_MSG', { name: list.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.crm.deleteList(list.id).subscribe({
          next: () => {
            this.notify.success(this.translate.instant('CRM.LISTS_DELETED'));
            if (this.active()?.id === list.id) this.active.set(null);
            this.load();
          },
          error: () => {},
        });
      },
    });
  }

  // ── Members ────────────────────────────────────────────────────────────────
  openPicker(): void {
    this.picked.set(new Set());
    this.pickerSearch.set('');
    this.pickerVisible.set(true);
    if (this.allLeads().length) return;

    this.loadingLeads.set(true);
    this.crm.listLeads().subscribe({
      next: (rows) => { this.allLeads.set(rows); this.loadingLeads.set(false); },
      error: () => this.loadingLeads.set(false),
    });
  }

  togglePick(lead: CrmLead): void {
    this.picked.update((set) => {
      const next = new Set(set);
      next.has(lead.id) ? next.delete(lead.id) : next.add(lead.id);
      return next;
    });
  }

  isPicked(lead: CrmLead): boolean {
    return this.picked().has(lead.id);
  }

  addPicked(): void {
    const list = this.active();
    const ids = [...this.picked()];
    if (!list || !ids.length) return;

    this.adding.set(true);
    this.crm.addMembers(list.id, ids).subscribe({
      next: (res) => {
        this.adding.set(false);
        this.pickerVisible.set(false);
        this.notify.success(this.translate.instant('CRM.LISTS_ADDED', { count: res.added }));
        this.loadMembers(list.id);
      },
      error: () => this.adding.set(false),
    });
  }

  removeMember(lead: CrmLead): void {
    const list = this.active();
    if (!list) return;
    this.crm.removeMember(list.id, lead.id).subscribe({
      next: () => {
        this.members.update((rows) => rows.filter((r) => r.id !== lead.id));
        this.notify.success(this.translate.instant('CRM.LISTS_REMOVED'));
      },
      error: () => {},
    });
  }

  // ── Message the list (click-to-chat, one send per click) ────────────────────
  bulkVisible = signal(false);
  bulkMessage = '';
  bulkQueue = signal<CrmLead[]>([]);
  bulkIndex = signal(0);
  bulkSent = signal(0);

  openBulk(): void {
    // Only members with a phone can be messaged at all.
    const recipients = this.members().filter((l) => l.phone);
    if (!recipients.length) {
      this.notify.warning(this.translate.instant('CRM.BULK_NO_RECIPIENTS'));
      return;
    }
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

  bulkSendNext(): void {
    const lead = this.bulkCurrent();
    if (!lead) return;
    const text = this.renderBulk(lead);
    if (openWhatsappChat(lead.phone, text)) {
      // Best-effort: the message shows on the lead's timeline like any other.
      this.crm.createActivity(lead.id, {
        type: 'WHATSAPP',
        subject: this.translate.instant('CRM.WA_LOGGED'),
        body: text,
      }).subscribe({ next: () => {}, error: () => {} });
      this.bulkSent.update((n) => n + 1);
    }
    this.advance();
  }

  bulkSkip(): void {
    this.advance();
  }

  private advance(): void {
    this.bulkIndex.update((i) => i + 1);
    if (this.bulkIndex() >= this.bulkQueue().length) {
      this.notify.success(this.translate.instant('CRM.BULK_FINISHED', { count: this.bulkSent() }));
      this.bulkVisible.set(false);
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  exportCsv(): void {
    const list = this.active();
    const rows = this.members();
    if (!list || !rows.length) return;

    // Quote every field and double any inner quote — a lead name with a comma
    // would otherwise split into two columns.
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['name', 'phone', 'email', 'stage', 'source'].map(esc).join(',');
    const body = rows
      .map((l) => [l.fullName, l.phone, l.email, l.stage, l.source].map(esc).join(','))
      .join('\n');

    // BOM first: without it Excel reads the Arabic names as mojibake.
    const csv = '﻿' + header + '\n' + body;
    const name = `${list.name}.csv`.replace(/[\\/:*?"<>|]/g, '_');
    saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
  }

  stageSeverity(stage: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (stage) {
      case 'WON': return 'success';
      case 'LOST': return 'danger';
      case 'NEGOTIATION': return 'warn';
      case 'TRIAL': return 'info';
      default: return 'secondary';
    }
  }

  stageLabel(stage: string): string {
    return this.translate.instant(`CRM.STAGE_${stage}`);
  }
}
