import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
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
import { SessionService, Session } from '../../rooms/services/session.service';
import { RoomService, Room } from '../../rooms/services/room.service';
import { AttendanceService, SessionAttendanceStudent, ClassAttendanceSummary } from '../../rooms/services/attendance.service';
import { ClassWithDetails } from '@shared/interfaces/class.interface';

@Component({
  selector: 'app-class-detail',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    TableModule,
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
  ],
  providers: [ConfirmationService],
  templateUrl: './class-detail.component.html'
})
export class ClassDetailComponent implements OnInit {
  private classService = inject(ClassService);
  private sessionService = inject(SessionService);
  private roomService = inject(RoomService);
  private attendanceService = inject(AttendanceService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  classId = '';
  classDetail = signal<ClassWithDetails | null>(null);
  enrollments = signal<any[]>([]);
  sessions = signal<Session[]>([]);
  freeRooms = signal<Room[]>([]);
  loadingClass = signal(true);
  loadingEnrollments = signal(true);
  loadingSessions = signal(false);
  savingSession = signal(false);
  finishing = signal(false);

  isFinished = () => this.classDetail()?.status === 'DONE' || !!this.classDetail()?.isFinished;

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
      error: () => { this.notificationService.error('Failed to load class'); this.loadingClass.set(false); }
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

  onTabChange(val: string | number | undefined) {
    this.activeTab = val?.toString() ?? 'students';
    if (this.activeTab === 'sessions') this.loadSessions();
    if (this.activeTab === 'attendance') this.loadAttendanceSummary();
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
        this.notificationService.success('Session started');
        this.loadSessions();
      },
      error: (err) => {
        this.savingSession.set(false);
        this.notificationService.error(err?.error?.message || 'Failed to start session');
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
        this.notificationService.success('Session ended');
        this.loadSessions();
      },
      error: (err) => {
        this.savingSession.set(false);
        this.notificationService.error(err?.error?.message || 'Failed to end session');
      },
    });
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
        this.loadingAttendanceStudents.set(false);
        this.notificationService.error('Failed to load students');
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
        this.notificationService.success(`Attendance saved — ${res.presentCount} present`);
        // Refresh attendance summary if on that tab
        if (this.activeTab === 'attendance') this.loadAttendanceSummary();
      },
      error: (err) => {
        this.savingAttendance.set(false);
        this.notificationService.error(err?.error?.message || 'Failed to save attendance');
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

  confirmFinishCourse() {
    const cls = this.classDetail();
    if (!cls) return;
    this.confirmationService.confirm({
      header: 'Finish Class',
      message: `Mark "${cls.name}" as finished? Once finished, no new enrollments and no sessions can be started for this class. This cannot be undone here.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Finish Class',
      rejectLabel: 'Cancel',
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
        this.notificationService.success('Course marked as finished');
        const current = this.classDetail();
        this.classDetail.set(current ? { ...current, ...updated } : null);
      },
      error: (err) => {
        this.finishing.set(false);
        this.notificationService.error(err?.error?.message || 'Failed to finish class');
      },
    });
  }

  statusLabel(status?: string): string {
    switch (status) {
      case 'IN_PROGRESS': return 'In Progress';
      case 'SCHEDULED': return 'Scheduled';
      case 'DONE': return 'Done';
      default: return 'Unknown';
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

  formatDays(days: string): string {
    return days.split(',').map(d => d.trim().slice(0, 3)).join(', ');
  }

  formatDate(dateString?: string): string {
    if (!dateString) return 'N/A';
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
