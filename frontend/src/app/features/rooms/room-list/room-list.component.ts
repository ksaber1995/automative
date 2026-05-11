import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RoomService, Room, CreateRoomDto, UpdateRoomDto } from '../services/room.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-room-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TagModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    SelectModule,
    CheckboxModule,
    TooltipModule,
    TranslateModule,
  ],
  template: `
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">{{ 'ROOMS.TITLE' | translate }}</h1>
          <p class="text-gray-600 mt-1">{{ 'ROOMS.SUBTITLE' | translate }}</p>
        </div>
        <p-button [label]="'ROOMS.ADD' | translate" icon="pi pi-plus" (onClick)="openCreateDialog()"></p-button>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500 mb-1">{{ 'ROOMS.STATS_TOTAL' | translate }}</p>
          <p class="text-3xl font-bold text-gray-900">{{ filteredRooms().length }}</p>
        </div>
        <div class="bg-white rounded-xl border border-red-100 p-5">
          <p class="text-sm text-gray-500 mb-1">{{ 'ROOMS.STATS_OCCUPIED' | translate }}</p>
          <p class="text-3xl font-bold text-red-600">{{ occupiedCount() }}</p>
        </div>
        <div class="bg-white rounded-xl border border-green-100 p-5">
          <p class="text-sm text-gray-500 mb-1">{{ 'ROOMS.STATS_AVAILABLE' | translate }}</p>
          <p class="text-3xl font-bold text-green-600">{{ freeCount() }}</p>
        </div>
      </div>

      <!-- Branch Filter -->
      <div class="flex items-center gap-3 mb-6">
        <div class="flex items-center gap-2 flex-1 max-w-xs">
          <i class="pi pi-filter text-gray-400"></i>
          <p-select
            [options]="branchFilterOptions()"
            [ngModel]="selectedBranchId()" (ngModelChange)="selectedBranchId.set($event)"
            optionLabel="name"
            optionValue="id"
            appendTo="body"
            [placeholder]="'ROOMS.ALL_BRANCHES' | translate"
            [showClear]="true"
            [style]="{ width: '100%' }"
            (onChange)="onBranchFilterChange()"
          ></p-select>
        </div>
        @if (selectedBranchId() !== null) {
          <p-button
            [label]="'ROOMS.CLEAR_FILTER' | translate"
            icon="pi pi-times"
            severity="secondary"
            [outlined]="true"
            size="small"
            (onClick)="clearBranchFilter()"
          ></p-button>
        }
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="text-center py-16 text-gray-400">
          <i class="pi pi-spin pi-spinner text-4xl mb-3"></i>
          <p>{{ 'ROOMS.LOADING' | translate }}</p>
        </div>
      }

      <!-- Empty -->
      @if (!loading() && filteredRooms().length === 0) {
        <div class="text-center py-16 bg-white rounded-xl border border-gray-200">
          <i class="pi pi-building text-5xl text-gray-300 mb-4"></i>
          @if (selectedBranchId() !== null) {
            <p class="text-gray-500 text-lg">{{ 'ROOMS.EMPTY_BRANCH' | translate }}</p>
            <p class="text-gray-400 text-sm mb-4">{{ 'ROOMS.EMPTY_BRANCH_HINT' | translate }}</p>
            <p-button [label]="'ROOMS.CLEAR_FILTER' | translate" icon="pi pi-times" severity="secondary" [outlined]="true" (onClick)="clearBranchFilter()"></p-button>
          } @else {
            <p class="text-gray-500 text-lg">{{ 'ROOMS.EMPTY' | translate }}</p>
            <p class="text-gray-400 text-sm mb-4">{{ 'ROOMS.EMPTY_HINT' | translate }}</p>
            <p-button [label]="'ROOMS.ADD' | translate" icon="pi pi-plus" (onClick)="openCreateDialog()"></p-button>
          }
        </div>
      }

      <!-- Rooms Grid -->
      @if (!loading() && filteredRooms().length > 0) {
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (room of filteredRooms(); track room.id) {
            <div class="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <!-- Room Header -->
              <div class="flex items-start justify-between mb-3">
                <div class="flex items-center gap-3">
                  <div [class]="room.isOccupied
                    ? 'w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center'
                    : 'w-11 h-11 rounded-xl bg-green-100 flex items-center justify-center'">
                    <i [class]="room.isOccupied ? 'pi pi-building text-red-600 text-lg' : 'pi pi-building text-green-600 text-lg'"></i>
                  </div>
                  <div>
                    <h3 class="font-bold text-gray-900 text-lg">{{ room.code }}</h3>
                    <p class="text-xs text-gray-500">{{ room.branchName }}</p>
                  </div>
                </div>
                <p-tag
                  [value]="(room.isOccupied ? 'ROOMS.TAG_OCCUPIED' : 'ROOMS.TAG_FREE') | translate"
                  [severity]="room.isOccupied ? 'danger' : 'success'"
                ></p-tag>
              </div>

              <!-- Description -->
              @if (room.description) {
                <p class="text-sm text-gray-600 mb-3">{{ room.description }}</p>
              }

              <!-- Active Session Info -->
              @if (room.activeSession) {
                <div class="bg-orange-50 border border-orange-100 rounded-lg p-3 mb-3">
                  <p class="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-1">{{ 'ROOMS.ACTIVE_SESSION' | translate }}</p>
                  <p class="text-sm font-bold text-orange-900">{{ room.activeSession.className }}</p>
                  <p class="text-xs text-orange-600 mt-0.5">
                    <i class="pi pi-clock mr-1"></i>
                    {{ 'ROOMS.STARTED_AT' | translate: { time: formatTime(room.activeSession.startDate) } }}
                  </p>
                </div>
              }

              <!-- Inactive badge -->
              @if (!room.isActive) {
                <div class="bg-red-50 border border-red-200 rounded-lg p-2 mb-3 text-center">
                  <span class="text-xs font-semibold text-red-600 uppercase tracking-wide">{{ 'ROOMS.INACTIVE' | translate }}</span>
                </div>
              }

              <!-- Actions -->
              <div class="flex gap-2 pt-3 border-t border-gray-100">
                <p-button
                  [label]="'ROOMS.EDIT' | translate"
                  icon="pi pi-pencil"
                  severity="secondary"
                  [outlined]="true"
                  size="small"
                  styleClass="flex-1"
                  (onClick)="openEditDialog(room)"
                ></p-button>
                <p-button
                  icon="pi pi-trash"
                  severity="danger"
                  [outlined]="true"
                  size="small"
                  (onClick)="confirmDelete(room)"
                  [pTooltip]="'ROOMS.DELETE_TOOLTIP' | translate"
                ></p-button>
              </div>
            </div>
          }
        </div>
      }
    </div>

    <!-- Create/Edit Dialog -->
    <p-dialog
      [(visible)]="showDialog"
      [header]="(editingRoom() ? 'ROOMS.DIALOG_EDIT' : 'ROOMS.DIALOG_ADD') | translate"
      [modal]="true"
      [style]="{ width: '480px' }"
      [closable]="true"
    >
      <form [formGroup]="roomForm" (ngSubmit)="saveRoom()" class="space-y-4 pt-2">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'ROOMS.FIELD_CODE' | translate }} <span class="text-red-500">*</span></label>
          <input pInputText formControlName="code" [placeholder]="'ROOMS.FIELD_CODE_PLACEHOLDER' | translate" class="w-full"
                 [class.border-red-500]="roomForm.get('code')?.invalid && roomForm.get('code')?.touched"/>
          @if (roomForm.get('code')?.invalid && roomForm.get('code')?.touched) {
            <small class="text-red-500">{{ 'ROOMS.FIELD_CODE_REQUIRED' | translate }}</small>
          }
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'ROOMS.FIELD_DESCRIPTION' | translate }}</label>
          <textarea pTextarea formControlName="description" rows="2" [placeholder]="'ROOMS.FIELD_DESCRIPTION_PLACEHOLDER' | translate" class="w-full"></textarea>
        </div>

        @if (!editingRoom()) {
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'ROOMS.FIELD_BRANCH' | translate }} <span class="text-red-500">*</span></label>
            <p-select
              formControlName="branchId"
              [options]="branches()"
              optionLabel="name"
              optionValue="id"
              appendTo="body"
              [placeholder]="'ROOMS.FIELD_BRANCH_PLACEHOLDER' | translate"
              [style]="{ width: '100%' }"
            ></p-select>
            @if (roomForm.get('branchId')?.invalid && roomForm.get('branchId')?.touched) {
              <small class="text-red-500">{{ 'ROOMS.FIELD_BRANCH_REQUIRED' | translate }}</small>
            }
          </div>
        }

        @if (editingRoom()) {
          <div class="flex items-center gap-2">
            <p-checkbox formControlName="isActive" [binary]="true" inputId="isActive"></p-checkbox>
            <label for="isActive" class="text-sm text-gray-700 cursor-pointer">{{ 'ROOMS.FIELD_ACTIVE' | translate }}</label>
          </div>
        }
      </form>

      <ng-template pTemplate="footer">
        <p-button [label]="'ROOMS.CANCEL' | translate" severity="secondary" [outlined]="true" (onClick)="closeDialog()"></p-button>
        <p-button
          [label]="(editingRoom() ? 'ROOMS.UPDATE' : 'ROOMS.CREATE') | translate"
          [loading]="saving()"
          [disabled]="roomForm.invalid"
          (onClick)="saveRoom()"
        ></p-button>
      </ng-template>
    </p-dialog>

    <!-- Delete Confirm Dialog -->
    <p-dialog
      [(visible)]="showDeleteDialog"
      [header]="'ROOMS.DELETE_TITLE' | translate"
      [modal]="true"
      [style]="{ width: '400px' }"
    >
      <p class="text-gray-600" [innerHTML]="'ROOMS.DELETE_CONFIRM' | translate: { code: deletingRoom()?.code }"></p>
      <ng-template pTemplate="footer">
        <p-button [label]="'ROOMS.CANCEL' | translate" severity="secondary" [outlined]="true" (onClick)="showDeleteDialog = false"></p-button>
        <p-button [label]="'ROOMS.DELETE' | translate" severity="danger" [loading]="saving()" (onClick)="deleteRoom()"></p-button>
      </ng-template>
    </p-dialog>
  `,
})
export class RoomListComponent implements OnInit {
  private roomService = inject(RoomService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private fb = inject(FormBuilder);

  rooms = signal<Room[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  saving = signal(false);
  editingRoom = signal<Room | null>(null);
  deletingRoom = signal<Room | null>(null);

  /** Currently selected branch id for filtering (null = show all) */
  selectedBranchId = signal<string | null>(null);

  showDialog = false;
  showDeleteDialog = false;
  roomForm: FormGroup = this.fb.group({
      code: ['', Validators.required],
      description: [''],
      branchId: ['', Validators.required],
    });;

  /** Branches list prefixed with an "All Branches" option for the filter dropdown */
  branchFilterOptions = computed(() => this.branches());

  /** Rooms filtered by the selected branch */
  filteredRooms = computed(() => {
    const all = this.rooms();
    const branchId = this.selectedBranchId();
    if (!branchId) return all;
    return all.filter(r => r.branchId === branchId);
  });

  occupiedCount = computed(() => this.filteredRooms().filter(r => r.isOccupied).length);
  freeCount = computed(() => this.filteredRooms().filter(r => !r.isOccupied && r.isActive).length);

  ngOnInit() {
    this.loadBranches();
    this.loadRooms();
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (b) => this.branches.set(b),
    });
  }

