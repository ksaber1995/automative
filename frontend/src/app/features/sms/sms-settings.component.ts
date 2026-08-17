import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { TabsModule } from 'primeng/tabs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SmsService, SmsMessage, SmsStatus, SmsTemplate } from './sms.service';
import { NotificationService } from '../../core/services/notification.service';

/**
 * The tenant's SMS screen.
 *
 * Two things are true at once and both have to be visible: the platform sells
 * the entitlement (SMS on/off for this academy, with an end date, set from the
 * admin console) and the academy chooses which KINDS go out automatically. A
 * teacher who cannot see the second control ends up asking why absence texts
 * are not arriving when the answer is that nobody switched them on.
 *
 * Unlike the WhatsApp tab next door, these are really sent by the server and
 * really cost money — hence the segment count next to every message body.
 */
@Component({
  selector: 'app-sms-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule,
    TextareaModule, CheckboxModule, TabsModule, TranslateModule,
  ],
  template: `
    <div class="p-4 mx-auto" style="display:flex; flex-direction:column; gap:1rem;">
      <h2 class="text-2xl font-bold">{{ 'SMS.TITLE' | translate }}</h2>
      <p class="text-gray-500">{{ 'SMS.SUBTITLE' | translate }}</p>

      @if (loading()) {
        <div class="text-center py-10 text-gray-400"><i class="pi pi-spin pi-spinner text-2xl"></i></div>
      } @else if (!status()?.active) {
        <!-- Not entitled. Say which of the two reasons it is, because "expired"
             and "never switched on" need different phone calls. -->
        <p-card>
          <div class="text-center py-6">
            <i class="pi pi-lock text-3xl text-gray-400"></i>
            <h3 class="text-lg font-semibold mt-3">{{ 'SMS.INACTIVE_TITLE' | translate }}</h3>
            <p class="text-gray-500 mt-2">
              @if (status()?.activated && status()?.expiration) {
                {{ 'SMS.EXPIRED_ON' | translate: { date: status()!.expiration } }}
              } @else {
                {{ 'SMS.INACTIVE_HINT' | translate }}
              }
            </p>
          </div>
        </p-card>
      } @else {
        <p-card>
          <div class="flex flex-wrap gap-4 justify-between items-center">
            <div>
              <div class="text-sm text-gray-500">{{ 'SMS.THIS_MONTH' | translate }}</div>
              <div class="text-2xl font-bold">
                {{ status()!.sentThisMonth }}
                <span class="text-sm font-normal text-gray-500">
                  ({{ 'SMS.SEGMENTS_COUNT' | translate: { count: status()!.segmentsThisMonth } }})
                </span>
              </div>
            </div>
            @if (status()!.expiration) {
              <div class="text-sm text-gray-500">
                {{ 'SMS.ACTIVE_UNTIL' | translate: { date: status()!.expiration } }}
              </div>
            }
          </div>
        </p-card>

        <p-tabs [value]="activeTab()" (valueChange)="activeTab.set($any($event))">
          <p-tablist>
            <p-tab value="automatic">
              <i class="pi pi-bolt mr-2"></i>{{ 'SMS.TAB_AUTOMATIC' | translate }}
            </p-tab>
            <p-tab value="history">
              <i class="pi pi-history mr-2"></i>{{ 'SMS.TAB_HISTORY' | translate }}
            </p-tab>
          </p-tablist>

          <p-tabpanels>
            <p-tabpanel value="automatic">
              <p class="text-gray-500 mb-3">{{ 'SMS.AUTOMATIC_HINT' | translate }}</p>

              @for (t of templates(); track t.type) {
                <p-card styleClass="mb-3">
                  <div class="flex items-start gap-3">
                    <p-checkbox
                      [binary]="true"
                      [ngModel]="t.enabled"
                      (ngModelChange)="setEnabled(t.type, $event)"
                      [inputId]="'sms-' + t.type"
                    ></p-checkbox>
                    <div class="flex-1">
                      <label [for]="'sms-' + t.type" class="font-semibold cursor-pointer">
                        {{ 'SMS.TYPE_' + t.type | translate }}
                      </label>
                      <p class="text-sm text-gray-500 mt-1">{{ 'SMS.TYPE_' + t.type + '_HINT' | translate }}</p>

                      <textarea
                        pTextarea
                        class="w-full mt-2"
                        rows="3"
                        [ngModel]="t.body"
                        (ngModelChange)="setBody(t.type, $event)"
                      ></textarea>

                      <!-- The cost, spelled out. Arabic is UCS-2: 70 characters
                           per paid segment, so a friendly three-line message is
                           four messages on the bill. -->
                      <div class="flex flex-wrap gap-3 items-center mt-1 text-xs text-gray-500">
                        <span>{{ 'SMS.LENGTH' | translate: { length: t.length } }}</span>
                        <span [class.text-orange-500]="t.segments > 1">
                          {{ 'SMS.SEGMENTS_COUNT' | translate: { count: t.segments } }}
                        </span>
                        @if (t.unicode) { <span>{{ 'SMS.UNICODE_NOTE' | translate }}</span> }
                        @if (!t.isDefault) {
                          <button type="button" class="underline" (click)="resetBody(t.type)">
                            {{ 'SMS.RESET_DEFAULT' | translate }}
                          </button>
                        }
                      </div>
                    </div>
                  </div>
                </p-card>
              }

              <div class="flex justify-end">
                <p-button
                  [label]="'COMMON.SAVE' | translate"
                  icon="pi pi-save"
                  [loading]="saving()"
                  [disabled]="!dirty()"
                  (onClick)="save()"
                ></p-button>
              </div>
            </p-tabpanel>

            <p-tabpanel value="history">
              @if (!messages().length) {
                <div class="text-center py-8 text-gray-400">{{ 'SMS.NO_MESSAGES' | translate }}</div>
              } @else {
                <div style="overflow-x:auto;">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="text-left text-gray-500">
                        <th class="p-2">{{ 'SMS.COL_WHEN' | translate }}</th>
                        <th class="p-2">{{ 'SMS.COL_STUDENT' | translate }}</th>
                        <th class="p-2">{{ 'SMS.COL_TYPE' | translate }}</th>
                        <th class="p-2">{{ 'SMS.COL_MESSAGE' | translate }}</th>
                        <th class="p-2">{{ 'SMS.COL_STATUS' | translate }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (m of messages(); track m.id) {
                        <tr class="border-t">
                          <td class="p-2 whitespace-nowrap">{{ m.createdAt | date: 'short' }}</td>
                          <td class="p-2">{{ m.studentName || m.toPhone }}</td>
                          <td class="p-2">{{ 'SMS.TYPE_' + m.type | translate }}</td>
                          <td class="p-2">{{ m.body }}</td>
                          <td class="p-2 whitespace-nowrap">
                            @if (m.status === 'SENT') {
                              <span class="text-green-600">{{ 'SMS.STATUS_SENT' | translate }}</span>
                            } @else {
                              <!-- The failure reason is the whole point of this
                                   table; a bare "failed" sends people to support. -->
                              <span class="text-red-600" [title]="m.error || ''">
                                {{ 'SMS.STATUS_FAILED' | translate }}
                              </span>
                            }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      }
    </div>
  `,
})
export class SmsSettingsComponent implements OnInit {
  private service = inject(SmsService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  protected loading = signal(true);
  protected saving = signal(false);
  protected status = signal<SmsStatus | null>(null);
  protected templates = signal<SmsTemplate[]>([]);
  protected messages = signal<SmsMessage[]>([]);
  protected activeTab = signal<'automatic' | 'history'>('automatic');

  /** What the server last gave us, to tell an edit from a no-op. */
  private original = signal<string>('');

  protected dirty = computed(
    () => JSON.stringify(this.templates().map((t) => [t.type, t.enabled, t.body])) !== this.original(),
  );

  ngOnInit(): void {
    this.service.getStatus().subscribe({
      next: (status) => {
        this.status.set(status);
        if (!status.active) {
          this.loading.set(false);
          return;
        }
        this.service.getSettings().subscribe({
          next: (res) => {
            this.setTemplates(res.templates);
            this.loading.set(false);
          },
          error: () => this.loading.set(false),
        });
        this.service.listMessages().subscribe({
          next: (res) => this.messages.set(res.messages),
          error: () => {},
        });
      },
      error: () => this.loading.set(false),
    });
  }

  private setTemplates(list: SmsTemplate[]): void {
    this.templates.set(list);
    this.original.set(JSON.stringify(list.map((t) => [t.type, t.enabled, t.body])));
  }

  protected setEnabled(type: string, enabled: boolean): void {
    this.templates.update((list) => list.map((t) => (t.type === type ? { ...t, enabled } : t)));
  }

  protected setBody(type: string, body: string): void {
    // The segment count is recomputed by the server on save; until then this is
    // a local estimate using the same rule, so the number does not sit stale
    // while someone is typing.
    const unicode = /[^ -ÿ]/.test(body);
    const length = [...body].length;
    const single = unicode ? 70 : 160;
    const concat = unicode ? 67 : 153;
    const segments = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / concat);
    this.templates.update((list) =>
      list.map((t) => (t.type === type ? { ...t, body, unicode, length, segments, isDefault: false } : t)),
    );
  }

  /** Blank body = back to the shipped default, which the server fills in on save. */
  protected resetBody(type: string): void {
    this.templates.update((list) => list.map((t) => (t.type === type ? { ...t, body: '' } : t)));
  }

  protected save(): void {
    this.saving.set(true);
    const payload = this.templates().map((t) => ({
      type: t.type,
      enabled: t.enabled,
      body: t.body.trim() || null,
    }));
    this.service.updateSettings(payload).subscribe({
      next: (res) => {
        this.setTemplates(res.templates);
        this.saving.set(false);
        this.notify.success(this.translate.instant('SMS.SAVED'));
      },
      error: () => this.saving.set(false),
    });
  }
}
