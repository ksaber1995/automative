import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabsModule } from 'primeng/tabs';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { WhatsappTemplatesComponent } from '../whatsapp-templates/whatsapp-templates.component';
import { TelegramSettingsComponent } from '../telegram/telegram-settings.component';

/** Single "Messaging" page hosting the WhatsApp templates and Telegram settings as tabs. */
@Component({
  selector: 'app-messaging',
  standalone: true,
  imports: [CommonModule, TabsModule, TranslateModule, WhatsappTemplatesComponent, TelegramSettingsComponent],
  template: `
    <div class="p-4">
      <p-tabs [value]="activeTab()" (valueChange)="activeTab.set($any($event))">
        <p-tablist>
          @if (canWhatsapp) {
            <p-tab value="whatsapp">
              <i class="pi pi-whatsapp mr-2"></i>{{ 'MESSAGING.TAB_WHATSAPP' | translate }}
            </p-tab>
          }
          @if (canTelegram) {
            <p-tab value="telegram">
              <i class="pi pi-telegram mr-2"></i>{{ 'MESSAGING.TAB_TELEGRAM' | translate }}
            </p-tab>
          }
        </p-tablist>
        <p-tabpanels>
          @if (canWhatsapp) {
            <p-tabpanel value="whatsapp">
              <app-whatsapp-templates></app-whatsapp-templates>
            </p-tabpanel>
          }
          @if (canTelegram) {
            <p-tabpanel value="telegram">
              <app-telegram-settings></app-telegram-settings>
            </p-tabpanel>
          }
        </p-tabpanels>
      </p-tabs>
    </div>
  `,
})
export class MessagingComponent {
  private auth = inject(AuthService);

  // Same visibility rules the two nav items had before they were merged.
  readonly canWhatsapp = this.auth.canRead('academy');
  readonly canTelegram = this.auth.canWrite('academy');

  activeTab = signal<'whatsapp' | 'telegram'>(this.canWhatsapp ? 'whatsapp' : 'telegram');
}
