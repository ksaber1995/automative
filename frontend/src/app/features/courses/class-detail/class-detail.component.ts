import { Component, OnInit, inject, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TabsModule } from 'primeng/tabs';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { FormsModule } from '@angular/forms';
import { ClassService } from '../services/class.service';
import { NotificationService } from '../../../core/services/notification.service';
import { SessionService, Session, FreeSessionSummary } from '../../rooms/services/session.service';
import { RoomService, Room } from '../../rooms/services/room.service';
import { AttendanceService, SessionAttendanceStudent, ClassAttendanceSummary } from '../../rooms/services/attendance.service';
import { SessionPayDialogComponent } from '../../session-payments/session-pay-dialog/session-pay-dialog.component';
import { ClassWithDetails } from '@shared/interfaces/class.interface';

@Component({
  selector: 'app-class-detail',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    CardModule,
    TableModule,
    InputTextModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    TabsModule,
    DialogModule,
    SelectModule,
    TextareaModule,
    CheckboxModule,
    ConfirmDialogModule,
    FormsModule,
    SessionPayDialogComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './class-detail.component.html'
})
export class ClassDetailComponent implements OnInit {
  @ViewChild(SessionPayDialogComponent) payDialog?: SessionPayDialogComponent;
  private classService = inject(ClassService);
  private sessionService = inject(SessionService);
  private roomService = inject(RoomService);
  private attendanceService = inject(AttendanceService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);

  classId = '';
  classDetail = signal<ClassWithDetails | null>(null);
  enrollments = signal<any[]>([]);
  // Free-text filter for the enrolled-students table (by student name).
  studentFilter = signal('');
  filteredEnrollments = computed(() => {
    const term = this.studentFilter().trim().toLowerCase();
    if (!term) return this.enrollments();
    return this.enrollments().filter(e =>
      `${e.studentName ?? ''}`.toLowerCase().includes(term)
    );
  });
  sessions = signal<Session[]>([]);
  freeRooms = signal<Room[]>([]);
  loadingClass = signal(true);
  loadingEnrollments = signal(true);
  loadingSessions = signal(false);
  savingSession = signal(false);
  finishing = signal(false);

  isFinished = () => this.classDetail()?.status === 'DONE' || !!this.classDetail()?.isFinished;

  /** studentCount is the enriched field; currentEnrollment is the older name. */
  enrolledCount = computed(() => {
    const c = this.classDetail() as any;
    return c?.studentCount ?? c?.currentEnrollment ?? 0;
  });

  /**
   * maxStudents is a plan, not a lock — an enrollment goes through on a full
   * class — so say it out loud rather than leaving "13 / 12" to be read as
   * ordinary. Same warning as the class list.
   */
  isOverCapacity = computed(() => {
    const max = this.classDetail()?.maxStudents;
    return !!max && this.enrolledCount() > max;
  });

  overCapacityBy = computed(() => this.enrolledCount() - (this.classDetail()?.maxStudents || 0));

  // Free (trial) sessions — how many were run for this class, and who turned up.
  freeSummary = signal<FreeSessionSummary | null>(null);
  loadingFreeSessions = signal(false);

  // Attendance
  attendanceSummary = signal<ClassAttendanceSummary[]>([]);
  loadingAttendance = signal(false);
  showAttendanceDialog = false;
  attendanceSession = signal<Session | null>(null);
  attendanceStudents = signal<SessionAttendanceStudent[]>([]);
  loadingAttendanceStudents = signal(false);
  savingAttendance = signal(false);

  activeTab = 'students';
  showStartSessionDialog = false;
  showEndSessionDialog = false;
  selectedRoomId = '';
  sessionNotes = '';
  endSessionNotes = '';
  endingSession = signal<Session | null>(null);
  /** Session currently being deleted — disables its row's button. */
  deletingSessionId = signal<string | null>(null);

