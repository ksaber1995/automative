import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CrmNavComponent } from '../crm-nav/crm-nav.component';
import { CrmService, CrmAnalytics } from '../services/crm.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-crm-insights',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule, TagModule, TranslateModule, CrmNavComponent],
  templateUrl: './crm-insights.component.html',
})
export class CrmInsightsComponent implements OnInit {
  private crm = inject(CrmService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  loading = signal(false);
  data = signal<CrmAnalytics | null>(null);

  funnelMax = computed(() => {
    const f = this.data()?.funnel || [];
    return Math.max(1, ...f.map(x => x.count));
  });

  ngOnInit() {
    if (!this.authService.canUseCrm()) return;
    this.loading.set(true);
    this.crm.getAnalytics().subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  stageLabel(s: string): string { return this.translate.instant('CRM.STAGE_' + s); }

  stageSeverity(s: string): 'secondary' | 'info' | 'warn' | 'success' | 'danger' | 'contrast' {
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

  sourceLabel(s: string): string {
    if (s === 'UNKNOWN') return this.translate.instant('CRM.SRC_UNKNOWN');
    const key = 'CRM.SRC_' + s;
    const t = this.translate.instant(key);
    return t === key ? s : t;
  }

  pct(part: number, whole: number): number {
    return whole > 0 ? Math.round((part / whole) * 100) : 0;
  }

  barWidth(count: number): string {
    return Math.round((count / this.funnelMax()) * 100) + '%';
  }
}
