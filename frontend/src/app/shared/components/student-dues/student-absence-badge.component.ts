import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SessionAttendanceStudent } from '../../../features/rooms/services/attendance.service';

/**
 * The absence strip under a student on an attendance roster. It carries TWO
 * numbers because they answer different questions:
 *
 *  - the unbroken run of missed sessions — have they stopped coming?
 *  - misses inside the session's own month, scattered or not — how much of this
 *    month did they actually attend?
 *
 * A student who skips every other week never builds a run, so the streak alone
 * leaves them looking fine. Renders nothing when both are zero: a roster of
 * "0 absences" rows would bury the students who need chasing.
 */
@Component({
  selector: 'app-student-absence-badge',
  standalone: true,
  imports: [CommonModule, TooltipModule, TranslateModule],
  template: `
    @if (streak > 0 || monthAbsences > 0) {
      <div class="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-red-700">
        <i class="pi pi-calendar-times text-xs"></i>
        @if (streak > 0) {
          <span class="text-[11px] font-semibold"
            [pTooltip]="'SESSIONS_DASHBOARD.ABSENCE_WARN_TOOLTIP' | translate: { count: streak }">
            {{ 'SESSION_ATTENDANCE.ABSENCE_STREAK' | translate: { count: streak } }}
          </span>
        }
        @if (streak > 0 && monthAbsences > 0) {
          <span class="text-red-300">·</span>
        }
        @if (monthAbsences > 0) {
          <span class="text-[11px]">
            {{ 'SESSION_ATTENDANCE.ABSENCE_MONTH' | translate: {
                count: monthAbsences,
                total: student?.monthSessions,
                month: monthName()
              } }}
          </span>
        }
      </div>
    }
  `,
})
export class StudentAbsenceBadgeComponent {
  private translate = inject(TranslateService);

  @Input() student?: SessionAttendanceStudent;
  /** The session's start date — the month the scattered count is scoped to.
   *  Falls back to today, which is the same month for a session running now. */
  @Input() sessionDate?: string | null;

  get streak(): number { return this.student?.absentStreak ?? 0; }
  get monthAbsences(): number { return this.student?.monthAbsences ?? 0; }

  monthName(): string {
    const d = this.sessionDate ? new Date(this.sessionDate) : new Date();
    return this.translate.instant('MONTHLY_SUBSCRIPTIONS.MONTHS.' + (d.getMonth() + 1));
  }
}
