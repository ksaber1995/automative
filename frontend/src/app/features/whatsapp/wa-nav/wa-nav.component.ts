import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/** Sub-navigation shared across the WhatsApp pages. */
@Component({
  selector: 'app-wa-nav',
  standalone: true,
  imports: [RouterModule, TranslateModule],
  template: `
    <div class="flex items-center gap-1 mb-4 border-b border-gray-200 flex-wrap">
      <a routerLink="/whatsapp/connect" routerLinkActive="!border-green-600 !text-green-700"
         class="px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-700">
        <i class="pi pi-link mr-1"></i>{{ 'WA.NAV_CONNECT' | translate }}
      </a>
      <a routerLink="/whatsapp/inbox" routerLinkActive="!border-green-600 !text-green-700"
         class="px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-700">
        <i class="pi pi-inbox mr-1"></i>{{ 'WA.NAV_INBOX' | translate }}
      </a>
      <a routerLink="/whatsapp/settings" routerLinkActive="!border-green-600 !text-green-700"
         class="px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-700">
        <i class="pi pi-cog mr-1"></i>{{ 'WA.NAV_SETTINGS' | translate }}
      </a>
      <a routerLink="/whatsapp/templates" routerLinkActive="!border-green-600 !text-green-700"
         class="px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-700">
        <i class="pi pi-file-edit mr-1"></i>{{ 'WA.NAV_TEMPLATES' | translate }}
      </a>
    </div>
  `,
})
export class WaNavComponent {}