  loadRooms() {
    this.loading.set(true);
    this.roomService.list().subscribe({
      next: (rooms) => { this.rooms.set(rooms); this.loading.set(false); },
      error: () => { this.notificationService.error('Failed to load rooms'); this.loading.set(false); },
    });
  }

  onBranchFilterChange() {
    // Signal-based computed will re-evaluate automatically;
    // this handler exists for any future side-effects.
  }

  clearBranchFilter() {
    this.selectedBranchId.set(null);
  }

  openCreateDialog() {
    this.editingRoom.set(null);
    this.roomForm = this.fb.group({
      code: ['', Validators.required],
      description: [''],
      branchId: ['', Validators.required],
    });
    this.showDialog = true;
  }

  openEditDialog(room: Room) {
    this.editingRoom.set(room);
    this.roomForm = this.fb.group({
      code: [room.code, Validators.required],
      description: [room.description || ''],
      isActive: [room.isActive],
    });
    this.showDialog = true;
  }

  closeDialog() {
    this.showDialog = false;
    this.editingRoom.set(null);
  }

  saveRoom() {
    if (this.roomForm.invalid) { this.roomForm.markAllAsTouched(); return; }
    this.saving.set(true);
    const val = this.roomForm.value;
    const editing = this.editingRoom();

    if (editing) {
      const dto: UpdateRoomDto = { code: val.code, isActive: val.isActive };
      if (val.description !== undefined) dto.description = val.description || undefined;
      this.roomService.update(editing.id, dto).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeDialog();
          this.loadRooms();
          this.notificationService.success('Room updated successfully');
        },
        error: (err) => {
          this.saving.set(false);
          this.notificationService.error(err?.error?.message || 'Failed to update room');
        },
      });
    } else {
      const dto: CreateRoomDto = { branchId: val.branchId, code: val.code };
      if (val.description) dto.description = val.description;
      this.roomService.create(dto).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeDialog();
          this.loadRooms();
          this.notificationService.success('Room created successfully');
        },
        error: (err) => {
          this.saving.set(false);
          this.notificationService.error(err?.error?.message || 'Failed to create room');
        },
      });
    }
  }

  confirmDelete(room: Room) {
    this.deletingRoom.set(room);
    this.showDeleteDialog = true;
  }

  deleteRoom() {
    const room = this.deletingRoom();
    if (!room) return;
    this.saving.set(true);
    this.roomService.delete(room.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.showDeleteDialog = false;
        this.deletingRoom.set(null);
        this.loadRooms();
        this.notificationService.success('Room deleted successfully');
      },
      error: (err) => {
        this.saving.set(false);
        this.notificationService.error(err?.error?.message || 'Failed to delete room');
      },
    });
  }

  formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
}
