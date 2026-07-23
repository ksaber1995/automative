import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CrmService, AtRiskStudent } from '../services/crm.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { openWhatsappChat } from '../../../core/utils/whatsapp.util';

@Component({
  selector: 'app-crm-retention',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, TagModule, ButtonModule, SelectModule, TooltipModule, TranslateModule],
  templateUrl: './crm-retention.component.html',
})
export class CrmRetentionComponent implements OnInit {
  private crm = inject(CrmService);
  private lookup = inject(LookupService);
  private translate = inject(TranslateService);
  private notify = inject(NotificationService);
  authService = inject(AuthService);

  loading = signal(false);
  items = signal<AtRiskStudent[]>([]);
  branches = signal<LookupOption[]>([]);
  filterBranch = signal<string | null>(null);
  branchFilterOptions = computed(() => [
    { label: this.translate.instant('CRM.ALL_BRANCHES'), value: null as string | null },
    ...this.branches().map((b) => ({ label: b.label, value: b.id as string | null })),
  ]);

  totalOutstanding = computed(() => this.items().reduce((s, i) => s + (i.outstanding || 0), 0));

  ngOnInit() {
    if (!this.authService.canUseCrm()) return;
    this.lookup.branches().subscribe({ next: (b) => this.branches.set(b) });
    this.load();
  }

  load() {
    this.loading.set(true);
    this.crm.getAtRisk(this.filterBranch() || undefined).subscribe({
      next: (rows) => { this.items.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  reasonLabel(r: string): string { return this.translate.instant('CRM.RISK_' + r); }

  reasonSeverity(r: string): 'warn' | 'danger' | 'secondary' {
    if (r === 'DUES') return 'danger';
    if (r === 'SUBSCRIPTION') return 'warn';
    return 'secondary';
  }

  whatsapp(s: AtRiskStudent) {
    const text = this.translate.instant('CRM.RISK_WA', {
      name: s.parentName || s.fullName,
      student: s.fullName,
      academy: this.authService.getCompanyName(),
      amount: s.outstanding,
    });
    if (!openWhatsappChat(s.parentPhone || s.phone, text)) {
      this.notify.error(this.translate.instant('CRM.NO_PHONE'));
    }
  }
}
