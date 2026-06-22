import { Component, inject, input, model, output, signal, computed, effect } from '@angular/core';
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
import { Student } from '@shared/interfaces/student.interface';

/** QR activation pricing (EGP) — mirrors QR_PLAN_PRICES on the backend. */
export const QR_PLAN_PRICES = { ONE_YEAR: 25, LIFELONG: 40 } as const;
type QrPlan = keyof typeof QR_PLAN_PRICES;

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

  /** Two-way bound visibility, driven by the parent. */
  visible = model<boolean>(false);
  /** The student whose QR is shown. */
  student = input<Student | null>(null);
  /** Emitted after a successful regenerate so the parent can refresh its copy. */
  regenerated = output<Student>();
  /** Emitted after a successful paid activation so the parent can refresh. */
  activated = output<Student>();

  dataUrl = signal<string>('');
  regenerating = signal(false);
  activating = signal(false);
  /** Plan awaiting confirmation in the inline warning step (null = none). */
  pendingPlan = signal<QrPlan | null>(null);

  readonly prices = QR_PLAN_PRICES;

  /** TEACHER companies pay per QR; academies get it free. */
  isTeacher = (): boolean => this.authService.isTeacher();

  /** Is the current student's QR paid-activated and not expired? */
  qrLive = computed<boolean>(() => {
    const s = this.student();
    if (!s?.qrActivated) return false;
    if (!s.qrExpiration) return true; // lifelong
    return new Date(s.qrExpiration) >= new Date(new Date().toISOString().slice(0, 10));
  });

  /** Show the QR itself only when free (academy) or paid-activated (teacher). */
  showQr = computed<boolean>(() => !this.isTeacher() || this.qrLive());

  constructor() {
    // Warm the click-to-chat templates so the send buttons have bodies ready.
    this.templatesSvc.load().subscribe({ error: () => {} });

    // Re-render the QR whenever the dialog opens or the token changes — but only
    // when the QR is actually usable (free, or paid-activated for teachers).
    effect(() => {
      const s = this.student();
      const open = this.visible();
      if (open && s?.qrToken && this.showQr()) {
        this.render(s.qrToken);
      }
    });
  }

  planPrice(plan: QrPlan): number {
    return QR_PLAN_PRICES[plan];
  }

  /** Step 1: user picks a plan → show the cost warning. */
  choosePlan(plan: QrPlan): void {
    if (this.activating()) return;
    this.pendingPlan.set(plan);
  }

  cancelPlan(): void {
    this.pendingPlan.set(null);
  }

  /** Step 2: user confirms the warning → bill + activate. */
  confirmActivate(): void {
    const s = this.student();
    const plan = this.pendingPlan();
    if (!s || !plan || this.activating()) return;
    this.activating.set(true);
    this.studentService.activateQr(s.id, plan).subscribe({
      next: (updated) => {
        this.activating.set(false);
        this.pendingPlan.set(null);
        this.activated.emit(updated);
        if (updated.qrToken) this.render(updated.qrToken);
      },
      error: () => {
        this.activating.set(false);
      },
    });
  }

  /** Friendly expiry label for the activated badge ('' = lifelong). */
  expiryLabel(): string {
    const exp = this.student()?.qrExpiration;
    if (!exp) return '';
    return new Date(exp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  private profileUrl(token: string): string {
    return `${window.location.origin}/p/s/${token}`;
  }

  /** Click-to-chat: open WhatsApp to the STUDENT with the QR/profile link. */
  sendQrToStudent(): void {
    const s = this.student();
    if (!s?.qrToken) return;
    const text = renderWhatsappTemplate(this.templatesSvc.get('QR_STUDENT'), {
      studentName: this.studentName(),
      academyName: this.authService.getCompanyName(),
      link: this.profileUrl(s.qrToken),
    });
    if (!openWhatsappChat(s.phone, text)) {
      this.notification.error(this.translate.instant('STUDENT_QR.NO_STUDENT_PHONE'));
    }
  }

  /** Click-to-chat: open WhatsApp to the PARENT with the follow-up link. */
  sendFollowupToParent(): void {
    const s = this.student();
    if (!s?.qrToken) return;
    const text = renderWhatsappTemplate(this.templatesSvc.get('FOLLOWUP_PARENT'), {
      studentName: this.studentName(),
      parentName: s.parentName || this.studentName(),
      academyName: this.authService.getCompanyName(),
      link: this.profileUrl(s.qrToken),
    });
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
