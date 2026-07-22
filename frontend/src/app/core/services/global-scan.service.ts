import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { StudentService } from '../../features/students/services/student.service';
import { SessionService } from '../../features/rooms/services/session.service';
import { AttendanceService } from '../../features/rooms/services/attendance.service';
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
  private sessionService = inject(SessionService);
  private attendanceService = inject(AttendanceService);
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

  /**
   * Route a scanned value to the active page's handler, else find the student.
   *
   * `forceOpen` is set when the scan comes from the navbar's explicit QR-search
   * dialog: that's a deliberate "open this student" action, so it bypasses any
   * page-registered handler and always navigates (after taking attendance).
   */
  dispatch(decodedText: string, forceOpen = false): void {
    const token = this.extractToken(decodedText);
    if (!token) return;
    // Every QR token — student or pre-printed card — is 32 hex characters. Anything
    // else is a bad read, most often a keyboard-wedge burst that got split (a stall
    // between keystrokes, or focus landing in a field mid-scan) leaving us holding
    // the tail of the token. Sending that on produced "student not found", which
    // reads as "this card isn't linked" when in fact the card is fine. Say what
    // actually happened instead, and never spend a lookup on it.
    if (!/^[0-9a-f]{32}$/i.test(token)) {
      this.notify.warning(this.translate.instant('NAV.QR_SCAN_INCOMPLETE'));
      return;
    }
    if (this.handler && !forceOpen) {
      this.handler(token);
      return;
    }
    if (this.looking) return;
    this.looking = true;
    // Auto-open the detail page when the scan is an explicit navbar QR search
    // (forceOpen) or happens while ALREADY viewing a student's details — so
    // scanning there swaps to the new student. A scan from anywhere else just
    // takes attendance silently (no navigation).
    const navigateToDetail = forceOpen || this.isOnStudentDetail();
    this.studentService.lookupByQr(token).subscribe({
      next: (result) => {
        this.looking = false;
        // Take attendance first (if the student has an active or imminent
        // session), then open their detail page only when appropriate.
        this.takeAttendanceThenMaybeOpen(result.id, token, navigateToDetail);
      },
      error: () => {
        this.looking = false;
        this.notify.error(this.translate.instant('NAV.QR_STUDENT_NOT_FOUND'));
      },
    });
  }

  /** Is the current route a student-detail page (/students/:id)? */
  private isOnStudentDetail(): boolean {
    const url = this.router.url.split('?')[0].split('#')[0];
    const m = url.match(/^\/students\/([^/]+)$/);
    return !!m && m[1] !== 'create';
  }

  /**
   * If the scanned student has an active or imminent (≤30 min) session, check
   * them in and toast it. Then open their detail page only when `navigate` is
   * true (a scan made while already on a student-detail page). Attendance is
   * best-effort — any failure never blocks the (optional) navigation.
   */
  private takeAttendanceThenMaybeOpen(studentId: string, token: string, navigate: boolean): void {
    const open = () => { if (navigate) this.router.navigate(['/students', studentId]); };

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const localDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const localTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    this.sessionService.checkinTarget(studentId, localDate, localTime).subscribe({
      next: (target) => {
        if (!target) { open(); return; }
        this.attendanceService.checkinByQr(target.sessionId, token).subscribe({
          next: (res) => {
            const name = `${res.studentName}`;
            if (res.attendanceType === 'SUBSTITUTION') {
              this.notify.success(this.translate.instant('SESSION_QR.SUBSTITUTION_CHECKED_IN', { name, className: res.homeClassName }));
            } else if (res.attendanceType === 'TRIAL' && !res.alreadyPresent) {
              this.notify.success(this.translate.instant('SESSION_QR.TRIAL_CHECKED_IN', { name }));
            } else if (res.alreadyPresent) {
              this.notify.info(this.translate.instant('SESSION_QR.ALREADY_PRESENT', { name }));
            } else {
              this.notify.success(this.translate.instant('SESSION_QR.CHECKED_IN', { name }));
            }
            open();
          },
          error: () => open(), // interceptor toasts the server error; still open the page
        });
      },
      error: () => open(), // attendance is best-effort; never block opening the student
    });
  }
}