  activeSession = () => this.sessions().find(s => !s.endDate) ?? null;
  presentCount = () => this.attendanceStudents().filter(s => s.isPresent).length;
  absentCount = () => this.attendanceStudents().filter(s => !s.isPresent).length;
  avgAttendanceRate = () => {
    const summaries = this.attendanceSummary();
    if (!summaries.length) return 0;
    const total = summaries.reduce((sum, s) => sum + (s.totalStudents > 0 ? (s.presentCount / s.totalStudents) * 100 : 0), 0);
    return Math.round(total / summaries.length);
  };

  ngOnInit() {
    this.classId = this.route.snapshot.paramMap.get('id') || '';
    if (this.classId) {
      this.loadClassDetail();
      this.loadEnrollments();
    }
  }

  loadClassDetail() {
    this.loadingClass.set(true);
    this.classService.getClassWithDetails(this.classId).subscribe({
      next: (cls) => { this.classDetail.set(cls); this.loadingClass.set(false); },
      error: () => {
        // Interceptor toasted the translated error.
        this.loadingClass.set(false);
      }
    });
  }

  loadEnrollments() {
    this.loadingEnrollments.set(true);
    this.classService.getClassEnrollments(this.classId).subscribe({
      next: (e) => { this.enrollments.set(e); this.loadingEnrollments.set(false); },
      error: () => this.loadingEnrollments.set(false)
    });
  }

  loadSessions() {
    this.loadingSessions.set(true);
    this.sessionService.list({ classId: this.classId }).subscribe({
      next: (s) => { this.sessions.set(s); this.loadingSessions.set(false); },
      error: () => this.loadingSessions.set(false),
    });
    const cls = this.classDetail();
    this.roomService.listActive(cls?.branchId ?? undefined).subscribe({
      next: (rooms) => this.freeRooms.set(rooms.filter(r => !r.isOccupied)),
      error: () => {},
    });
  }

  loadAttendanceSummary() {
    this.loadingAttendance.set(true);
    this.attendanceService.getByClass(this.classId).subscribe({
      next: (data) => { this.attendanceSummary.set(data); this.loadingAttendance.set(false); },
      error: () => this.loadingAttendance.set(false),
    });
  }

  loadFreeSessions() {
    this.loadingFreeSessions.set(true);
    this.sessionService.freeSummary(this.classId).subscribe({
      next: (data) => { this.freeSummary.set(data); this.loadingFreeSessions.set(false); },
      error: () => this.loadingFreeSessions.set(false),
    });
  }

  onTabChange(val: string | number | undefined) {
    this.activeTab = val?.toString() ?? 'students';
    if (this.activeTab === 'sessions') this.loadSessions();
    if (this.activeTab === 'attendance') this.loadAttendanceSummary();
    if (this.activeTab === 'free') this.loadFreeSessions();
  }

  openStartSessionDialog() {
    this.selectedRoomId = '';
    this.sessionNotes = '';
    this.showStartSessionDialog = true;
  }

  startSession() {
    if (!this.selectedRoomId) return;
    this.savingSession.set(true);
    const cls = this.classDetail();
    const room = this.freeRooms().find(r => r.id === this.selectedRoomId);
    this.sessionService.start({
      roomId: this.selectedRoomId,
      classId: this.classId,
      branchId: room?.branchId || cls?.branchId || '',
      notes: this.sessionNotes || undefined,
    }).subscribe({
      next: () => {
        this.savingSession.set(false);
        this.showStartSessionDialog = false;
        this.notificationService.success(this.translate.instant('CLASSES.DETAIL.SESSION_STARTED'));
        this.loadSessions();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.savingSession.set(false);
      },
    });
  }

  confirmEndSession(session: Session) {
    this.endingSession.set(session);
    this.endSessionNotes = '';
    this.showEndSessionDialog = true;
  }

  endSession() {
    const session = this.endingSession();
    if (!session) return;
    this.savingSession.set(true);
    this.sessionService.end(session.id, this.endSessionNotes || undefined).subscribe({
      next: () => {
        this.savingSession.set(false);
        this.showEndSessionDialog = false;
        this.notificationService.success(this.translate.instant('CLASSES.DETAIL.SESSION_ENDED_MSG'));
        this.loadSessions();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.savingSession.set(false);
      },
    });
  }

