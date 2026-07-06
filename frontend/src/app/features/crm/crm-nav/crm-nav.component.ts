import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/** Sub-navigation shared across the CRM pages (Leads · Insights · Retention). */
@Component({
  selector: 'app-crm-nav',
  standalone: true,
  imports: [RouterModule, TranslateModule],
  template: `
    <div class="flex items-center gap-1 mb-4 border-b border-gray-200">
      <a routerLink="/crm" routerLinkActive="!border-indigo-500 !text-indigo-600" [routerLinkActiveOptions]="{ exact: true }"
         class="px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-700">
        <i class="pi pi-filter mr-1"></i>{{ 'CRM.NAV_LEADS' | translate }}
      </a>
      <a routerLink="/crm/insights" routerLinkActive="!border-indigo-500 !text-indigo-600"
         class="px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-700">
        <i class="pi pi-chart-bar mr-1"></i>{{ 'CRM.NAV_INSIGHTS' | translate }}
      </a>
      <a routerLink="/crm/retention" routerLinkActive="!border-indigo-500 !text-indigo-600"
         class="px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-700">
        <i class="pi pi-heart mr-1"></i>{{ 'CRM.NAV_RETENTION' | translate }}
      </a>
    </div>
  `,
})
export class CrmNavComponent {}
