import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { InputNumberModule } from 'primeng/inputnumber';
import { ProgressBarModule } from 'primeng/progressbar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MessagingService, MessagingSettings, MessagingQuota, MessageLogItem } from '../services/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-messaging-page',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, TabsModule, InputTextModule,
    SelectModule, TagModule, TableModule,
    InputNumberModule, ProgressBarModule, TranslateModule,
  ],
  templateUrl: './messaging-page.component.html',
})
export class MessagingPageComponent implements OnInit {
  private messagingService = inject(MessagingService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);

  activeTab = 'settings';

  // Settings
  settings = signal<MessagingSettings | null>(null);
  loadingSettings = signal(true);
  savingSettings = signal(false);
  requestingActivation = signal(false);

  // Editable settings (local copies)
  absenceWarningThreshold = signal(3);

  // Quota & Log
  quota = signal<MessagingQuota | null>(null);
  loadingQuota = signal(true);
  logItems = signal<MessageLogItem[]>([]);
  logTotal = signal(0);
  loadingLog = signal(true);
  logPage = signal(0);
  logTypeFilter = signal<string | null>(null);

  quotaPercentage = computed(() => {
    const q = this.quota();
    if (!q || q.quotaLimit === 0) return 0;
    return Math.round((q.messagesSent / q.quotaLimit) * 100);
  });

  templates = [
    {
      type: 'ABSENCE',
      icon: 'pi pi-calendar-times',
      color: '#3B82F6',
      titleKey: 'MESSAGING.TEMPLATE_ABSENCE_TITLE',
      bodyKey: 'MESSAGING.TEMPLATE_ABSENCE_BODY',
      varsKey: 'MESSAGING.TEMPLATE_ABSENCE_VARS',
      sentToKey: 'MESSAGING.TEMPLATE_SENT_TO_PARENT',
    },
    {
      type: 'PAYMENT_DELAY',
      icon: 'pi pi-wallet',
      color: '#EAB308',
      titleKey: 'MESSAGING.TEMPLATE_PAYMENT_DELAY_TITLE',
      bodyKey: 'MESSAGING.TEMPLATE_PAYMENT_DELAY_BODY',
      varsKey: 'MESSAGING.TEMPLATE_PAYMENT_DELAY_VARS',
      sentToKey: 'MESSAGING.TEMPLATE_SENT_TO_STUDENT',
    },
    {
      type: 'ABSENCE_WARNING',
      icon: 'pi pi-exclamation-triangle',
      color: '#EF4444',
      titleKey: 'MESSAGING.TEMPLATE_ABSENCE_WARNING_TITLE',
      bodyKey: 'MESSAGING.TEMPLATE_ABSENCE_WARNING_BODY',
      varsKey: 'MESSAGING.TEMPLATE_ABSENCE_WARNING_VARS',
      sentToKey: 'MESSAGING.TEMPLATE_SENT_TO_PARENT',
    },
    {
      type: 'EXAM_RESULTS',
      icon: 'pi pi-file-check',
      color: '#22C55E',
      titleKey: 'MESSAGING.TEMPLATE_EXAM_RESULTS_TITLE',
      bodyKey: 'MESSAGING.TEMPLATE_EXAM_RESULTS_BODY',
      varsKey: 'MESSAGING.TEMPLATE_EXAM_RESULTS_VARS',
      sentToKey: 'MESSAGING.TEMPLATE_SENT_TO_PARENT',
    },
  ];

  typeFilterOptions: { label: string; value: string | null }[] = [];

  private initFilterOptions() {
    this.typeFilterOptions = [
      { label: this.translate.instant('MESSAGING.FILTER_ALL'), value: null },
      { label: this.translate.instant('MESSAGING.TYPE_ABSENCE'), value: 'ABSENCE' },
      { label: this.translate.instant('MESSAGING.TYPE_PAYMENT_DELAY'), value: 'PAYMENT_DELAY' },
      { label: this.translate.instant('MESSAGING.TYPE_ABSENCE_WARNING'), value: 'ABSENCE_WARNING' },
      { label: this.translate.instant('MESSAGING.TYPE_EXAM_RESULTS'), value: 'EXAM_RESULTS' },
    ];
  }

  ngOnInit() {
    this.initFilterOptions();
    this.loadSettings();
    this.loadQuota();
    this.loadLog();
  }

  // ── Settings ─────────────────────────────────────────────────

  loadSettings() {
    this.loadingSettings.set(true);
    this.messagingService.getSettings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.absenceWarningThreshold.set(s.absenceWarningThreshold);
        this.loadingSettings.set(false);
      },
      error: () => this.loadingSettings.set(false),
    });
  }

  saveSettings() {
    this.savingSettings.set(true);
    this.messagingService.updateSettings({
      absenceWarningThreshold: this.absenceWarningThreshold(),
      autoSendAbsence: false,
      autoSendPaymentDelay: false,
      autoSendAbsenceWarning: false,
      autoSendExamResults: false,
    }).subscribe({
      next: () => {
        this.savingSettings.set(false);
        this.notificationService.success(this.translate.instant('MESSAGING.SETTINGS_SAVED'));
        this.loadSettings();
      },
      error: () => this.savingSettings.set(false),
    });
  }

  requestActivation() {
    this.requestingActivation.set(true);
    this.messagingService.requestActivation().subscribe({
      next: () => {
        this.requestingActivation.set(false);
        this.notificationService.success(this.translate.instant('MESSAGING.ACTIVATION_REQUESTED'));
        this.loadSettings();
      },
      error: () => this.requestingActivation.set(false),
    });
  }

  // ── Quota & Log ──────────────────────────────────────────────

  loadQuota() {
    this.loadingQuota.set(true);
    this.messagingService.getQuota().subscribe({
      next: (q) => { this.quota.set(q); this.loadingQuota.set(false); },
      error: () => this.loadingQuota.set(false),
    });
  }

  loadLog() {
    this.loadingLog.set(true);
    const type = this.logTypeFilter() || undefined;
    this.messagingService.listLog({ type, limit: 20, offset: this.logPage() * 20 }).subscribe({
      next: (res) => {
        this.logItems.set(res.items);
        this.logTotal.set(res.total);
        this.loadingLog.set(false);
      },
      error: () => this.loadingLog.set(false),
    });
  }

  onLogFilterChange() {
    this.logPage.set(0);
    this.loadLog();
  }

  onLogPageChange(event: any) {
    this.logPage.set(event.first / event.rows);
    this.loadLog();
  }

  getStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'DELIVERED': case 'READ': return 'success';
      case 'SENT': return 'info';
      case 'PENDING': return 'warn';
      case 'FAILED': return 'danger';
      default: return 'secondary';
    }
  }

  getTypeSeverity(type: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (type) {
      case 'ABSENCE': return 'info';
      case 'PAYMENT_DELAY': return 'warn';
      case 'ABSENCE_WARNING': return 'danger';
      case 'EXAM_RESULTS': return 'success';
      default: return 'secondary';
    }
  }
}
