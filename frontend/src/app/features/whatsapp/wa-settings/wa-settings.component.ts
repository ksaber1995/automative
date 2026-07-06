import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WaNavComponent } from '../wa-nav/wa-nav.component';
import { WhatsappService, WaSettings } from '../services/whatsapp.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-wa-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, CheckboxModule, InputNumberModule, TranslateModule, WaNavComponent],
  template: `
    <div class="p-4">
      <app-wa-nav></app-wa-nav>
      <div class="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h1 class="text-2xl font-bold text-gray-800">{{ 'WA.SETTINGS_TITLE' | translate }}</h1>
          <p class="text-sm text-gray-500">{{ 'WA.SETTINGS_SUBTITLE' | translate }}</p>
        </div>
        <p-button icon="pi pi-check" [label]="'WA.SAVE' | translate" (onClick)="save()" [loading]="saving()"></p-button>
      </div>

      @if (loading()) {
        <div class="text-center text-gray-400 py-10"><i class="pi pi-spin pi-spinner text-2xl"></i></div>
      } @else if (form) {
        <p-card [header]="'WA.SEC_ATTENDANCE' | translate" styleClass="mb-4">
          <div class="flex flex-col gap-3">
            <label class="flex items-center gap-3 cursor-pointer">
              <p-checkbox [(ngModel)]="form.autoSendOnCheckin" [binary]="true"></p-checkbox>
              <span class="text-sm text-gray-700">{{ 'WA.OPT_CHECKIN' | translate }}</span>
            </label>
            <label class="flex items-center gap-3 cursor-pointer">
              <p-checkbox [(ngModel)]="form.autoSendOnAbsence" [binary]="true"></p-checkbox>
              <span class="text-sm text-gray-700">{{ 'WA.OPT_ABSENCE' | translate }}</span>
            </label>
            <label class="flex items-center gap-3 cursor-pointer">
              <p-checkbox [(ngModel)]="form.autoSendAbsenceWarning" [binary]="true"></p-checkbox>
              <span class="text-sm text-gray-700">{{ 'WA.OPT_ABSENCE_WARNING' | translate }}</span>
            </label>
            <div class="flex items-center gap-2 ml-8">
              <span class="text-sm text-gray-500">{{ 'WA.THRESHOLD' | translate }}</span>
              <p-inputnumber [(ngModel)]="form.absenceWarningThreshold" [min]="1" [max]="20" [showButtons]="true" [style]="{ width: '120px' }"></p-inputnumber>
            </div>
          </div>
        </p-card>

        @if (isAdvanced()) {
          <p-card [header]="'WA.SEC_CRM' | translate">
            <div class="flex flex-col gap-3">
              <label class="flex items-center gap-3 cursor-pointer">
                <p-checkbox [(ngModel)]="form.crmAutoOutreach" [binary]="true"></p-checkbox>
                <span class="text-sm text-gray-700">{{ 'WA.OPT_CRM_OUTREACH' | translate }}</span>
              </label>
              <label class="flex items-center gap-3 cursor-pointer">
                <p-checkbox [(ngModel)]="form.crmAutoDrip" [binary]="true"></p-checkbox>
                <span class="text-sm text-gray-700">{{ 'WA.OPT_CRM_DRIP' | translate }}</span>
              </label>
              <label class="flex items-center gap-3 cursor-pointer">
                <p-checkbox [(ngModel)]="form.crmStopOnReply" [binary]="true"></p-checkbox>
                <span class="text-sm text-gray-700">{{ 'WA.OPT_CRM_STOP_ON_REPLY' | translate }}</span>
              </label>
            </div>
          </p-card>
        }
      }
    </div>
  `,
})
export class WaSettingsComponent implements OnInit {
  private wa = inject(WhatsappService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  loading = signal(true);
  saving = signal(false);
  form: WaSettings | null = null;

  isAdvanced = (): boolean => this.authService.canUseCrm();

  ngOnInit() {
    this.wa.getSettings().subscribe({
      next: (s) => { this.form = s; this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  save() {
    if (!this.form) return;
    this.saving.set(true);
    this.wa.updateSettings(this.form).subscribe({
      next: (s) => { this.form = s; this.saving.set(false); this.notify.success(this.translate.instant('WA.SAVED')); },
      error: () => this.saving.set(false),
    });
  }
}
