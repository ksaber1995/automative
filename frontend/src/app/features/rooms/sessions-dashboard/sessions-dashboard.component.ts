import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { TabsModule } from 'primeng/tabs';
import { FormsModule } from '@angular/forms';
import { SessionService, Session } from '../services/session.service';
import { RoomService, Room } from '../services/room.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ClassService } from '../../courses/services/class.service';
import { BranchService } from '../../branches/services/branch.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-sessions-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TagModule,
    TableModule,
    DialogModule,
    SelectModule,
    TextareaModule,
    TooltipModule,
    TabsModule,
  ],
  template: `
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">Sessions</h1>
          <p class="text-gray-600 mt-1">Track room usage and manage active sessions</p>
        </div>
        <p-button label="Start Session" icon="pi pi-play" (onClick)="openStartDialog()"></p-button>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500 mb-1">Active Sessions</p>
          <p class="text-3xl font-bold text-indigo-600">{{ filteredActiveSessions().length }}</p>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500 mb-1">Occupied Rooms</p>
          <p class="text-3xl font-bold text-red-600">{{ filteredOccupiedRooms().length }}</p>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500 mb-1">Free Rooms</p>
          <p class="text-3xl font-bold text-green-600">{{ filteredFreeRooms().length }}</p>
        </div>
      </div>

      <!-- Branch Filter -->
      <div class="flex items-center gap-3 mb-6">
        <div class="flex items-center gap-2 flex-1 max-w-xs">
          <i class="pi pi-filter text-gray-400"></i>
          <p-select
            [options]="branches()"
            [ngModel]="selectedBranchId()"
            (ngModelChange)="selectedBranchId.set($event)"
            optionLabel="name"
            optionValue="id"
            appendTo="body"
            placeholder="All Branches"
            [showClear]="true"
            [style]="{ width: '100%' }"
          ></p-select>
        </div>
        @if (selectedBranchId()) {
          <p-button
            label="Clear Filter"
            icon="pi pi-times"
            severity="secondary"
            [outlined]="true"
            size="small"
            (onClick)="selectedBranchId.set(null)"
          ></p-button>
        }
      </div>

      <!-- Tabs -->
      <p-tabs [value]="activeTab" (valueChange)="activeTab = $event?.toString() ?? 'active'">
        <p-tablist>
          <p-tab value="active">
            <i class="pi pi-circle-fill text-green-500 mr-2"></i>
            Active Sessions
            @if (filteredActiveSessions().length > 0) {
              <span class="ml-2 bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">{{ filteredActiveSessions().length }}</span>
            }
          </p-tab>
          <p-tab value="rooms">
            <i class="pi pi-building mr-2"></i>
            Room Status
          </p-tab>
          <p-tab value="history">
            <i class="pi pi-history mr-2"></i>
            Session History
          </p-tab>
        </p-tablist>

        <p-tabpanels>
          <!-- Active Sessions Tab -->
          <p-tabpanel value="active">
            @if (loadingActive()) {
              <div class="text-center py-12 text-gray-400">
                <i class="pi pi-spin pi-spinner text-3xl mb-2"></i>
                <p>Loading active sessions...</p>
              </div>
            }
            @if (!loadingActive() && filteredActiveSessions().length === 0) {
              <div class="text-center py-12 text-gray-400">
                <i class="pi pi-check-circle text-5xl text-green-300 mb-3"></i>
                <p class="text-lg">No active sessions</p>
                <p class="text-sm">{{ selectedBranchId() ? 'No active sessions for this branch' : 'All rooms are currently free' }}</p>
              </div>
            }
            @if (!loadingActive() && filteredActiveSessions().length > 0) {
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                @for (session of filteredActiveSessions(); track session.id) {
                  <div class="bg-white border border-orange-200 rounded-xl p-5 shadow-sm">
                    <div class="flex items-start justify-between mb-3">
                      <div>
                        <div class="flex items-center gap-2 mb-1">
                          <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                          <span class="text-xs font-semibold text-green-700 uppercase tracking-wide">Live</span>
                        </div>
                        <h3 class="font-bold text-gray-900 text-lg">{{ session.className }}</h3>
                        <p class="text-sm text-gray-500">{{ session.courseName }}</p>
                      </div>
                      <div class="text-right">
                        <p class="text-xs text-gray-500">Room</p>
                        <p class="font-bold text-indigo-700 text-lg">{{ session.roomCode }}</p>
                      </div>
                    </div>
                    <div class="flex items-center justify-between text-sm text-gray-600 mb-4">
                      <span><i class="pi pi-clock mr-1"></i>Started {{ formatTime(session.startDate) }}</span>
                      <span class="text-orange-600 font-medium">{{ getDuration(session.startDate) }}</span>
                    </div>
                    <p-button
                      label="End Session"
                      icon="pi pi-stop"
                      severity="danger"
                      [outlined]="true"
                      size="small"
                      styleClass="w-full"
                      (onClick)="confirmEndSession(session)"
                    ></p-button>
                  </div>
                }
              </div>
            }
          </p-tabpanel>

          <!-- Room Status Tab -->
          <p-tabpanel value="rooms">
            @if (loadingRooms()) {
              <div class="text-center py-12 text-gray-400">
                <i class="pi pi-spin pi-spinner text-3xl mb-2"></i>
              </div>
            }
            @if (!loadingRooms()) {
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                @for (room of filteredRooms(); track room.id) {
                  <div [class]="room.isOccupied
                    ? 'bg-red-50 border border-red-200 rounded-xl p-4'
                    : 'bg-green-50 border border-green-200 rounded-xl p-4'">
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-2">
                        <i [class]="room.isOccupied ? 'pi pi-building text-red-600' : 'pi pi-building text-green-600'"></i>
                        <span class="font-bold text-gray-900">{{ room.code }}</span>
                      </div>
                      <p-tag
                        [value]="room.isOccupied ? 'Occupied' : 'Free'"
                        [severity]="room.isOccupied ? 'danger' : 'success'"
                      ></p-tag>
                    </div>
                    @if (room.branchName) {
                      <p class="text-xs text-gray-400 mb-1">{{ room.branchName }}</p>
                    }
                    @if (room.description) {
                      <p class="text-xs text-gray-500 mb-2">{{ room.description }}</p>
                    }
                    @if (room.activeSession) {
                      <p class="text-sm font-medium text-red-800">{{ room.activeSession.className }}</p>
                      <p class="text-xs text-red-600">Since {{ formatTime(room.activeSession.startDate) }}</p>
                    }
                    @if (!room.isOccupied) {
                      <p-button
                        label="Start Session"
                        icon="pi pi-play"
                        size="small"
                        styleClass="w-full mt-2"
                        (onClick)="openStartDialogForRoom(room)"
                      ></p-button>
                    }
                  </div>
                }
                @if (filteredRooms().length === 0) {
                  <div class="col-span-3 text-center py-12 text-gray-400">
                    <i class="pi pi-building text-5xl text-gray-300 mb-3"></i>
                    <p class="text-lg">No rooms found for this branch</p>
                  </div>
                }
              </div>
            }
          </p-tabpanel>

          <!-- History Tab -->
          <p-tabpanel value="history">
            <p-table
              [value]="filteredAllSessions()"
              [loading]="loadingHistory()"
              [paginator]="true"
              [rows]="15"
              responsiveLayout="scroll"
              styleClass="mt-4"
            >
              <ng-template pTemplate="header">
                <tr>
                  <th>Room</th>
                  <th>Class</th>
                  <th>Course</th>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>Duration</th>
                  <th>Status</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-session>
                <tr>
                  <td class="font-semibold text-indigo-700">{{ session.roomCode }}</td>
                  <td>{{ session.className }}</td>
                  <td class="text-sm text-gray-500">{{ session.courseName }}</td>
                  <td class="text-sm">{{ formatDateTime(session.startDate) }}</td>
                  <td class="text-sm">{{ session.endDate ? formatDateTime(session.endDate) : '—' }}</td>
                  <td class="text-sm">
                    @if (session.durationMinutes) {
                      {{ formatDuration(session.durationMinutes) }}
                    } @else if (!session.endDate) {
                      <span class="text-orange-600">{{ getDuration(session.startDate) }}</span>
                    } @else {
                      —
                    }
                  </td>
                  <td>
                    <p-tag
                      [value]="session.endDate ? 'Ended' : 'Active'"
                      [severity]="session.endDate ? 'secondary' : 'success'"
                    ></p-tag>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="7" class="text-center py-8 text-gray-400">No sessions found</td>
                </tr>
              </ng-template>
            </p-table>
          </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    </div>

    <!-- Start Session Dialog -->
    <p-dialog
      [(visible)]="showStartDialog"
      header="Start Session"
      [modal]="true"
      [style]="{ width: '480px' }"
    >
      <form [formGroup]="sessionForm" class="space-y-4 pt-2">

        <!-- Step 1: Branch -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Branch <span class="text-red-500">*</span></label>
          <p-select
            formControlName="branchId"
            [options]="branches()"
            optionLabel="name"
            optionValue="id"
            appendTo="body"
            placeholder="Select a branch"
            [style]="{ width: '100%' }"
            (onChange)="onDialogBranchChange()"
          ></p-select>
          @if (sessionForm.get('branchId')?.invalid && sessionForm.get('branchId')?.touched) {
            <small class="text-red-500">Branch is required</small>
          }
        </div>

        <!-- Step 2: Room (filtered by selected branch) -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Room <span class="text-red-500">*</span></label>
          <p-select
            formControlName="roomId"
            [options]="dialogFreeRooms()"
            optionLabel="code"
            optionValue="id"
            appendTo="body"
            placeholder="Select a free room"
            [disabled]="!sessionForm.get('branchId')?.value"
            [style]="{ width: '100%' }"
          ></p-select>
          @if (!sessionForm.get('branchId')?.value) {
            <small class="text-gray-400">Select a branch first</small>
          }
          @if (sessionForm.get('roomId')?.invalid && sessionForm.get('roomId')?.touched) {
            <small class="text-red-500">Room is required</small>
          }
          @if (sessionForm.get('branchId')?.value && dialogFreeRooms().length === 0) {
            <small class="text-orange-500">No free rooms available in this branch</small>
          }
        </div>

        <!-- Class (filtered by branch) -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Class <span class="text-red-500">*</span></label>
          <p-select
            formControlName="classId"
            [options]="dialogActiveClasses()"
            optionLabel="displayName"
            optionValue="id"
            appendTo="body"
            placeholder="Select a class"
            [disabled]="!sessionForm.get('branchId')?.value || loadingDialogClasses()"
            [style]="{ width: '100%' }"
          ></p-select>
          @if (!sessionForm.get('branchId')?.value) {
            <small class="text-gray-400">Select a branch first</small>
          }
          @if (loadingDialogClasses()) {
            <small class="text-gray-400"><i class="pi pi-spin pi-spinner mr-1"></i>Loading classes...</small>
          }
          @if (sessionForm.get('classId')?.invalid && sessionForm.get('classId')?.touched) {
            <small class="text-red-500">Class is required</small>
          }
          @if (sessionForm.get('branchId')?.value && !loadingDialogClasses() && dialogActiveClasses().length === 0) {
            <small class="text-orange-500">No active classes found for this branch</small>
          }
        </div>

        <!-- Notes -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea pTextarea formControlName="notes" rows="2" placeholder="Optional notes" class="w-full"></textarea>
        </div>
      </form>

      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="showStartDialog = false"></p-button>
        <p-button
          label="Start Session"
          icon="pi pi-play"
          [loading]="saving()"
          [disabled]="sessionForm.invalid"
          (onClick)="startSession()"
        ></p-button>
      </ng-template>
    </p-dialog>

    <!-- End Session Confirm Dialog -->
    <p-dialog
      [(visible)]="showEndDialog"
      header="End Session"
      [modal]="true"
      [style]="{ width: '400px' }"
    >
      <p class="text-gray-600 mb-3">
        End the session for <strong>{{ endingSession()?.className }}</strong> in room <strong>{{ endingSession()?.roomCode }}</strong>?
      </p>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
        <textarea pTextarea [(ngModel)]="endNotes" rows="2" placeholder="Any notes about this session" class="w-full"></textarea>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="showEndDialog = false"></p-button>
        <p-button label="End Session" severity="danger" [loading]="saving()" (onClick)="endSession()"></p-button>
      </ng-template>
    </p-dialog>
  `,
})
export class SessionsDashboardComponent implements OnInit {
  private sessionService = inject(SessionService);
  private roomService = inject(RoomService);
  private classService = inject(ClassService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private fb = inject(FormBuilder);

  activeSessions = signal<Session[]>([]);
  allSessions = signal<Session[]>([]);
  rooms = signal<Room[]>([]);
  branches = signal<Branch[]>([]);
  activeClasses = signal<any[]>([]);

  loadingActive = signal(true);
  loadingHistory = signal(true);
  loadingRooms = signal(true);
  saving = signal(false);

  activeTab = 'active';
  showStartDialog = false;
  showEndDialog = false;
  endNotes = '';
  endingSession = signal<Session | null>(null);

  /** Page-level branch filter (null = all branches) */
  selectedBranchId = signal<string | null>(null);

  sessionForm: FormGroup = this.fb.group({
    branchId: ['', Validators.required],
    roomId: ['', Validators.required],
    classId: ['', Validators.required],
    notes: [''],
  });

  // ── Page-level filtered rooms ──────────────────────────────────────────────

  filteredRooms = computed(() => {
    const all = this.rooms();
    const branchId = this.selectedBranchId();
    if (!branchId) return all;
    return all.filter(r => r.branchId === branchId);
  });

  filteredActiveSessions = computed(() => {
    const branchId = this.selectedBranchId();
    if (!branchId) return this.activeSessions();
    return this.activeSessions().filter(s => s.branchId === branchId);
  });

  filteredAllSessions = computed(() => {
    const branchId = this.selectedBranchId();
    if (!branchId) return this.allSessions();
    return this.allSessions().filter(s => s.branchId === branchId);
  });

  filteredOccupiedRooms = computed(() => this.filteredRooms().filter(r => r.isOccupied));
  filteredFreeRooms = computed(() => this.filteredRooms().filter(r => !r.isOccupied && r.isActive));

  // ── Dialog-level data (rooms + classes filtered by branch chosen inside the dialog) ───────
  // Uses plain signals updated explicitly because reactive form values are not signals.
  dialogFreeRooms = signal<Room[]>([]);
  dialogActiveClasses = signal<any[]>([]);
  loadingDialogClasses = signal(false);

  // Keep legacy helper used by openStartDialogForRoom
  freeRooms = computed(() => this.rooms().filter(r => !r.isOccupied && r.isActive));
  occupiedRooms = computed(() => this.rooms().filter(r => r.isOccupied));

  ngOnInit() {
    this.loadBranches();
    this.loadAll();
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (b) => this.branches.set(b),
    });
  }

  loadAll() {
    this.loadActiveSessions();
    this.loadRooms();
    this.loadHistory();
    this.loadClasses();
  }

  loadActiveSessions() {
    this.loadingActive.set(true);
    this.sessionService.listActive().subscribe({
      next: (s) => { this.activeSessions.set(s); this.loadingActive.set(false); },
      error: () => this.loadingActive.set(false),
    });
  }

  loadRooms() {
    this.loadingRooms.set(true);
    this.roomService.list().subscribe({
      next: (r) => { this.rooms.set(r); this.loadingRooms.set(false); },
      error: () => this.loadingRooms.set(false),
    });
  }

  loadHistory() {
    this.loadingHistory.set(true);
    this.sessionService.list().subscribe({
      next: (s) => { this.allSessions.set(s); this.loadingHistory.set(false); },
      error: () => this.loadingHistory.set(false),
    });
  }

  loadClasses() {
    this.classService.getActiveClasses().subscribe({
      next: (classes) => {
        this.activeClasses.set(classes.map((c: any) => ({
          ...c,
          displayName: `${c.name} (${c.code})`,
        })));
      },
      error: () => {},
    });
  }

  openStartDialog() {
    this.buildSessionForm();
    this.showStartDialog = true;
  }

  openStartDialogForRoom(room: Room) {
    this.buildSessionForm(room.id, room.branchId);
    this.showStartDialog = true;
  }

  buildSessionForm(roomId?: string, branchId?: string) {
    this.sessionForm = this.fb.group({
      branchId: [branchId || '', Validators.required],
      roomId: [roomId || '', Validators.required],
      classId: ['', Validators.required],
      notes: [''],
    });
  }

  /** When the branch changes inside the dialog, reset room + class and reload both for the branch */
  onDialogBranchChange() {
    this.sessionForm.patchValue({ roomId: '', classId: '' });
    const branchId = this.sessionForm.get('branchId')?.value;
    if (!branchId) {
      this.dialogFreeRooms.set([]);
      this.dialogActiveClasses.set([]);
      return;
    }
    // Rooms — filter from already-loaded list
    this.dialogFreeRooms.set(
      this.rooms().filter(r => r.branchId === branchId && !r.isOccupied && r.isActive)
    );
    // Classes — fetch from API filtered by branch
    this.loadingDialogClasses.set(true);
    this.classService.getClassesByBranch(branchId).subscribe({
      next: (classes) => {
        this.dialogActiveClasses.set(classes.map((c: any) => ({
          ...c,
          displayName: `${c.name} (${c.code})`,
        })));
        this.loadingDialogClasses.set(false);
      },
      error: () => this.loadingDialogClasses.set(false),
    });
  }

  startSession() {
    if (this.sessionForm.invalid) { this.sessionForm.markAllAsTouched(); return; }
    this.saving.set(true);
    const val = this.sessionForm.value;

    this.sessionService.start({
      roomId: val.roomId,
      classId: val.classId,
      branchId: val.branchId,
      notes: val.notes || undefined,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showStartDialog = false;
        this.notificationService.success('Session started successfully');
        this.loadAll();
      },
      error: (err) => {
        this.saving.set(false);
        this.notificationService.error(err?.error?.message || 'Failed to start session');
      },
    });
  }

  confirmEndSession(session: Session) {
    this.endingSession.set(session);
    this.endNotes = '';
    this.showEndDialog = true;
  }

  endSession() {
    const session = this.endingSession();
    if (!session) return;
    this.saving.set(true);
    this.sessionService.end(session.id, this.endNotes || undefined).subscribe({
      next: () => {
        this.saving.set(false);
        this.showEndDialog = false;
        this.endingSession.set(null);
        this.notificationService.success('Session ended successfully');
        this.loadAll();
      },
      error: (err) => {
        this.saving.set(false);
        this.notificationService.error(err?.error?.message || 'Failed to end session');
      },
    });
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatDateTime(dateStr: string): string {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  getDuration(startStr: string): string {
    const mins = Math.floor((Date.now() - new Date(startStr).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  formatDuration(mins: number): string {
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
}
