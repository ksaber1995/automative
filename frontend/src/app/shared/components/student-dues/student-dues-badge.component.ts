import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../pipes/amount.pipe';
import { StudentSessionDues } from '../../../features/rooms/services/attendance.service';
import { dueItemLabel } from './student-dues.util';

/**
 * The money strip under a student on an attendance roster: green when they are
 * clear, amber with the outstanding total and a Collect button when they are not.
 *
 * Renders NOTHING when `dues` is undefined. That is the case for a student the
 * dues endpoint cannot speak for — trial and substitution attendees, bundle
 * enrollees, held subscriptions — and a green "no dues" we have not verified is
 * worse than saying nothing at all.
 */
@Component({
  selector: 'app-student-dues-badge',
  standalone: true,
  imports: [CommonModule, ButtonModule, TranslateModule, AmountPipe],
  template: `
    @if (dues) {
      @if (dues.totalDue > 0.009) {
        <div class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5">
          <div class="flex items-center gap-2 text-amber-800">
            <i class="pi pi-exclamation-triangle text-xs"></i>
            <span class="text-xs font-semibold">{{ dues.totalDue | amount }}</span>
            <span class="text-[11px]">
              {{ 'SESSION_ATTENDANCE.DUES_ITEMS' | translate: { count: dues.items.length } }}
              @if (dues.items[0]; as item) {
                <span class="text-amber-600">· {{ label(item) }}</span>
              }
            </span>
          </div>
          <p-button
            [label]="'SESSION_ATTENDANCE.DUES_PAY' | translate"
            icon="pi pi-wallet"
            size="small"
            severity="warn"
            (onClick)="pay.emit()"
          ></p-button>
        </div>
      } @else {
        <div class="mt-2 flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-2.5 py-1.5 text-green-700">
          <i class="pi pi-check-circle text-xs"></i>
          <span class="text-[11px] font-semibold">{{ 'SESSION_ATTENDANCE.DUES_CLEAR' | translate }}</span>
        </div>
      }
    }
  `,
})
export class StudentDuesBadgeComponent {
  private translate = inject(TranslateService);

  /** Undefined means "not known", which is not the same as "owes nothing". */
  @Input() dues?: StudentSessionDues;

  /** Collect was clicked — the host opens the dues dialog for this student. */
  @Output() pay = new EventEmitter<void>();

  label = (item: Parameters<typeof dueItemLabel>[0]) => dueItemLabel(item, this.translate);
}
