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
  template: `
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="goBack()" pTooltip="Back to Classes"></p-button>
        <div class="flex-1">
          <div class="flex items-center gap-3">
            <h1 class="text-3xl font-bold text-gray-900">{{ classDetail()?.name || 'Class Details' }}</h1>
            @if (classDetail()) {
              <p-tag [value]="statusLabel(classDetail()!.status)" [severity]="statusTagSeverity(classDetail()!.status)"></p-tag>
            }
          </div>
          <p class="text-gray-500 mt-1">{{ classDetail()?.code }}</p>
        </div>
        @if (!isFinished()) {
          <p-button label="Add Student" icon="pi pi-user-plus" severity="secondary" [outlined]="true" (onClick)="addStudent()"></p-button>
          <p-button label="Finish Class" icon="pi pi-check-circle" severity="success" [loading]="finishing()" (onClick)="confirmFinishCourse()"></p-button>
        } @else {
          <div class="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg">
            <i class="pi pi-check-circle"></i>
            <span class="font-medium">Course finished{{ classDetail()?.finishedAt ? ' on ' + formatDate(classDetail()!.finishedAt!) : '' }}</span>
          </div>
        }
      </div>

      <p-confirmDialog></p-confirmDialog>

      @if (loadingClass()) {
        <div class="text-center py-16 text-gray-400">
          <i class="pi pi-spin pi-spinner text-4xl mb-3"></i>
          <p>Loading...</p>
        </div>
      }

      @if (!loadingClass() && classDetail()) {
        <!-- Class Info -->
        <p-card styleClass="mb-6">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Course</p>
              <p class="font-semibold">{{ classDetail()?.courseName || 'N/A' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Branch</p>
              <p class="font-semibold">{{ classDetail()?.branchName || 'N/A' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Instructor</p>
              <p class="font-semibold">{{ classDetail()?.instructorName || 'Not assigned' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Schedule</p>
              <p class="font-semibold text-sm">
                @if (classDetail()?.daysOfWeek) { {{ formatDays(classDetail()!.daysOfWeek!) }} }
                @if (classDetail()?.startTime) { <span class="text-gray-500">{{ classDetail()?.startTime }} - {{ classDetail()?.endTime }}</span> }
                @if (!classDetail()?.daysOfWeek && !classDetail()?.startTime) { N/A }
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Dates</p>
              <p class="font-semibold text-sm">{{ formatDate(classDetail()?.startDate) }} → {{ formatDate(classDetail()?.endDate) }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Enrollment</p>
              <p class="font-semibold">{{ classDetail()?.studentCount ?? classDetail()?.currentEnrollment ?? 0 }}
                @if (classDetail()?.maxStudents) { <span class="text-gray-400">/ {{ classDetail()?.maxStudents }}</span> }
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Status</p>
              @if (classDetail()) {
                <p-tag [value]="statusLabel(classDetail()!.status)" [severity]="statusTagSeverity(classDetail()!.status)"></p-tag>
              }
            </div>
          </div>
        </p-card>

        <!-- Tabs: Students + Sessions + Attendance -->
        <p-tabs [value]="activeTab" (valueChange)="onTabChange($event)">
          <p-tablist>
            <p-tab value="students">
              <i class="pi pi-users mr-2"></i>Students
            </p-tab>
            <p-tab value="sessions">
              <i class="pi pi-clock mr-2"></i>Sessions
              @if (activeSession()) {
                <span class="ml-2 w-2 h-2 bg-green-500 rounded-full inline-block animate-pulse"></span>
              }
            </p-tab>
            <p-tab value="attendance">
              <i class="pi pi-check-square mr-2"></i>Attendance
            </p-tab>
          </p-tablist>

          <p-tabpanels>
            <!-- Students Tab -->
            <p-tabpanel value="students">
              <div class="flex justify-end mb-3 mt-2">
                <p-button label="Add Student" icon="pi pi-user-plus" severity="secondary" [outlined]="true" [disabled]="isFinished()" (onClick)="addStudent()"></p-button>
              </div>
              @if (isFinished()) {
                <div class="bg-gray-50 border border-gray-200 text-gray-600 text-sm rounded-lg px-3 py-2 mb-3">
                  This class is finished — new enrollments are closed.
                </div>
              }
              <p-table
                [value]="enrollments()"
                [loading]="loadingEnrollments()"
                [paginator]="true"
                [rows]="10"
                responsiveLayout="scroll"
              >
                <ng-template pTemplate="header">
                  <tr>
                    <th>Student</th>
                    <th>Enrolled</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-row>
                  <tr>
                    <td class="font-medium">
                      <div>{{ row.studentFirstName }} {{ row.studentLastName }}</div>
                      @if (row.enrollmentType === 'MASTER') {
                        <div class="text-xs text-purple-600 font-normal mt-0.5">Bundle: {{ row.masterCourseName }}</div>
                      }
                    </td>
                    <td class="text-sm">{{ formatDate(row.enrollmentDate) }}</td>
                    <td>
                      <p-tag [value]="row.status" [severity]="statusSeverity(row.status)"></p-tag>
                    </td>
                    <td>
                      <p-button icon="pi pi-external-link" [rounded]="true" [text]="true" severity="info"
                        (onClick)="viewStudent(row.studentId)" pTooltip="View Student"></p-button>
                    </td>
                  </tr>
                </ng-template>
                <ng-template pTemplate="emptymessage">
                  <tr>
                    <td colspan="4" class="text-center py-8 text-gray-500">
                      <i class="pi pi-users text-4xl mb-3 block"></i>
                      No students enrolled
                    </td>
                  </tr>
                </ng-template>
              </p-table>
            </p-tabpanel>

            <!-- Sessions Tab -->
            <p-tabpanel value="sessions">
              <div class="mt-2">
                <!-- Active Session Banner -->
                @if (activeSession()) {
                  <div class="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-4 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <span class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
                      <div>
                        <p class="font-semibold text-orange-900">Active Session in Room {{ activeSession()?.roomCode }}</p>
                        <p class="text-sm text-orange-700">Started {{ formatDateTime(activeSession()!.startDate) }}</p>
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <p-button label="Take Attendance" icon="pi pi-check-square" severity="info" [outlined]="true" size="small"
                        (onClick)="openAttendanceDialog(activeSession()!)"></p-button>
                      <p-button label="End Session" icon="pi pi-stop" severity="danger" [outlined]="true" size="small"
                        (onClick)="confirmEndSession(activeSession()!)"></p-button>
                    </div>
                  </div>
                }

                <!-- Start Session Button -->
                @if (!activeSession() && !isFinished()) {
                  <div class="flex justify-end mb-3">
                    <p-button label="Start Session" icon="pi pi-play" size="small" (onClick)="openStartSessionDialog()"></p-button>
                  </div>
                }
                @if (isFinished()) {
                  <div class="bg-gray-50 border border-gray-200 text-gray-600 text-sm rounded-lg px-3 py-2 mb-3">
                    This class is finished — sessions cannot be started.
                  </div>
                }

                <!-- Sessions History Table -->
                <p-table
                  [value]="sessions()"
                  [loading]="loadingSessions()"
                  [paginator]="true"
                  [rows]="10"
                  responsiveLayout="scroll"
                >
                  <ng-template pTemplate="header">
                    <tr>
                      <th>Room</th>
                      <th>Started</th>
                      <th>Ended</th>
                      <th>Duration</th>
                      <th>Status</th>
                      <th>Attendance</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-s>
                    <tr>
                      <td class="font-semibold text-indigo-700">{{ s.roomCode }}</td>
                      <td class="text-sm">{{ formatDateTime(s.startDate) }}</td>
                      <td class="text-sm">{{ s.endDate ? formatDateTime(s.endDate) : '—' }}</td>
                      <td class="text-sm">
                        @if (s.durationMinutes) { {{ formatDuration(s.durationMinutes) }} }
                        @else if (!s.endDate) { <span class="text-orange-600">{{ getDuration(s.startDate) }}</span> }
                        @else { — }
                      </td>
                      <td>
                        <p-tag [value]="s.endDate ? 'Ended' : 'Active'" [severity]="s.endDate ? 'secondary' : 'success'"></p-tag>
                      </td>
                      <td>
                        <p-button icon="pi pi-check-square" [rounded]="true" [text]="true" severity="info"
                          (onClick)="openAttendanceDialog(s)" pTooltip="Manage Attendance"></p-button>
                      </td>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="emptymessage">
                    <tr>
                      <td colspan="6" class="text-center py-8 text-gray-400">No sessions recorded for this class</td>
                    </tr>
                  </ng-template>
                </p-table>
              </div>
            </p-tabpanel>

            <!-- Attendance Summary Tab -->
            <p-tabpanel value="attendance">
              <div class="mt-2">
                @if (loadingAttendance()) {
                  <div class="text-center py-12 text-gray-400">
                    <i class="pi pi-spin pi-spinner text-3xl mb-2"></i>
                    <p>Loading attendance...</p>
                  </div>
                } @else if (attendanceSummary().length === 0) {
                  <div class="text-center py-12 text-gray-400">
                    <i class="pi pi-check-square text-4xl mb-3 block"></i>
                    <p>No attendance records yet. Start a session and take attendance.</p>
                  </div>
                } @else {
                  <!-- Overall Stats -->
                  <div class="grid grid-cols-3 gap-4 mb-6">
                    <div class="bg-blue-50 rounded-xl p-4 text-center">
                      <p class="text-2xl font-bold text-blue-700">{{ attendanceSummary().length }}</p>
                      <p class="text-sm text-blue-600 mt-1">Total Sessions</p>
                    </div>
                    <div class="bg-green-50 rounded-xl p-4 text-center">
                      <p class="text-2xl font-bold text-green-700">{{ avgAttendanceRate() }}%</p>
                      <p class="text-sm text-green-600 mt-1">Avg Attendance Rate</p>
                    </div>
                    <div class="bg-gray-50 rounded-xl p-4 text-center">
                      <p class="text-2xl font-bold text-gray-700">{{ attendanceSummary()[0]?.totalStudents ?? 0 }}</p>
                      <p class="text-sm text-gray-600 mt-1">Enrolled Students</p>
                    </div>
                  </div>

                  <p-table [value]="attendanceSummary()" responsiveLayout="scroll">
                    <ng-template pTemplate="header">
                      <tr>
                        <th>Session Date</th>
                        <th>Room</th>
                        <th>Present</th>
                        <th>Absent</th>
                        <th>Rate</th>
                        <th>Actions</th>
                      </tr>
                    </ng-template>
                    <ng-template pTemplate="body" let-row>
                      <tr>
                        <td class="font-medium">{{ formatDate(row.sessionStartDate) }}</td>
                        <td class="text-gray-600">{{ row.roomCode || '—' }}</td>
                        <td>
                          <span class="inline-flex items-center gap-1 text-green-700 font-semibold">
                            <i class="pi pi-check-circle text-green-500"></i>
                            {{ row.presentCount }}
                          </span>
                        </td>
                        <td>
                          <span class="inline-flex items-center gap-1 text-red-600 font-semibold">
                            <i class="pi pi-times-circle text-red-400"></i>
                            {{ row.absentCount }}
                          </span>
                        </td>
                        <td>
                          <div class="flex items-center gap-2">
                            <div class="w-20 bg-gray-200 rounded-full h-2">
                              <div class="bg-green-500 h-2 rounded-full"
                                [style.width]="getRate(row) + '%'"></div>
                            </div>
                            <span class="text-sm font-medium">{{ getRate(row) }}%</span>
                          </div>
                        </td>
                        <td>
                          <p-button icon="pi pi-pencil" [rounded]="true" [text]="true" severity="info"
                            (onClick)="openAttendanceDialogById(row.sessionId)" pTooltip="Edit Attendance"></p-button>
                        </td>
                      </tr>
                    </ng-template>
                  </p-table>
                }
              </div>
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      }
    </div>

    <!-- Start Session Dialog -->
    <p-dialog [(visible)]="showStartSessionDialog" header="Start Session" [modal]="true" [style]="{ width: '420px' }">
      <div class="space-y-4 pt-2">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Room <span class="text-red-500">*</span></label>
          <p-select
            [(ngModel)]="selectedRoomId"
            [options]="freeRooms()"
            optionLabel="code"
            optionValue="id"
            placeholder="Select a free room"
            [style]="{ width: '100%' }"
          ></p-select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea pTextarea [(ngModel)]="sessionNotes" rows="2" placeholder="Optional notes" class="w-full"></textarea>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="showStartSessionDialog = false"></p-button>
        <p-button label="Start" icon="pi pi-play" [loading]="savingSession()" [disabled]="!selectedRoomId" (onClick)="startSession()"></p-button>
      </ng-template>
    </p-dialog>

    <!-- End Session Dialog -->
    <p-dialog [(visible)]="showEndSessionDialog" header="End Session" [modal]="true" [style]="{ width: '380px' }">
      <p class="text-gray-600 mb-3">End the session in room <strong>{{ endingSession()?.roomCode }}</strong>?</p>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
        <textarea pTextarea [(ngModel)]="endSessionNotes" rows="2" class="w-full"></textarea>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="showEndSessionDialog = false"></p-button>
        <p-button label="End Session" severity="danger" [loading]="savingSession()" (onClick)="endSession()"></p-button>
      </ng-template>
    </p-dialog>

    <!-- Attendance Dialog -->
    <p-dialog
      [(visible)]="showAttendanceDialog"
      [header]="'Attendance — ' + formatDateTime(attendanceSession()?.startDate || '')"
      [modal]="true"
      [style]="{ width: '520px' }"
      [closable]="true"
    >
      @if (loadingAttendanceStudents()) {
        <div class="text-center py-8 text-gray-400">
          <i class="pi pi-spin pi-spinner text-3xl mb-2"></i>
          <p>Loading students...</p>
        </div>
      } @else {
        <div class="mb-3 flex items-center justify-between">
          <span class="text-sm text-gray-500">{{ attendanceStudents().length }} students enrolled</span>
          <div class="flex gap-2">
            <p-button label="All Present" size="small" severity="success" [outlined]="true" (onClick)="markAll(true)"></p-button>
            <p-button label="All Absent" size="small" severity="danger" [outlined]="true" (onClick)="markAll(false)"></p-button>
          </div>
        </div>
        <div class="space-y-2 max-h-80 overflow-y-auto pr-1">
          @for (student of attendanceStudents(); track student.studentId) {
            <div class="flex items-center justify-between p-3 rounded-lg border"
              [class.border-green-200]="student.isPresent"
              [class.bg-green-50]="student.isPresent"
              [class.border-gray-200]="!student.isPresent"
              [class.bg-white]="!student.isPresent">
              <div class="flex items-center gap-3">
                <p-checkbox
                  [(ngModel)]="student.isPresent"
                  [binary]="true"
                  [inputId]="'att-' + student.studentId"
                ></p-checkbox>
                <label [for]="'att-' + student.studentId" class="cursor-pointer font-medium text-gray-800">
                  {{ student.studentFirstName }} {{ student.studentLastName }}
                </label>
              </div>
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full"
                [class.bg-green-100]="student.isPresent"
                [class.text-green-700]="student.isPresent"
                [class.bg-gray-100]="!student.isPresent"
                [class.text-gray-500]="!student.isPresent">
                {{ student.isPresent ? 'Present' : 'Absent' }}
              </span>
            </div>
          }
        </div>
        <div class="mt-3 pt-3 border-t flex items-center justify-between text-sm text-gray-500">
          <span>
            <span class="text-green-600 font-semibold">{{ presentCount() }} present</span>
            &nbsp;·&nbsp;
            <span class="text-red-500 font-semibold">{{ absentCount() }} absent</span>
          </span>
        </div>
      }
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="showAttendanceDialog = false"></p-button>
        <p-button label="Save Attendance" icon="pi pi-check" [loading]="savingAttendance()"
          [disabled]="loadingAttendanceStudents()" (onClick)="saveAttendance()"></p-button>
      </ng-template>
    </p-dialog>
  `
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
