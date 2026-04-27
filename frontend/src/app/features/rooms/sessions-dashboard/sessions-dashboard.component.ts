import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { TabsModule } from 'primeng/tabs';
import { InputTextModule } from 'primeng/inputtext';
import { FormsModule } from '@angular/forms';
import { SessionService, Session } from '../services/session.service';
import { RoomService, Room } from '../services/room.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ClassService } from '../../courses/services/class.service';
import { BranchService } from '../../branches/services/branch.service';
import { Branch } from '@shared/interfaces/branch.interface';

/** Cross-field validator: endTime must not produce a datetime before startDate */
function endTimeAfterStartValidator(startDate: string) {
  return (control: AbstractControl): ValidationErrors | null => {
    const timeVal: string = control.value; // "HH:mm"
    if (!timeVal || !startDate) return null;

    const start = new Date(startDate);
    const [hours, minutes] = timeVal.split(':').map(Number);
    const end = new Date(start);
    end.setHours(hours, minutes, 0, 0);

    if (end < start) {
      return { endBeforeStart: true };
    }
    return null;
  };
}

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
    InputTextModule,
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

        <!-- Branch -->
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

        <!-- Room (filtered by selected branch) -->
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

        <!-- Class (filtered by branch — only classes with students, active sessions shown as disabled) -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Class <span class="text-red-500">*</span></label>
          <p-select
            formControlName="classId"
            [options]="dialogActiveClasses()"
            optionLabel="displayName"
            optionValue="id"
            optionDisabled="hasActiveSession"
            appendTo="body"
            placeholder="Select a class"
            [disabled]="!sessionForm.get('branchId')?.value || loadingDialogClasses()"
            [style]="{ width: '100%' }"
          >
            <ng-template pTemplate="item" let-cls>
              <div class="flex items-center justify-between w-full" [class.opacity-40]="cls.hasActiveSession">
                <span>{{ cls.displayName }}</span>
                <span class="flex items-center gap-1 ml-3 shrink-0">
                  <span class="text-xs text-gray-400">{{ cls.studentCount }} student{{ cls.studentCount !== 1 ? 's' : '' }}</span>
                  @if (cls.hasActiveSession) {
                    <span class="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium ml-1">
                      <i class="pi pi-circle-fill text-orange-500 mr-1" style="font-size:0.45rem"></i>In session
                    </span>
                  }
                </span>
              </div>
            </ng-template>
          </p-select>
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
            <small class="text-orange-500">No eligible classes — classes must have enrolled students</small>
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

    <!-- End Session Dialog -->
    <p-dialog
      [(visible)]="showEndDialog"
      header="End Session"
      [modal]="true"
      [style]="{ width: '440px' }"
      (onHide)="onEndDialogHide()"
    >
      @if (endingSession()) {
        <div class="pt-2 space-y-4">
          <!-- Session info -->
          <div class="bg-gray-50 rounded-lg p-3 text-sm text-gray-700">
            <p>Ending session for <strong>{{ endingSession()!.className }}</strong> in room <strong>{{ endingSession()!.roomCode }}</strong></p>
            <p class="text-gray-500 mt-1">
              <i class="pi pi-clock mr-1"></i>Started: {{ formatDateTime(endingSession()!.startDate) }}
            </p>
          </div>

          <form [formGroup]="endSessionForm" class="space-y-4">
            <!-- End Date (locked — always same as start date) -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                End Date
                <span class="ml-1 text-xs text-gray-400 font-normal">(same as start date)</span>
              </label>
              <input
                pInputText
                type="text"
                [value]="endDateDisplay()"
                [disabled]="true"
                class="w-full bg-gray-100 text-gray-500 cursor-not-allowed"
                style="width:100%"
              />
            </div>

            <!-- End Time (editable) -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                End Time <span class="text-red-500">*</span>
              </label>
              <input
                pInputText
                type="time"
                formControlName="endTime"
                class="w-full"
                style="width:100%"
              />
              @if (endSessionForm.get('endTime')?.errors?.['required'] && endSessionForm.get('endTime')?.touched) {
                <small class="text-red-500">End time is required</small>
              }
              @if (endSessionForm.get('endTime')?.errors?.['endBeforeStart']) {
                <small class="text-red-500">
                  End time cannot be before the session start time ({{ formatTime(endingSession()!.startDate) }})
                </small>
              }
            </div>

            <!-- Notes -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                pTextarea
                formControlName="notes"
                rows="2"
                placeholder="Any notes about this session"
                class="w-full"
              ></textarea>
            </div>
          </form>
        </div>
      }

      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="showEndDialog = false"></p-button>
        <p-button
          label="End Session"
          icon="pi pi-stop"
          severity="danger"
          [loading]="saving()"
          [disabled]="endSessionForm.invalid"
          (onClick)="endSession()"
        ></p-button>
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
  endingSession = signal<Session | null>(null);

  /** Page-level branch filter (null = all branches) */
  selectedBranchId = signal<string | null>(null);

  /** Start session form */
  sessionForm: FormGroup = this.fb.group({
    branchId: ['', Validators.required],
    roomId: ['', Validators.required],
    classId: ['', Validators.required],
    notes: [''],
  });

  /** End session form */
  endSessionForm: FormGroup = this.fb.group({
    endTime: ['', Validators.required],
    notes: [''],
  });

  /** Display-only date label for the locked end-date field */
  endDateDisplay = signal<string>('');

  // ── Page-level filtered rooms ──────────────────────────────────────────────

  filteredRooms = computed(() => {
    const all = this.rooms();
    const branchId = this.selectedBranchId();
    if (!branchId) return all;
    return all.filter((r: Room) => r.branchId === branchId);
  });

  filteredActiveSessions = computed(() => {
    const branchId = this.selectedBranchId();
    if (!branchId) return this.activeSessions();
    return this.activeSessions().filter((s: Session) => s.branchId === branchId);
  });

  filteredAllSessions = computed(() => {
    const branchId = this.selectedBranchId();
    if (!branchId) return this.allSessions();
    return this.allSessions().filter((s: Session) => s.branchId === branchId);
  });

  filteredOccupiedRooms = computed(() => this.filteredRooms().filter((r: Room) => r.isOccupied));
  filteredFreeRooms = computed(() => this.filteredRooms().filter((r: Room) => !r.isOccupied && r.isActive));

  // ── Dialog-level data ───────────────────────────────────────────────────────
  dialogFreeRooms = signal<Room[]>([]);
  /** Only classes with at least 1 enrolled student; active-session ones are marked disabled */
  dialogActiveClasses = signal<any[]>([]);
  loadingDialogClasses = signal(false);

  freeRooms = computed(() => this.rooms().filter((r: Room) => !r.isOccupied && r.isActive));
  occupiedRooms = computed(() => this.rooms().filter((r: Room) => r.isOccupied));

  ngOnInit() {
    this.loadBranches();
    this.loadAll();
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (b: Branch[]) => this.branches.set(b),
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
      next: (s: Session[]) => { this.activeSessions.set(s); this.loadingActive.set(false); },
      error: () => this.loadingActive.set(false),
    });
  }

  loadRooms() {
    this.loadingRooms.set(true);
    this.roomService.list().subscribe({
      next: (r: Room[]) => { this.rooms.set(r); this.loadingRooms.set(false); },
      error: () => this.loadingRooms.set(false),
    });
  }

  loadHistory() {
    this.loadingHistory.set(true);
    this.sessionService.list().subscribe({
      next: (s: Session[]) => { this.allSessions.set(s); this.loadingHistory.set(false); },
      error: () => this.loadingHistory.set(false),
    });
  }

  loadClasses() {
    this.classService.getActiveClasses().subscribe({
      next: (classes: any[]) => {
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
      this.rooms().filter((r: Room) => r.branchId === branchId && !r.isOccupied && r.isActive)
    );
    // Classes — fetch from API filtered by branch, then keep only those with students enrolled
    this.loadingDialogClasses.set(true);
    this.classService.getClassesByBranch(branchId).subscribe({
      next: (classes: any[]) => {
        this.dialogActiveClasses.set(
          classes
            .filter((c: any) => (c.studentCount ?? 0) > 0)   // only classes with enrolled students
            .map((c: any) => ({
              ...c,
              displayName: `${c.name} (${c.code})`,
              // hasActiveSession comes from backend; used by optionDisabled
            }))
        );
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
      error: (err: any) => {
        this.saving.set(false);
        this.notificationService.error(err?.error?.message || 'Failed to start session');
      },
    });
  }

  confirmEndSession(session: Session) {
    this.endingSession.set(session);

    // Default end time = current time (HH:mm)
    const now = new Date();
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Build the locked date display (same date as start date)
    const startDate = new Date(session.startDate);
    this.endDateDisplay.set(
      startDate.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
    );

    // Rebuild end session form with the validator bound to this session's startDate
    this.endSessionForm = this.fb.group({
      endTime: [defaultTime, [Validators.required, endTimeAfterStartValidator(session.startDate)]],
      notes: [''],
    });

    this.showEndDialog = true;
  }

  onEndDialogHide() {
    this.endingSession.set(null);
    this.endSessionForm.reset();
  }

  endSession() {
    if (this.endSessionForm.invalid) { this.endSessionForm.markAllAsTouched(); return; }

    const session = this.endingSession();
    if (!session) return;

    // Build the ISO end datetime: start date + chosen time
    const startDate = new Date(session.startDate);
    const [hours, minutes] = (this.endSessionForm.value.endTime as string).split(':').map(Number);
    const endDateTime = new Date(startDate);
    endDateTime.setHours(hours, minutes, 0, 0);

    this.saving.set(true);
    this.sessionService.end(
      session.id,
      this.endSessionForm.value.notes || undefined,
      endDateTime.toISOString(),
    ).subscribe({
      next: () => {
        this.saving.set(false);
        this.showEndDialog = false;
        this.endingSession.set(null);
        this.notificationService.success('Session ended successfully');
        this.loadAll();
      },
      error: (err: any) => {
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
