import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SessionService, Session } from '../services/session.service';
import { AttendanceService, SessionAttendanceStudent } from '../services/attendance.service';
import { NotificationService } from '../../../core/services/notification.service';

/**
 * Full-page attendance editor for a single session, opened in a new tab from the
 * sessions dashboard ("expand"). The inline accordion on the dashboard is cramped
 * for large classes (100+ students); this page gives the full screen plus a
 * search box and bulk mark-all so a long roster is manageable. Attendance
 * auto-saves (debounced) exactly like the inline editor.
 */
@Component({
  selector: 'app-session-attendance',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, CardModule, ButtonModule, CheckboxModule, InputTextModule, TranslateModule],
  templateUrl: './session-attendance.component.html',
})
export class SessionAttendanceComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private sessionService = inject(SessionService);
  private attendanceService = inject(AttendanceService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);

  sessionId = '';
  session = signal<Session | null>(null);
  students = signal<SessionAttendanceStudent[]>([]);
  loading = signal(true);
  search = signal('');
  saveState = signal<'saving' | 'saved' | 'error' | undefined>(undefined);

  private saveTimer?: ReturnType<typeof setTimeout>;
  private savedClearTimer?: ReturnType<typeof setTimeout>;
  private readonly SAVE_DEBOUNCE_MS = 600;

  filteredStudents = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.students();
    if (!q) return list;
    return list.filter((s) =>
      `${s.studentFirstName} ${s.studentLastName}`.toLowerCase().includes(q),
    );
  });

  presentCount = computed(() => this.students().filter((s) => s.isPresent).length);
  absentCount = computed(() => this.students().filter((s) => !s.isPresent).length);

  ngOnInit() {
    this.sessionId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.sessionId) {
      this.loading.set(false);
      return;
    }
    this.sessionService.getById(this.sessionId).subscribe({
      next: (s) => this.session.set(s),
      error: () => {
        // Interceptor toasted the translated error; the roster still loads below.
      },
    });
    this.loadStudents();
  }

  loadStudents() {
    this.loading.set(true);
    this.attendanceService.getBySession(this.sessionId).subscribe({
      next: (students) => {
        this.students.set(students.map((s) => ({ ...s })));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  togglePresence(student: SessionAttendanceStudent, value: boolean) {
    this.students.update((list) =>
      list.map((s) => (s.studentId === student.studentId ? { ...s, isPresent: value } : s)),
    );
    this.scheduleSave();
  }

  /** Bulk-set every student currently matching the search filter. */
  markAllFiltered(present: boolean) {
    const ids = new Set(this.filteredStudents().map((s) => s.studentId));
    if (ids.size === 0) return;
    this.students.update((list) =>
      list.map((s) => (ids.has(s.studentId) ? { ...s, isPresent: present } : s)),
    );
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.savedClearTimer) {
      clearTimeout(this.savedClearTimer);
      this.savedClearTimer = undefined;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flushSave();
    }, this.SAVE_DEBOUNCE_MS);
  }

  private flushSave() {
    const presentIds = this.students().filter((s) => s.isPresent).map((s) => s.studentId);
    this.saveState.set('saving');
    this.attendanceService.saveForSession(this.sessionId, presentIds).subscribe({
      next: () => {
        this.saveState.set('saved');
        this.savedClearTimer = setTimeout(() => this.saveState.set(undefined), 2000);
      },
      error: () => this.saveState.set('error'),
    });
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
}
