import { Component, inject, input, model, output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { TranslateModule } from '@ngx-translate/core';
import QRCode from 'qrcode';
import { StudentService } from '../services/student.service';
import { NotificationService } from '../../../core/services/notification.service';
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

  /** Two-way bound visibility, driven by the parent. */
  visible = model<boolean>(false);
  /** The student whose QR is shown. */
  student = input<Student | null>(null);
  /** Emitted after a successful regenerate so the parent can refresh its copy. */
  regenerated = output<Student>();

  dataUrl = signal<string>('');
  regenerating = signal(false);

  constructor() {
    // Re-render the QR whenever the dialog opens or the token changes.
    effect(() => {
      const s = this.student();
      const open = this.visible();
      if (open && s?.qrToken) {
        this.render(s.qrToken);
      }
    });
  }

  private profileUrl(token: string): string {
    return `${window.location.origin}/p/s/${token}`;
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
