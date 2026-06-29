import { Injectable, inject } from '@angular/core';
import { SessionService } from '../../features/rooms/services/session.service';
import { AuthService } from './auth.service';

/**
 * Opt-in auto start/end of sessions on their scheduled times.
 *
 * The actual scheduling decision lives on the server (gated by the company's
 * `autoManageSessions` setting); this just nudges it on an interval. We poll
 * every 5 minutes — frequent enough that a class starts/ends close to its
 * scheduled time, infrequent enough to be negligible for performance. The
 * server call is idempotent and a cheap no-op when the setting is off, so it's
 * safe to run from every open tab without coordination.
 */
@Injectable({ providedIn: 'root' })
export class AutoSessionService {
  private sessionService = inject(SessionService);
  private auth = inject(AuthService);

  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly POLL_MS = 5 * 60 * 1000; // 5 minutes

  /** Begin polling (idempotent). Call once after the app boots. */
  start(): void {
    if (this.timer) return;
    // Kick once on boot so a class already in its window starts promptly, then
    // keep checking on the interval.
    this.tick();
    this.timer = setInterval(() => this.tick(), this.POLL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    // Only staff who can manage the academy may start/end sessions — skip the
    // call entirely for logged-out or read-only users (the server would 403).
    if (!this.auth.isAuthenticated() || !this.auth.canWrite('academy')) return;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const localDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const localTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    this.sessionService.autoSchedule(localDate, localTime).subscribe({
      // Errors are non-critical (and toasted by the interceptor if relevant).
      error: () => {},
    });
  }
}
