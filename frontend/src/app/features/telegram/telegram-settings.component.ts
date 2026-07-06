import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { TabsModule } from 'primeng/tabs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TelegramService, TelegramNotifyTarget } from './telegram.service';
import { NotificationService } from '../../core/services/notification.service';

const TEMPLATE_TYPES = ['PRESENT', 'ABSENT', 'LINK_WELCOME', 'EXAM_RESULT', 'EXAM_ABSENT'] as const;
type TemplateType = (typeof TEMPLATE_TYPES)[number];

// Mirror of the backend defaults (aws/lambda/api/src/routes/telegram.ts) so the
// "Reset to default" buttons can restore the original Arabic messages offline.
const DEFAULT_TELEGRAM_TEMPLATES: Record<TemplateType, string> = {
  PRESENT:
    'رسالة من {academyName}:\n\n✅ تم تسجيل حضور {studentName} في حصة {className} ({courseName}) - الحصة رقم {sessionNumber} بتاريخ {date}.',
  ABSENT:
    'رسالة من {academyName}:\n\n❌ تغيّب {studentName} عن حصة {className} ({courseName}) - الحصة رقم {sessionNumber} بتاريخ {date}. يرجى الحرص على الحضور المنتظم.',
  LINK_WELCOME:
    'تم ربط حسابك على تليجرام بنجاح مع {academyName}. ستصلك إشعارات الحضور والغياب هنا تلقائياً.',
  EXAM_RESULT:
    'رسالة من {academyName}:\n\n📝 نتيجة {studentName} في امتحان {examName} ({courseName}): {grade}/{maxGrade} ({percentage}%).',
  EXAM_ABSENT:
    'رسالة من {academyName}:\n\n📝 تغيّب {studentName} عن امتحان {examName} ({courseName}).',
};

