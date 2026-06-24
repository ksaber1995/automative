import { Component, effect, inject, input, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { TranslateModule } from '@ngx-translate/core';
import QRCode from 'qrcode';
import { TelegramService } from './telegram.service';
import { NotificationService } from '../../core/services/notification.service';
import { TranslateService } from '@ngx-translate/core';

/**
 * Shows the deep links (+ QR codes) a student and their parent scan to connect
 * Telegram. Pressing Start on the link captures their chat so the academy can
 * auto-send attendance notifications.
 */
@Component({
  selector: 'app-telegram-connect-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule, TranslateModule],
  template: `
    <p-dialog [(visible)]="visible" [modal]="true" [draggable]="false" [resizable]="false"
      [style]="{ width: '420px' }" [header]="'TELEGRAM_CONNECT.TITLE' | translate">
      @if (loading()) {
        <div class="text-center py-8 text-gray-400"><i class="pi pi-spin pi-spinner text-2xl"></i></div>
      } @else if (!botConfigured()) {
        <div class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          {{ 'TELEGRAM_CONNECT.NOT_CONFIGURED' | translate }}
        </div>
      } @else {
        <p class="text-sm text-gray-500 mb-4">{{ 'TELEGRAM_CONNECT.HELP' | translate }}</p>
        <div class="grid grid-cols-2 gap-4 text-center">
          <div>
            <div class="font-medium mb-2">
              {{ 'TELEGRAM_CONNECT.STUDENT' | translate }}
              @if (studentLinked()) { <i class="pi pi-check-circle text-green-600"></i> }
            </div>
            @if (studentQr()) {
              <img [src]="studentQr()" alt="student QR" class="mx-auto rounded border border-gray-200" style="width:150px;height:150px;" />
            }
            <a [href]="studentUrl()" target="_blank" class="block text-xs text-blue-600 mt-2 break-all">{{ 'TELEGRAM_CONNECT.OPEN' | translate }}</a>
          </div>
          <div>
            <div class="font-medium mb-2">
              {{ 'TELEGRAM_CONNECT.PARENT' | translate }}
              @if (parentLinked()) { <i class="pi pi-check-circle text-green-600"></i> }
            </div>
            @if (parentQr()) {
              <img [src]="parentQr()" alt="parent QR" class="mx-auto rounded border border-gray-200" style="width:150px;height:150px;" />
            }
            <a [href]="parentUrl()" target="_blank" class="block text-xs text-blue-600 mt-2 break-all">{{ 'TELEGRAM_CONNECT.OPEN' | translate }}</a>
          </div>
        </div>
      }
    </p-dialog>
  `,
})
export class TelegramConnectDialogComponent {
  private svc = inject(TelegramService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  visible = model<boolean>(false);
  studentId = input<string | null>(null);

  loading = signal(false);
  botConfigured = signal(false);
  studentUrl = signal<string | null>(null);
  parentUrl = signal<string | null>(null);
  studentQr = signal<string>('');
  parentQr = signal<string>('');
  studentLinked = signal(false);
  parentLinked = signal(false);

  constructor() {
    // Fetch links each time the dialog opens for a student.
    effect(() => {
      const id = this.studentId();
      const open = this.visible();
      if (open && id) this.load(id);
    });
  }

  private load(studentId: string): void {
    this.loading.set(true);
    this.svc.getStudentLink(studentId).subscribe({
      next: async (res) => {
        this.botConfigured.set(res.botConfigured);
        this.studentUrl.set(res.studentUrl);
        this.parentUrl.set(res.parentUrl);
        this.studentLinked.set(res.studentLinked);
        this.parentLinked.set(res.parentLinked);
        if (res.studentUrl) this.studentQr.set(await QRCode.toDataURL(res.studentUrl, { width: 200, margin: 2 }).catch(() => ''));
        if (res.parentUrl) this.parentQr.set(await QRCode.toDataURL(res.parentUrl, { width: 200, margin: 2 }).catch(() => ''));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