  /**
   * Deleting a session erases its attendance with it and cannot be undone, so
   * the confirmation names the date and says what is lost. The server refuses
   * if money was collected on it.
   */
  confirmDeleteSession(session: Session) {
    this.confirmationService.confirm({
      header: this.translate.instant('CLASSES.DETAIL.DELETE_SESSION_TITLE'),
      message: this.translate.instant('CLASSES.DETAIL.DELETE_SESSION_MSG', {
        date: this.formatDateTime(session.startDate),
      }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('CLASSES.DETAIL.DELETE_SESSION_ACCEPT'),
      rejectLabel: this.translate.instant('CLASSES.DETAIL.DELETE_SESSION_REJECT'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.deleteSession(session),
    });
  }

  private deleteSession(session: Session) {
    this.deletingSessionId.set(session.id);
    this.sessionService.remove(session.id).subscribe({
      next: () => {
        this.deletingSessionId.set(null);
        this.notificationService.success(this.translate.instant('CLASSES.DETAIL.SESSION_DELETED_MSG'));
        this.loadSessions();
        // The summary counts sessions, so it goes stale the moment one dies.
        if (this.attendanceSummary().length) this.loadAttendanceSummary();
        if (session.isFree && this.freeSummary()) this.loadFreeSessions();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.deletingSessionId.set(null);
      },
    });
  }

  /**
   * A schedule time as the clock is read: "23:00:00" -> "11:00 PM". The stored
   * value is a bare SQL time (HH:mm:ss), not an instant, so it is hung on
   * today's date purely to be formatted — the date part is never shown.
   * Mirrors the class LIST's formatter, which has always done this.
   */
  formatTime(time: string | null | undefined): string {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return time;
    const date = new Date();
    date.setHours(h, m, 0, 0);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  openAttendanceDialog(session: Session) {
    this.attendanceSession.set(session);
    this.showAttendanceDialog = true;
    this.loadingAttendanceStudents.set(true);
    this.attendanceService.getBySession(session.id).subscribe({
      next: (students) => {
        this.attendanceStudents.set(students.map(s => ({ ...s })));
        this.loadingAttendanceStudents.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loadingAttendanceStudents.set(false);
      },
    });
  }

  openAttendanceDialogById(sessionId: string) {
    const session = this.sessions().find(s => s.id === sessionId);
    if (session) {
      this.openAttendanceDialog(session);
    } else {
      // Load from summary — create a minimal session object
      const summary = this.attendanceSummary().find(s => s.sessionId === sessionId);
      if (summary) {
        const fakeSession = { id: sessionId, startDate: summary.sessionStartDate, endDate: summary.sessionEndDate, roomCode: summary.roomCode } as any;
        this.openAttendanceDialog(fakeSession);
      }
    }
  }

  markAll(present: boolean) {
    this.attendanceStudents.set(this.attendanceStudents().map(s => ({ ...s, isPresent: present })));
  }

  saveAttendance() {
    const session = this.attendanceSession();
    if (!session) return;
    this.savingAttendance.set(true);
    const presentIds = this.attendanceStudents().filter(s => s.isPresent).map(s => s.studentId);
    this.attendanceService.saveForSession(session.id, presentIds).subscribe({
      next: (res) => {
        this.savingAttendance.set(false);
        this.showAttendanceDialog = false;
        this.notificationService.success(this.translate.instant('CLASSES.DETAIL.ATTENDANCE_SAVED', { count: res.presentCount }));
        // Refresh attendance summary if on that tab
        if (this.activeTab === 'attendance') this.loadAttendanceSummary();
        // PER_SESSION courses: prompt to collect any newly-created dues.
        if (res.sessionCharges?.length) this.payDialog?.enqueue(res.sessionCharges);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.savingAttendance.set(false);
      },
    });
  }

  getRate(row: ClassAttendanceSummary): number {
    if (!row.totalStudents) return 0;
    return Math.round((row.presentCount / row.totalStudents) * 100);
  }

  addStudent() {
    const cls = this.classDetail();
    const params: any = { classId: this.classId };
    if (cls?.courseId) params['courseId'] = cls.courseId;
    if (cls?.branchId) params['branchId'] = cls.branchId;
    this.router.navigate(['/enrollments/create'], { queryParams: params });
  }

  viewStudent(studentId: string) {
    this.router.navigate(['/students', studentId]);
  }

  goBack() {
    this.router.navigate(['/classes']);
  }

  editClass() {
    const cls = this.classDetail();
    if (!cls?.courseId || !this.classId) return;
    // Tell the edit page we came from the class, so Cancel/Update return here.
    this.router.navigate(['/courses', cls.courseId, 'classes', this.classId, 'edit'], { queryParams: { from: 'class' } });
  }

  confirmFinishCourse() {
    const cls = this.classDetail();
    if (!cls) return;
    this.confirmationService.confirm({
      header: this.translate.instant('CLASSES.DETAIL.FINISH_CLASS_TITLE'),
      message: this.translate.instant('CLASSES.DETAIL.FINISH_CLASS_MSG', { name: cls.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('CLASSES.DETAIL.FINISH_CLASS'),
      rejectLabel: this.translate.instant('CLASSES.DETAIL.CANCEL'),
      acceptButtonStyleClass: 'p-button-success',
      accept: () => this.finishCourse(),
    });
  }

  finishCourse() {
    if (this.finishing()) return;
    this.finishing.set(true);
    this.classService.finishClass(this.classId).subscribe({
      next: (updated) => {
        this.finishing.set(false);
        this.notificationService.success(this.translate.instant('CLASSES.DETAIL.COURSE_MARKED_FINISHED'));
        const current = this.classDetail();
        this.classDetail.set(current ? { ...current, ...updated } : null);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.finishing.set(false);
      },
    });
  }

  statusLabel(status?: string): string {
    switch (status) {
      case 'IN_PROGRESS': return this.translate.instant('CLASSES.DETAIL.STATUS_IN_PROGRESS');
      case 'SCHEDULED': return this.translate.instant('CLASSES.DETAIL.STATUS_SCHEDULED');
      case 'DONE': return this.translate.instant('CLASSES.DETAIL.STATUS_DONE');
      default: return this.translate.instant('CLASSES.DETAIL.STATUS_UNKNOWN');
    }
  }

  statusTagSeverity(status?: string): 'success' | 'info' | 'secondary' | 'warn' {
    switch (status) {
      case 'IN_PROGRESS': return 'success';
      case 'SCHEDULED': return 'info';
      case 'DONE': return 'secondary';
      default: return 'warn';
    }
  }

  statusSeverity(status: string): 'success' | 'danger' | 'warn' | 'info' | 'secondary' {
    switch (status?.toUpperCase()) {
      case 'ACTIVE': return 'success';
      case 'COMPLETED': return 'info';
      case 'DROPPED': return 'danger';
      case 'PENDING': return 'warn';
      default: return 'secondary';
    }
  }

  enrollmentStatusLabel(status?: string): string {
    switch (status?.toUpperCase()) {
      case 'ACTIVE': return this.translate.instant('CLASSES.DETAIL.ENR_STATUS_ACTIVE');
      case 'COMPLETED': return this.translate.instant('CLASSES.DETAIL.ENR_STATUS_COMPLETED');
      case 'DROPPED': return this.translate.instant('CLASSES.DETAIL.ENR_STATUS_DROPPED');
      case 'PENDING': return this.translate.instant('CLASSES.DETAIL.ENR_STATUS_PENDING');
      default: return status || '';
    }
  }

  formatDays(days: string): string {
    return days.split(',').map(d => d.trim().slice(0, 3)).join(', ');
  }

  formatDate(dateString?: string): string {
    if (!dateString) return this.translate.instant('CLASSES.DETAIL.NOT_AVAILABLE');
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatDateTime(dateStr: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  getDuration(startStr: string): string {
    const mins = Math.floor((Date.now() - new Date(startStr).getTime()) / 60000);
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  formatDuration(mins: number): string {
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
}
