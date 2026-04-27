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
import { FormsModule } from '@angular/forms';
import { ClassService } from '../services/class.service';
import { NotificationService } from '../../../core/services/notification.service';
import { SessionService, Session } from '../../rooms/services/session.service';
import { RoomService, Room } from '../../rooms/services/room.service';
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
    FormsModule,
  ],
  template: `
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="goBack()" pTooltip="Back to Classes"></p-button>
        <div class="flex-1">
          <h1 class="text-3xl font-bold text-gray-900">{{ classDetail()?.name || 'Class Details' }}</h1>
          <p class="text-gray-500 mt-1">{{ classDetail()?.code }}</p>
        </div>
        <p-button label="Add Student" icon="pi pi-user-plus" (onClick)="addStudent()"></p-button>
      </div>

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
              <p-tag [value]="classDetail()?.isActive ? 'Active' : 'Inactive'" [severity]="classDetail()?.isActive ? 'success' : 'danger'"></p-tag>
            </div>
          </div>
        </p-card>

        <!-- Tabs: Students + Sessions -->
        <p-tabs [value]="activeTab" (valueChange)="onTabChange($event)">
          <p-tablist>
            <p-tab value="students">
              <i class="pi pi-users mr-2"></i>Students
            </p-tab>
            <p-tab value="sessions" (click)="loadSessions()">
              <i class="pi pi-clock mr-2"></i>Sessions
              @if (activeSession()) {
                <span class="ml-2 w-2 h-2 bg-green-500 rounded-full inline-block animate-pulse"></span>
              }
            </p-tab>
          </p-tablist>

          <p-tabpanels>
            <!-- Students Tab -->
            <p-tabpanel value="students">
              <div class="flex justify-end mb-3 mt-2">
                <p-button label="Add Student" icon="pi pi-user-plus" severity="secondary" [outlined]="true" (onClick)="addStudent()"></p-button>
              </div>
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
                    <p-button label="End Session" icon="pi pi-stop" severity="danger" [outlined]="true" size="small"
                      (onClick)="confirmEndSession(activeSession()!)"></p-button>
                  </div>
                }

                <!-- Start Session Button -->
                @if (!activeSession()) {
                  <div class="flex justify-end mb-3">
                    <p-button label="Start Session" icon="pi pi-play" size="small" (onClick)="openStartSessionDialog()"></p-button>
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
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="emptymessage">
                    <tr>
                      <td colspan="5" class="text-center py-8 text-gray-400">No sessions recorded for this class</td>
                    </tr>
                  </ng-template>
                </p-table>
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
  `
})
export class ClassDetailComponent implements OnInit {
  private classService = inject(ClassService);
  private sessionService = inject(SessionService);
  private roomService = inject(RoomService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  classId = '';
  classDetail = signal<ClassWithDetails | null>(null);
  enrollments = signal<any[]>([]);
  sessions = signal<Session[]>([]);
  freeRooms = signal<Room[]>([]);
  loadingClass = signal(true);
  loadingEnrollments = signal(true);
  loadingSessions = signal(false);
  savingSession = signal(false);

  activeTab = 'students';
  showStartSessionDialog = false;
  showEndSessionDialog = false;
  selectedRoomId = '';
  sessionNotes = '';
  endSessionNotes = '';
  endingSession = signal<Session | null>(null);

  activeSession = () => this.sessions().find(s => !s.endDate) ?? null;

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
    // Load free rooms for starting a session
    const cls = this.classDetail();
    this.roomService.listActive(cls?.branchId ?? undefined).subscribe({
      next: (rooms) => this.freeRooms.set(rooms.filter(r => !r.isOccupied)),
      error: () => {},
    });
  }

  onTabChange(val: string | number | undefined) {
    this.activeTab = val?.toString() ?? 'students';
    if (this.activeTab === 'sessions') this.loadSessions();
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
