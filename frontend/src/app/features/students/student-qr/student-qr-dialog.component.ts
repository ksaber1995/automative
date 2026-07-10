import { Component, inject, input, model, output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { TranslateModule } from '@ngx-translate/core';
import QRCode from 'qrcode';
import { TranslateService } from '@ngx-translate/core';
import { StudentService } from '../services/student.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { WhatsappTemplatesService } from '../../../core/services/whatsapp-templates.service';
import { openWhatsappChat, renderWhatsappTemplate } from '../../../core/utils/whatsapp.util';
import { TelegramService } from '../../telegram/telegram.service';
import { Student } from '@shared/interfaces/student.interface';

/**
 * Dialog that renders a student's QR code (encoding the public profile URL),
 * with print / download / regenerate actions. The QR encodes
 * `${window.location.origin}/p/s/<qrToken>` so scanning it with any phone
 * camera opens the public profile, and the in-app scanner can read the same
 * value for attendance check-in.
 */
@Component({
  selector: 'app-student-qr-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule, TranslateModule],
  templateUrl: './student-qr-dialog.component.html',
})
export class StudentQrDialogComponent {
  private studentService = inject(StudentService);
  private notification = inject(NotificationService);
  private authService = inject(AuthService);
  private translate = inject(TranslateService);
  private templatesSvc = inject(WhatsappTemplatesService);
  private telegramSvc = inject(TelegramService);

  /** Two-way bound visibility, driven by the parent. */
  visible = model<boolean>(false);
  /** The student whose QR is shown. */
  student = input<Student | null>(null);
  /** Emitted after a successful regenerate so the parent can refresh its copy. */
  regenerated = output<Student>();

  dataUrl = signal<string>('');
  // Telegram connect links (parent/student deep links), fetched when the dialog
  // opens so the WhatsApp send stays inside the click gesture (no popup block).
  telegramParentUrl = signal<string | null>(null);
  telegramStudentUrl = signal<string | null>(null);
  private tgFetchedForId: string | null = null;
  regenerating = signal(false);

  constructor() {
    // Warm the click-to-chat templates so the send buttons have bodies ready.
    this.templatesSvc.load().subscribe({ error: () => {} });

    // Re-render the QR whenever the dialog opens or the token changes — but only
    // when the QR is actually usable (free, or paid-activated for teachers).
    effect(() => {
      const s = this.student();
      const open = this.visible();
      if (open && s?.qrToken) {
        this.render(s.qrToken);
      }
      // Fetch Telegram connect links once per student when the dialog opens, so
      // the parent/student message can include a tappable bot link.
      if (open && s?.id && this.tgFetchedForId !== s.id) {
        this.tgFetchedForId = s.id;
        this.telegramSvc.getStudentLink(s.id).subscribe({
          next: (r) => {
            this.telegramParentUrl.set(r.botConfigured ? r.parentUrl : null);
            this.telegramStudentUrl.set(r.botConfigured ? r.studentUrl : null);
          },
          error: () => {
            this.telegramParentUrl.set(null);
            this.telegramStudentUrl.set(null);
          },
        });
      }
    });
  }

  private profileUrl(token: string): string {
    return `${window.location.origin}/p/s/${token}`;
  }

  /** Append a "connect Telegram" line with the deep link, when one is available. */
  private withTelegram(text: string, telegramUrl: string | null): string {
    if (!telegramUrl) return text;
    return text + '\n\n' + this.translate.instant('WHATSAPP.TELEGRAM_CONNECT_LINE', { link: telegramUrl });
  }

  /** Click-to-chat: open WhatsApp to the STUDENT with the profile + Telegram links. */
  sendQrToStudent(): void {
    const s = this.student();
    if (!s?.qrToken) return;
    let text = renderWhatsappTemplate(this.templatesSvc.get('QR_STUDENT'), {
      studentName: this.studentName(),
      academyName: this.authService.getCompanyName(),
      link: this.profileUrl(s.qrToken),
    });
    text = this.withTelegram(text, this.telegramStudentUrl());
    if (!openWhatsappChat(s.phone, text)) {
      this.notification.error(this.translate.instant('STUDENT_QR.NO_STUDENT_PHONE'));
    }
  }

  /**
   * Click-to-chat: open WhatsApp to the PARENT with two links — the student
   * details (profile) link from the template, plus the Telegram bot connect
   * link (when Telegram is set up) so the parent can tap to subscribe.
   */
  sendFollowupToParent(): void {
    const s = this.student();
    if (!s?.qrToken) return;
    let text = renderWhatsappTemplate(this.templatesSvc.get('FOLLOWUP_PARENT'), {
      studentName: this.studentName(),
      parentName: s.parentName || this.studentName(),
      academyName: this.authService.getCompanyName(),
      link: this.profileUrl(s.qrToken),
    });
    text = this.withTelegram(text, this.telegramParentUrl());
    if (!openWhatsappChat(s.parentPhone, text)) {
      this.notification.error(this.translate.instant('STUDENT_QR.NO_PARENT_PHONE'));
    }
  }

  private async render(token: string): Promise<void> {
    try {
      const url = this.profileUrl(token);
      const data = await QRCode.toDataURL(url, { width: 320, margin: 2 });
      this.dataUrl.set(data);
    } catch {
      this.dataUrl.set('');
    }
  }

  studentName(): string {
    const s = this.student();
    return s ? `${s.firstName} ${s.lastName}` : '';
  }

  download(): void {
    const s = this.student();
    const data = this.dataUrl();
    if (!data || !s) return;
    const a = document.createElement('a');
    a.href = data;
    a.download = `qr-${s.firstName}-${s.lastName}.png`.replace(/\s+/g, '_');
    a.click();
  }

  print(): void {
    const s = this.student();
    const data = this.dataUrl();
    if (!data || !s) return;
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(`
      <html>
        <head><title>QR - ${s.firstName} ${s.lastName}</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 32px;">
          <h2 style="margin: 0 0 4px;">${s.firstName} ${s.lastName}</h2>
          ${s.studentCode != null ? `<p style="margin: 0 0 12px; font-size: 18px; color: #4338ca;">${this.translate.instant('STUDENT_QR.CODE_LABEL')} <strong>#${s.studentCode}</strong></p>` : ''}
          <img src="${data}" style="width: 320px; height: 320px;" />
        </body>
      </html>
    `);
    w.document.close();
    w.focus();
    // Give the image a tick to load before printing.
    setTimeout(() => w.print(), 300);
  }

  regenerate(): void {
    const s = this.student();
    if (!s || this.regenerating()) return;
    this.regenerating.set(true);
    this.studentService.regenerateQr(s.id).subscribe({
      next: (updated) => {
        this.regenerating.set(false);
        this.regenerated.emit(updated);
        if (updated.qrToken) this.render(updated.qrToken);
        this.notification.success('QR code regenerated. The previous code no longer works.');
      },
      error: () => {
        this.regenerating.set(false);
      },
    });
  }
}