@Component({
  selector: 'app-telegram-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, InputTextModule, TextareaModule, CheckboxModule, SelectModule, DialogModule, TabsModule, TranslateModule],
  template: `
    <div class="p-4 mx-auto" style="display:flex; flex-direction:column; gap:1rem;">
      <h2 class="text-2xl font-bold">{{ 'TELEGRAM.TITLE' | translate }}</h2>
      <p class="text-gray-500">{{ 'TELEGRAM.SUBTITLE' | translate }}</p>

      @if (loading()) {
        <div class="text-center py-10 text-gray-400"><i class="pi pi-spin pi-spinner text-2xl"></i></div>
      } @else {
        <p-tabs [value]="activeTab()" (valueChange)="activeTab.set($any($event))">
          <p-tablist>
            <p-tab value="connection">
              <i class="pi pi-link mr-2"></i>{{ 'TELEGRAM.TAB_CONNECTION' | translate }}
              @if (botConfigured()) {
                <span class="ml-2 w-2 h-2 bg-green-500 rounded-full inline-block"></span>
              }
            </p-tab>
            <p-tab value="notifications">
              <i class="pi pi-bell mr-2"></i>{{ 'TELEGRAM.TAB_NOTIFICATIONS' | translate }}
            </p-tab>
            <p-tab value="messages">
              <i class="pi pi-comment mr-2"></i>{{ 'TELEGRAM.TAB_MESSAGES' | translate }}
            </p-tab>
          </p-tablist>

          <p-tabpanels>
            <!-- ── Tab 1: Bot connection ─────────────────────────────────── -->
            <p-tabpanel value="connection">
              <p-card>
                <h3 class="text-lg font-semibold mb-3">{{ 'TELEGRAM.BOT_SECTION' | translate }}</h3>
                @if (botConfigured()) {
                  <div class="flex items-center gap-3 flex-wrap">
                    <div class="inline-flex items-center gap-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1">
                      <i class="pi pi-check-circle"></i>
                      <span>{{ 'TELEGRAM.BOT_CONNECTED' | translate: { bot: botUsername() } }}</span>
                    </div>
                    <p-button [label]="'TELEGRAM.DISCONNECT' | translate" icon="pi pi-times"
                      severity="danger" [outlined]="true" size="small"
                      [loading]="disconnecting()" (onClick)="disconnect()"></p-button>
                  </div>
                  <p class="text-xs text-gray-400 mt-2">{{ 'TELEGRAM.DISCONNECT_HINT' | translate }}</p>
                } @else {
                  <!-- Each academy connects their OWN bot (created in @BotFather). -->
                  <p class="text-sm text-gray-500 mb-1">{{ 'TELEGRAM.OWN_BOT_HELP' | translate }}</p>
                  <button type="button" class="text-xs text-blue-600 underline mb-3" (click)="showInstructions.set(true)">
                    {{ 'TELEGRAM.HOW_TO_GET_TOKEN' | translate }}
                  </button>
                  <div class="flex items-center gap-2">
                    <input pInputText type="text" class="flex-1"
                      [(ngModel)]="botToken" [placeholder]="'TELEGRAM.BOT_TOKEN_PLACEHOLDER' | translate" />
                    <p-button [label]="'TELEGRAM.BOT_SAVE' | translate" icon="pi pi-link"
                      [loading]="savingBot()" (onClick)="saveBot()"></p-button>
                  </div>

                  <!-- FUTURE: one-click platform-managed (Netrofit) bot from the pool.
                       Hidden for now — each teacher uses their own bot. Keep for later.
                  <p class="text-sm text-gray-500 mb-3">{{ 'TELEGRAM.AUTO_HELP' | translate }}</p>
                  <p-button [label]="'TELEGRAM.AUTO_SETUP' | translate" icon="pi pi-bolt"
                    [loading]="enabling()" (onClick)="enableAuto()"></p-button>
                  -->
                }
              </p-card>
            </p-tabpanel>

            <!-- ── Tab 2: Notification settings ──────────────────────────── -->
            <p-tabpanel value="notifications">
              <p-card>
                <h3 class="text-lg font-semibold mb-3">{{ 'TELEGRAM.NOTIFY_SECTION' | translate }}</h3>
                <div class="flex flex-col gap-3">
                  <label class="flex items-center gap-2">
                    <p-checkbox [(ngModel)]="enabled" [binary]="true"></p-checkbox>
                    <span>{{ 'TELEGRAM.ENABLED' | translate }}</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <p-checkbox [(ngModel)]="notifyOnPresent" [binary]="true"></p-checkbox>
                    <span>{{ 'TELEGRAM.NOTIFY_PRESENT' | translate }}</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <p-checkbox [(ngModel)]="notifyOnAbsent" [binary]="true"></p-checkbox>
                    <span>{{ 'TELEGRAM.NOTIFY_ABSENT' | translate }}</span>
                  </label>
                  <div class="flex items-center gap-2">
                    <span class="w-40">{{ 'TELEGRAM.NOTIFY_TARGET' | translate }}</span>
                    <p-select [options]="targetOptions()" [(ngModel)]="notifyTarget"
                      optionLabel="label" optionValue="value" [style]="{ width: '220px' }"></p-select>
                  </div>
                  <div>
                    <p-button [label]="'TELEGRAM.SAVE' | translate" icon="pi pi-save"
                      [loading]="savingSettings()" (onClick)="saveSettings()"></p-button>
                  </div>
                </div>
              </p-card>
            </p-tabpanel>

            <!-- ── Tab 3: Message templates ──────────────────────────────── -->
            <p-tabpanel value="messages">
              <p-card>
                <div class="flex items-start justify-between gap-3 mb-1">
                  <h3 class="text-lg font-semibold">{{ 'TELEGRAM.TEMPLATES_SECTION' | translate }}</h3>
                  <p-button [label]="'TELEGRAM.RESET_ALL_DEFAULT' | translate" icon="pi pi-replay"
                    severity="secondary" [text]="true" size="small" (onClick)="resetAllToDefault()"></p-button>
                </div>
                <p class="text-xs text-gray-400 mb-3">{{ 'TELEGRAM.TEMPLATES_HELP' | translate }}</p>
                @for (t of templateTypes; track t) {
                  <div class="mb-4">
                    <div class="flex items-center justify-between mb-1">
                      <label class="block text-sm font-medium text-gray-600">{{ 'TELEGRAM.TPL_' + t | translate }}</label>
                      <button type="button" class="text-xs text-blue-600 underline"
                        [disabled]="bodies[t] === defaults[t]" (click)="resetToDefault(t)">
                        {{ 'TELEGRAM.RESET_DEFAULT' | translate }}
                      </button>
                    </div>
                    <textarea pTextarea rows="3" class="w-full" [(ngModel)]="bodies[t]"></textarea>
                  </div>
                }
                <p-button [label]="'TELEGRAM.SAVE_TEMPLATES' | translate" icon="pi pi-save"
                  [loading]="savingTemplates()" (onClick)="saveTemplates()"></p-button>
              </p-card>
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>

        <!-- How-to-get-a-bot-token instructions -->
        <p-dialog [visible]="showInstructions()" (visibleChange)="showInstructions.set($event)" [modal]="true" [draggable]="false" [resizable]="false"
          [style]="{ width: '480px' }" [header]="'TELEGRAM.INSTR_TITLE' | translate">
          <ol class="list-decimal ms-5 space-y-2 text-sm text-gray-700">
            <li>{{ 'TELEGRAM.INSTR_STEP1' | translate }}</li>
            <li>{{ 'TELEGRAM.INSTR_STEP2' | translate }}</li>
            <li>{{ 'TELEGRAM.INSTR_STEP3' | translate }}</li>
            <li>{{ 'TELEGRAM.INSTR_STEP4' | translate }}</li>
            <li>{{ 'TELEGRAM.INSTR_STEP5' | translate }}</li>
          </ol>
          <a href="https://t.me/BotFather" target="_blank"
            class="inline-block mt-4 text-sm text-blue-600 underline">{{ 'TELEGRAM.INSTR_OPEN_BOTFATHER' | translate }}</a>
        </p-dialog>
      }
    </div>
  `,
})
export class TelegramSettingsComponent implements OnInit {
  private svc = inject(TelegramService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  readonly templateTypes = TEMPLATE_TYPES;
  readonly defaults = DEFAULT_TELEGRAM_TEMPLATES;

  activeTab = signal<'connection' | 'notifications' | 'messages'>('connection');

  loading = signal(true);
  savingBot = signal(false);
  enabling = signal(false);
  disconnecting = signal(false);
  savingSettings = signal(false);
  savingTemplates = signal(false);
  botConfigured = signal(false);
  botUsername = signal<string | null>(null);
  showAdvanced = signal(false);
  showInstructions = signal(false);

  botToken = '';
  enabled = false;
  notifyOnPresent = true;
  notifyOnAbsent = true;
  notifyTarget: TelegramNotifyTarget = 'BOTH';
  bodies: Record<string, string> = {};

  targetOptions = () => [
    { label: this.translate.instant('TELEGRAM.TARGET_BOTH'), value: 'BOTH' },
    { label: this.translate.instant('TELEGRAM.TARGET_STUDENT'), value: 'STUDENT' },
    { label: this.translate.instant('TELEGRAM.TARGET_PARENT'), value: 'PARENT' },
  ];

  ngOnInit(): void {
    this.svc.getSettings().subscribe({
      next: (s) => {
        this.botConfigured.set(s.botConfigured);
        this.botUsername.set(s.botUsername);
        this.enabled = s.enabled;
        this.notifyOnPresent = s.notifyOnPresent;
        this.notifyOnAbsent = s.notifyOnAbsent;
        this.notifyTarget = s.notifyTarget;
        for (const t of TEMPLATE_TYPES) this.bodies[t] = s.templates?.[t] ?? DEFAULT_TELEGRAM_TEMPLATES[t];
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Disconnect the current bot so the teacher can connect their own. */
  disconnect(): void {
    this.disconnecting.set(true);
    this.svc.disconnect().subscribe({
      next: (s) => {
        this.botConfigured.set(s.botConfigured);
        this.botUsername.set(s.botUsername);
        this.enabled = s.enabled;
        this.showAdvanced.set(false);
        this.disconnecting.set(false);
        this.notify.success(this.translate.instant('TELEGRAM.DISCONNECTED'));
      },
      error: () => this.disconnecting.set(false),
    });
  }

  /** One-click: claim a platform-owned bot and enable Telegram. */
  enableAuto(): void {
    this.enabling.set(true);
    this.svc.enableWithPooledBot().subscribe({
      next: (s) => {
        this.botConfigured.set(s.botConfigured);
        this.botUsername.set(s.botUsername);
        this.enabled = s.enabled;
        this.enabling.set(false);
        this.notify.success(this.translate.instant('TELEGRAM.BOT_SAVED'));
      },
      error: () => this.enabling.set(false),
    });
  }


  saveBot(): void {
    const token = this.botToken.trim();
    if (!token) return;
    this.savingBot.set(true);
    this.svc.setBot(token).subscribe({
      next: (s) => {
        this.botConfigured.set(s.botConfigured);
        this.botUsername.set(s.botUsername);
        this.enabled = s.enabled;
        this.botToken = '';
        this.savingBot.set(false);
        this.notify.success(this.translate.instant('TELEGRAM.BOT_SAVED'));
      },
      error: () => this.savingBot.set(false),
    });
  }

  saveSettings(): void {
    this.savingSettings.set(true);
    this.svc.updateSettings({
      enabled: this.enabled,
      notifyOnPresent: this.notifyOnPresent,
      notifyOnAbsent: this.notifyOnAbsent,
      notifyTarget: this.notifyTarget,
    }).subscribe({
      next: () => {
        this.savingSettings.set(false);
        this.notify.success(this.translate.instant('TELEGRAM.SAVED'));
      },
      error: () => this.savingSettings.set(false),
    });
  }

  /** Restore a single template's textarea to the built-in default (still needs Save). */
  resetToDefault(t: TemplateType): void {
    this.bodies[t] = DEFAULT_TELEGRAM_TEMPLATES[t];
  }

  /** Restore every template to its built-in default (still needs Save). */
  resetAllToDefault(): void {
    for (const t of TEMPLATE_TYPES) this.bodies[t] = DEFAULT_TELEGRAM_TEMPLATES[t];
  }

  saveTemplates(): void {
    this.savingTemplates.set(true);
    const templates: Record<string, string> = {};
    for (const t of TEMPLATE_TYPES) templates[t] = this.bodies[t] ?? '';
    this.svc.updateTemplates(templates).subscribe({
      next: () => {
        this.savingTemplates.set(false);
        this.notify.success(this.translate.instant('TELEGRAM.SAVED'));
      },
      error: () => this.savingTemplates.set(false),
    });
  }
}
