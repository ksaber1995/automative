import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SessionService, PriorAbsenteesGroup } from '../services/session.service';
import { formatStudentCode } from '../../../core/utils/student-code.util';
import { esc, openPrintWindow, section, th } from '../../../core/utils/print-report.util';

/**
 * "Who missed last time" — the proactive follow-up list.
 *
 * One dialog, two callers: the open register asks about its own class
 * (sessionId scope), the sessions dashboard asks about every group with a
 * session today (date scope). Either way the answer is per class: the students
 * who were absent from that class's PREVIOUS session, with phones, ready to
 * print and work through before the lesson starts.
 */
@Component({
  selector: 'app-prior-absentees-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule, TranslateModule],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [modal]="true"
      [dismissableMask]="true"
      [style]="{ width: '46rem', maxWidth: '95vw' }"
      [header]="header()"
    >
      @if (loading()) {
        <div class="py-10 text-center text-gray-500">
          <i class="pi pi-spinner pi-spin text-2xl"></i>
        </div>
      } @else {
        @if (groups().length === 0) {
          <p class="text-gray-500 py-6 text-center">{{ 'PRIOR_ABSENTEES.NO_GROUPS' | translate }}</p>
        }
        @for (g of groups(); track g.classId) {
          <div class="mb-5 last:mb-0">
            <!-- Only the day view repeats the class name per group; the register
                 already says whose list this is in the dialog header. -->
            @if (isDayScope()) {
              <h3 class="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                {{ g.className }}
                @if (g.todaySessionNumber != null) {
                  <span class="text-xs font-semibold bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">
                    {{ 'PRIOR_ABSENTEES.TODAY_SESSION' | translate: { number: g.todaySessionNumber } }}
                  </span>
                }
              </h3>
            }
            @if (g.prevSession) {
              <p class="text-xs text-gray-500 mb-2">
                {{ 'PRIOR_ABSENTEES.PREV_SESSION' | translate: {
                     number: g.prevSession.sessionNumber ?? '—',
                     date: g.prevSession.date | date: 'mediumDate'
                   } }}
                · {{ 'PRIOR_ABSENTEES.COUNT' | translate: { count: g.students.length } }}
              </p>
              @if (g.students.length === 0) {
                <p class="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <i class="pi pi-check-circle me-1"></i>{{ 'PRIOR_ABSENTEES.ALL_PRESENT' | translate }}
                </p>
              } @else {
                <div class="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  @for (s of g.students; track s.id) {
                    <div class="flex items-center justify-between gap-3 px-3 py-2" [class.opacity-60]="s.madeUp">
                      <div class="min-w-0">
                        <div class="text-sm font-medium text-gray-800 truncate">
                          @if (s.studentCode != null) {
                            <span class="text-gray-400 me-1">{{ code(s.studentCode) }}</span>
                          }
                          {{ s.name }}
                          @if (s.madeUp) {
                            <span class="ms-1 text-xs font-semibold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                              {{ 'PRIOR_ABSENTEES.MADE_UP' | translate }}
                            </span>
                          }
                        </div>
                      </div>
                      <div class="text-xs text-gray-500 whitespace-nowrap text-end">
                        @if (s.phone) { <div dir="ltr">{{ s.phone }}</div> }
                        @if (s.parentPhone && s.parentPhone !== s.phone) { <div dir="ltr">{{ s.parentPhone }}</div> }
                      </div>
                    </div>
                  }
                </div>
              }
            } @else {
              <p class="text-sm text-gray-400">{{ 'PRIOR_ABSENTEES.NO_PREV' | translate }}</p>
            }
          </div>
        }
      }
      <ng-template pTemplate="footer">
        <p-button [label]="'PRIOR_ABSENTEES.PRINT' | translate" icon="pi pi-print"
          [disabled]="loading() || totalAbsent() === 0" (onClick)="print()"></p-button>
        <p-button [label]="'PRIOR_ABSENTEES.CLOSE' | translate" severity="secondary" [outlined]="true"
          (onClick)="visible.set(false)"></p-button>
      </ng-template>
    </p-dialog>
  `,
})
export class PriorAbsenteesDialogComponent {
  private sessionService = inject(SessionService);
  private translate = inject(TranslateService);

  code = formatStudentCode;

  visible = signal(false);
  loading = signal(false);
  groups = signal<PriorAbsenteesGroup[]>([]);
  private scope = signal<{ sessionId?: string; date?: string; branchId?: string }>({});

  isDayScope = computed(() => !!this.scope().date);
  totalAbsent = computed(() => this.groups().reduce((n, g) => n + g.students.length, 0));

  header = computed(() =>
    this.isDayScope()
      ? this.translate.instant('PRIOR_ABSENTEES.TITLE_DAY', { date: this.scope().date })
      : this.translate.instant('PRIOR_ABSENTEES.TITLE')
  );

  open(scope: { sessionId?: string; date?: string; branchId?: string }): void {
    this.scope.set(scope);
    this.groups.set([]);
    this.visible.set(true);
    this.loading.set(true);
    this.sessionService.priorAbsentees(scope).subscribe({
      next: (groups) => {
        this.groups.set(groups);
        this.loading.set(false);
      },
      error: () => this.loading.set(false), // interceptor toasted the error
    });
  }

  print(): void {
    const t = (k: string, p?: object) => this.translate.instant(k, p);
    const rtl = (this.translate.currentLang || 'en').startsWith('ar');
    const locale = rtl ? 'ar-EG' : 'en-US';
    const fmtDate = (d: string) => new Date(d).toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' });

    const head = th([
      [t('PRIOR_ABSENTEES.COL_CODE'), false],
      [t('PRIOR_ABSENTEES.COL_NAME'), false],
      [t('PRIOR_ABSENTEES.COL_PHONE'), true],
      [t('PRIOR_ABSENTEES.COL_PARENT_PHONE'), true],
      [t('PRIOR_ABSENTEES.COL_NOTES'), false],
    ]);

    // Groups with nobody to chase don't earn paper.
    const sections = this.groups()
      .filter((g) => g.prevSession && g.students.length > 0)
      .map((g) => {
        const rows = g.students.map((s) => `
          <tr>
            <td>${s.studentCode != null ? esc(this.code(s.studentCode)) : ''}</td>
            <td>${esc(s.name)}${s.madeUp ? ` <span class="sub">(${esc(t('PRIOR_ABSENTEES.MADE_UP'))})</span>` : ''}</td>
            <td class="num" dir="ltr">${esc(s.phone ?? '')}</td>
            <td class="num" dir="ltr">${esc(s.parentPhone && s.parentPhone !== s.phone ? s.parentPhone : '')}</td>
            <td style="width:22%"></td>
          </tr>`).join('');
        const title = `${g.className} — ${t('PRIOR_ABSENTEES.PREV_SESSION', {
          number: g.prevSession!.sessionNumber ?? '—',
          date: fmtDate(g.prevSession!.date),
        })} (${g.students.length})`;
        return section(title, head, rows, '');
      }).join('');

    const subtitle = this.isDayScope()
      ? this.scope().date
      : this.groups()[0]?.className ?? '';

    openPrintWindow({
      title: t('PRIOR_ABSENTEES.TITLE'),
      rtl,
      body: `
        <h1>${esc(t('PRIOR_ABSENTEES.TITLE'))}</h1>
        <div class="meta">${esc(subtitle ?? '')} · ${esc(new Date().toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }))}</div>
        ${sections || `<p class="empty">${esc(t('PRIOR_ABSENTEES.ALL_PRESENT'))}</p>`}`,
    });
  }
}
