import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CrmService, CrmAnalytics } from '../services/crm.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-crm-insights',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, TagModule, SelectModule, TranslateModule],
  templateUrl: './crm-insights.component.html',
})
export class CrmInsightsComponent implements OnInit {
  private crm = inject(CrmService);
  private lookup = inject(LookupService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  loading = signal(false);
  data = signal<CrmAnalytics | null>(null);
  branches = signal<LookupOption[]>([]);
  filterBranch = signal<string | null>(null);
  branchFilterOptions = computed(() => [
    { label: this.translate.instant('CRM.ALL_BRANCHES'), value: null as string | null },
    ...this.branches().map((b) => ({ label: b.label, value: b.id as string | null })),
  ]);

  funnelMax = computed(() => {
    const f = this.data()?.funnel || [];
    return Math.max(1, ...f.map(x => x.count));
  });

  ngOnInit() {
    if (!this.authService.canUseCrm()) return;
    this.lookup.branches().subscribe({ next: (b) => this.branches.set(b) });
    this.load();
  }

  load() {
    this.loading.set(true);
    this.crm.getAnalytics(this.filterBranch() || undefined).subscribe({
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

  obstacleLabel(o: string): string { return this.translate.instant('CRM.OBST_' + o); }

  obstaclesMax = computed(() => {
    const list = this.data()?.obstacles || [];
    return Math.max(1, ...list.map(x => x.count));
  });

  obstacleBar(count: number): string {
    return Math.round((count / this.obstaclesMax()) * 100) + '%';
  }
}
