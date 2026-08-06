import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
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
  private rawHandler: ((scanned: string) => void) | null = null;
  private looking = false;

  /** A page takes over scan handling for as long as it is mounted. */
  register(fn: (token: string) => void): void {
    this.handler = fn;
  }

  /** Release the handler (only if it's still the one this page registered). */
  unregister(fn: (token: string) => void): void {
    if (this.handler === fn) this.handler = null;
  }

  /**
   * Take the scan verbatim, before it is read as a student.
   *
   * Everything else here assumes a scan identifies a STUDENT — a barcode of a
   * printed code is looked up as a student code and turned into their token. But
   * a blank card being linked is nobody's yet: its barcode is a CARD number, and
   * that lookup can only fail (or, worse, land on the student whose own code
   * reads the same). A page doing that registers here instead and decides for
   * itself what it just read.
   */
  registerRaw(fn: (scanned: string) => void): void {
    this.rawHandler = fn;
  }

  unregisterRaw(fn: (scanned: string) => void): void {
    if (this.rawHandler === fn) this.rawHandler = null;
  }

  /**
   * Strip a scanned profile URL down to the raw QR token.
   *
   * Matches the `/p/s/` marker case-INSENSITIVELY and lower-cases the result. A
   * USB keyboard-wedge scanner set to upper case (a Caps-Lock/shift option, seen
   * on the ZKB201S) emits the URL as `HTTPS://APP.NETROFIT.COM/P/S/<TOKEN>`; the
   * old case-sensitive lowercase marker never matched `/P/S/`, so the WHOLE url
   * was sent to the API as the token (→ 400 / "incomplete"). Tokens are lower-case
   * hex and the DB match on qr_token is case-sensitive, so we normalise here too.
   */
  extractToken(text: string): string {
    const raw = (text || '').trim();
    const m = raw.match(/\/p\/s\/([^/?#]+)/i);
    return (m ? m[1] : raw).toLowerCase();
  }

  /**
   * A scanned value that is the student's PRINTED code rather than a QR token.
   *
   * A barcode carries the number printed on the card — "116", "A5", "05",
   * "A-100001" — where a QR carries the profile URL or its 32-char hex token.
   * The digit cap is what keeps them apart: printed codes never run past a card
   * serial's six digits, so a token that happens to be 'a' followed by digits
   * cannot be mistaken for one.
   */
  private looksLikePrintedCode(raw: string): boolean {
    return /^[Aa]?-?\d{1,8}$/.test(raw);
  }

  /**
   * Turn ANY scanned value into a QR token: a profile URL, a raw token, or a
   * BARCODE of the student's printed code.
   *
   * The app-wide USB capture goes through dispatch(), but a page running its own
   * camera decodes straight into its own handler — so this is what those pages
   * call to get the same barcode support without each of them re-deriving what a
   * printed code looks like.
   */
  resolveScan(scanned: string): Observable<string> {
    const raw = (scanned || '').trim();
    if (!raw) return of('');
    if (!this.looksLikePrintedCode(raw)) return of(this.extractToken(raw));
    return this.studentService.lookupByCode(raw).pipe(map(({ qrToken }) => qrToken));
  }

  /**
   * Route a scanned value to the active page's handler, else find the student.
   *
   * Takes a QR (URL or raw token) or a BARCODE of the student's printed code.
   * A code is resolved to that student's QR token first, so everything
   * downstream — every page handler, check-in, payment flow — keeps working on
   * a token and none of them had to learn about barcodes.
   *
   * `forceOpen` is set when the scan comes from the navbar's explicit QR-search
   * dialog: that's a deliberate "open this student" action, so it bypasses any
   * page-registered handler and always navigates (after taking attendance).
   */
  dispatch(decodedText: string, forceOpen = false): void {
    const raw = (decodedText || '').trim();
    if (!raw) return;

    // A page that wants the scan as scanned gets it first — see registerRaw.
    // The navbar's explicit "open this student" search still bypasses it.
    if (this.rawHandler && !forceOpen) {
      this.rawHandler(raw);
      return;
    }

    if (this.looksLikePrintedCode(raw)) {
      // One in-flight lookup at a time: a scanner can fire twice on one swipe.
      if (this.looking) return;
      this.looking = true;
      this.studentService.lookupByCode(raw).subscribe({
        next: ({ qrToken }) => {
          this.looking = false;
          if (qrToken) this.dispatchToken(qrToken, forceOpen);
          else this.notify.error(this.translate.instant('NAV.QR_STUDENT_NOT_FOUND'));
        },
        error: () => {
          this.looking = false;
          this.notify.error(this.translate.instant('NAV.QR_STUDENT_NOT_FOUND'));
        },
      });
      return;
    }

    this.dispatchToken(this.extractToken(raw), forceOpen);
  }

  /** The QR path, once whatever was scanned has become a token. */
  private dispatchToken(token: string, forceOpen: boolean): void {
    if (!token) return;
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
