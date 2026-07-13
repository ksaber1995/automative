import { Component, inject, input, model, output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { TranslateModule } from '@ngx-translate/core';
import QRCode from 'qrcode';
import { firstValueFrom } from 'rxjs';
import { saveAs } from 'file-saver';
import { TranslateService } from '@ngx-translate/core';
import { StudentService } from '../services/student.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { CompanyService } from '../../../core/services/company.service';
import { WhatsappTemplatesService } from '../../../core/services/whatsapp-templates.service';
import { openWhatsappChat, renderWhatsappTemplate } from '../../../core/utils/whatsapp.util';
import { TelegramService } from '../../telegram/telegram.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { ClassService } from '../../courses/services/class.service';
import { CourseService } from '../../courses/services/course.service';
import { currentAcademicYear, renderStudentCardPng } from '../card-render.util';
import { EnrollmentStatus } from '@shared/enums/enrollment-status.enum';
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
  private companyService = inject(CompanyService);
  private translate = inject(TranslateService);
  private templatesSvc = inject(WhatsappTemplatesService);
  private telegramSvc = inject(TelegramService);
  private enrollmentService = inject(EnrollmentService);
  private classService = inject(ClassService);
  private courseService = inject(CourseService);

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
  /** Rendering the ID card — both card actions share it, so neither double-fires. */
  cardBusy = signal(false);

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

  /**
   * The student's ID-card front — the same card the bulk export produces, so a
   * card printed from here matches one printed from the student list. Returns raw
   * base64 PNG (no data-URL prefix), or null when the student has no QR token.
   *
   * A student can sit in several classes and the card names only one, so it goes
   * on the first ACTIVE enrolment (falling back to any enrolment). An unenrolled
   * student still gets a card, just with the course/class/level fields blank —
   * the same thing the bulk export files under "Uncategorized".
   */
  private async renderCard(): Promise<string | null> {
    const s = this.student();
    if (!s?.qrToken) return null;

    const [design, enrollments, classes, courses] = await Promise.all([
      firstValueFrom(this.companyService.getCardDesign()).catch(() => null),
      firstValueFrom(this.enrollmentService.getEnrollmentsByStudent(s.id)).catch(() => []),
      firstValueFrom(this.classService.getAllClasses()).catch(() => []),
      firstValueFrom(this.courseService.getAllCourses()).catch(() => []),
    ]);

    const enrollment = enrollments.find(e => e.status === EnrollmentStatus.ACTIVE) ?? enrollments[0];
    const cls = classes.find(c => c.id === enrollment?.classId);
    const course = courses.find(c => c.id === enrollment?.courseId);

    await document.fonts.ready;   // Arabic must shape before we rasterise
    return renderStudentCardPng({
      companyName: this.authService.getCompanyName(),
      name: this.studentName(),
      code: s.studentCode != null ? `#${s.studentCode}` : '',
      level: course?.levelName || '',
      group: cls?.name || '',
      year: currentAcademicYear(),
      subject: course?.name || '',
      qrUrl: this.profileUrl(s.qrToken),
    }, document.createElement('canvas'), design?.template);
  }

  async download(): Promise<void> {
    if (this.cardBusy()) return;
    this.cardBusy.set(true);
    try {
      const base64 = await this.renderCard();
      const s = this.student();
      if (!base64 || !s) return;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const name = `card-${s.firstName}-${s.lastName}.png`.replace(/\s+/g, '_');
      saveAs(new Blob([bytes], { type: 'image/png' }), name);
    } catch {
      this.notification.error(this.translate.instant('STUDENTS.LIST.QR_DOWNLOAD_ERROR'));
    } finally {
      this.cardBusy.set(false);
    }
  }

  async print(): Promise<void> {
    if (this.cardBusy()) return;
    this.cardBusy.set(true);
    try {
      const base64 = await this.renderCard();
      const s = this.student();
      if (!base64 || !s) return;
      const w = window.open('', '_blank', 'width=560,height=460');
      if (!w) return;
      // Sized to a real CR80 ID card so it comes off the printer ready to cut.
      w.document.write(`
        <html>
          <head>
            <title>${s.firstName} ${s.lastName}</title>
            <style>
              @page { margin: 12mm; }
              body { margin: 0; text-align: center; }
              img { width: 85.6mm; height: auto; }
            </style>
          </head>
          <body><img src="data:image/png;base64,${base64}" /></body>
        </html>
      `);
      w.document.close();
      w.focus();
      // Give the image a tick to load before printing.
      setTimeout(() => w.print(), 300);
    } catch {
      this.notification.error(this.translate.instant('STUDENTS.LIST.QR_DOWNLOAD_ERROR'));
    } finally {
      this.cardBusy.set(false);
    }
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
