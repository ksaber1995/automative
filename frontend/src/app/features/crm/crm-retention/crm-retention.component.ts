import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CrmNavComponent } from '../crm-nav/crm-nav.component';
import { CrmService, AtRiskStudent } from '../services/crm.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { openWhatsappChat } from '../../../core/utils/whatsapp.util';

@Component({
  selector: 'app-crm-retention',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule, TagModule, ButtonModule, TooltipModule, TranslateModule, CrmNavComponent],
  templateUrl: './crm-retention.component.html',
})
export class CrmRetentionComponent implements OnInit {
  private crm = inject(CrmService);
  private translate = inject(TranslateService);
  private notify = inject(NotificationService);
  authService = inject(AuthService);

  loading = signal(false);
  items = signal<AtRiskStudent[]>([]);

  totalOutstanding = computed(() => this.items().reduce((s, i) => s + (i.outstanding || 0), 0));

  ngOnInit() {
    if (!this.authService.canUseCrm()) return;
    this.loading.set(true);
    this.crm.getAtRisk().subscribe({
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
