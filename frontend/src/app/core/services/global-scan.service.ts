import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { StudentService } from '../../features/students/services/student.service';
import { NotificationService } from './notification.service';

/**
 * App-wide handler for a scanned student QR (USB keyboard-wedge scanner, captured
 * globally by the layout). A feature page can take over scan handling while it's
 * active by calling `register()` (e.g. the monthly-subscriptions page runs its
 * pay flow, the session-attendance page checks the student in). When no page has
 * registered a handler, a scan falls back to "find student → open their detail".
 */
@Injectable({ providedIn: 'root' })
export class GlobalScanService {
  private router = inject(Router);
  private studentService = inject(StudentService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  private handler: ((token: string) => void) | null = null;
  private looking = false;

  /** A page takes over scan handling for as long as it is mounted. */
  register(fn: (token: string) => void): void {
    this.handler = fn;
  }

  /** Release the handler (only if it's still the one this page registered). */
  unregister(fn: (token: string) => void): void {
    if (this.handler === fn) this.handler = null;
  }

  /** Strip a scanned profile URL down to the raw QR token. */
  extractToken(text: string): string {
    const raw = (text || '').trim();
    const marker = '/p/s/';
    const idx = raw.indexOf(marker);
    if (idx >= 0) return raw.slice(idx + marker.length).split(/[/?#]/)[0];
    return raw;
  }

  /** Route a scanned value to the active page's handler, else find the student. */
  dispatch(decodedText: string): void {
    const token = this.extractToken(decodedText);
    if (!token) return;
    if (this.handler) {
      this.handler(token);
      return;
    }
    if (this.looking) return;
    this.looking = true;
    this.studentService.lookupByQr(token).subscribe({
      next: (result) => {
        this.looking = false;
        this.router.navigate(['/students', result.id]);
      },
      error: () => {
        this.looking = false;
        this.notify.error(this.translate.instant('NAV.QR_STUDENT_NOT_FOUND'));
      },
    });
  }
}
