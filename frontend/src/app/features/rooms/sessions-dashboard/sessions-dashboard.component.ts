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
import { CheckboxModule } from 'primeng/checkbox';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SessionService, Session, StartSessionTeacher } from '../services/session.service';
import { RoomService, Room } from '../services/room.service';
import { AttendanceService, SessionAttendanceStudent } from '../services/attendance.service';
import { TeacherAttendanceService, SessionTeacherAttendanceRow } from '../../attendance/services/teacher-attendance.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ClassService } from '../../courses/services/class.service';
import { BranchService } from '../../branches/services/branch.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { LanguageService } from '../../../core/services/language.service';
import { Branch } from '@shared/interfaces/branch.interface';

interface DialogTeacherRow {
  employeeId: string;
  role: 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT';
  status: 'PRESENT' | 'ABSENT';
}

interface TeacherOption {
  id: string;
  displayName: string;
}

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
    CheckboxModule,
    TranslateModule,
  ],
  template: `
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">{{ 'SESSIONS_DASHBOARD.TITLE' | translate }}</h1>
          <p class="text-gray-600 mt-1">{{ 'SESSIONS_DASHBOARD.SUBTITLE' | translate }}</p>
        </div>
        <p-button [label]="'SESSIONS_DASHBOARD.START_SESSION' | translate" icon="pi pi-play" (onClick)="openStartDialog()"></p-button>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500 mb-1">{{ 'SESSIONS_DASHBOARD.STAT_ACTIVE' | translate }}</p>
          <p class="text-3xl font-bold text-indigo-600">{{ filteredActiveSessions().length }}</p>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500 mb-1">{{ 'SESSIONS_DASHBOARD.STAT_OCCUPIED' | translate }}</p>
          <p class="text-3xl font-bold text-red-600">{{ filteredOccupiedRooms().length }}</p>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500 mb-1">{{ 'SESSIONS_DASHBOARD.STAT_FREE' | translate }}</p>
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
            [placeholder]="'SESSIONS_DASHBOARD.ALL_BRANCHES' | translate"
            [showClear]="true"
            [style]="{ width: '100%' }"
          ></p-select>
        </div>
        @if (selectedBranchId()) {
          <p-button
            [label]="'SESSIONS_DASHBOARD.CLEAR_FILTER' | translate"
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
            {{ 'SESSIONS_DASHBOARD.TAB_ACTIVE' | translate }}
            @if (filteredActiveSessions().length > 0) {
              <span class="ml-2 bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">{{ filteredActiveSessions().length }}</span>
            }
          </p-tab>
          <p-tab value="rooms">
            <i class="pi pi-building mr-2"></i>
            {{ 'SESSIONS_DASHBOARD.TAB_ROOMS' | translate }}
          </p-tab>
          <p-tab value="history">
            <i class="pi pi-history mr-2"></i>
            {{ 'SESSIONS_DASHBOARD.TAB_HISTORY' | translate }}
          </p-tab>
        </p-tablist>

        <p-tabpanels>
          <!-- Active Sessions Tab -->
          <p-tabpanel value="active">
            @if (loadingActive()) {
              <div class="text-center py-12 text-gray-400">
                <i class="pi pi-spin pi-spinner text-3xl mb-2"></i>
                <p>{{ 'SESSIONS_DASHBOARD.LOADING_ACTIVE' | translate }}</p>
              </div>
            }
            @if (!loadingActive() && filteredActiveSessions().length === 0) {
              <div class="text-center py-12 text-gray-400">
                <i class="pi pi-check-circle text-5xl text-green-300 mb-3"></i>
                <p class="text-lg">{{ 'SESSIONS_DASHBOARD.NO_ACTIVE_TITLE' | translate }}</p>
                <p class="text-sm">{{ (selectedBranchId() ? 'SESSIONS_DASHBOARD.NO_ACTIVE_HINT_BRANCH' : 'SESSIONS_DASHBOARD.NO_ACTIVE_HINT_ALL') | translate }}</p>
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
                          <span class="text-xs font-semibold text-green-700 uppercase tracking-wide">{{ 'SESSIONS_DASHBOARD.LIVE' | translate }}</span>
                        </div>
                        <h3 class="font-bold text-gray-900 text-lg">{{ session.className }}</h3>
                        <p class="text-sm text-gray-500">{{ session.courseName }}</p>
                      </div>
                      <div class="text-right">
                        <p class="text-xs text-gray-500">{{ 'SESSIONS_DASHBOARD.ROOM' | translate }}</p>
                        <p class="font-bold text-indigo-700 text-lg">{{ session.roomCode }}</p>
                      </div>
                    </div>
                    <div class="flex items-center justify-between text-sm text-gray-600 mb-4">
                      <span><i class="pi pi-clock mr-1"></i>{{ 'SESSIONS_DASHBOARD.STARTED_AT' | translate: { time: formatTime(session.startDate) } }}</span>
                      <span class="text-orange-600 font-medium">{{ getDuration(session.startDate) }}</span>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                      <p-button
                        [label]="(expandedAttendanceSessionId() === session.id ? 'SESSIONS_DASHBOARD.HIDE_ATTENDANCE' : 'SESSIONS_DASHBOARD.ADD_ATTENDANCE') | translate"
                        [icon]="expandedAttendanceSessionId() === session.id ? 'pi pi-chevron-up' : 'pi pi-check-square'"
                        severity="info"
                        [outlined]="true"
                        size="small"
                        styleClass="w-full"
                        (onClick)="toggleAttendance(session)"
                      ></p-button>
                      <p-button
                        [label]="(expandedTeachersSessionId() === session.id ? 'SESSIONS_DASHBOARD.HIDE_TEACHERS' : 'SESSIONS_DASHBOARD.MANAGE_TEACHERS') | translate"
                        [icon]="expandedTeachersSessionId() === session.id ? 'pi pi-chevron-up' : 'pi pi-user-edit'"
                        severity="warn"
                        [outlined]="true"
                        size="small"
                        styleClass="w-full"
                        (onClick)="toggleTeachers(session)"
                      ></p-button>
                      <p-button
                        [label]="'SESSIONS_DASHBOARD.END_SESSION' | translate"
                        icon="pi pi-stop"
                        severity="danger"
                        [outlined]="true"
                        size="small"
                        styleClass="w-full"
                        (onClick)="confirmEndSession(session)"
                      ></p-button>
                    </div>

                    <!-- Teacher attendance accordion -->
                    @if (expandedTeachersSessionId() === session.id) {
                      <div class="mt-4 pt-4 border-t border-gray-200">
                        @if (loadingTeachersFor() === session.id) {
                          <div class="text-center py-6 text-gray-400">
                            <i class="pi pi-spin pi-spinner text-2xl mb-2"></i>
                            <p class="text-sm">{{ 'SESSIONS_DASHBOARD.LOADING_TEACHERS' | translate }}</p>
                          </div>
                        } @else {
                          <div class="flex items-center justify-between mb-3">
                            <span class="text-sm font-semibold text-gray-700">{{ 'SESSIONS_DASHBOARD.TEACHERS_TITLE' | translate }}</span>
                            <span class="text-xs text-gray-500">{{ 'SESSIONS_DASHBOARD.TEACHERS_DESC' | translate }}</span>
                          </div>

                          @if (getTeacherRows(session.id).length > 0) {
                            <div class="space-y-2 mb-3">
                              @for (t of getTeacherRows(session.id); track t.employeeId) {
                                <div class="grid grid-cols-12 gap-2 items-center bg-gray-50 border border-gray-200 rounded-md p-2">
                                  <div class="col-span-4 text-sm font-medium truncate" [title]="employeeLabel(t.employeeId)">
                                    {{ employeeLabel(t.employeeId) }}
                                  </div>
                                  <div class="col-span-3">
                                    <p-select
                                      [options]="roleOptions()"
                                      [ngModel]="t.role"
                                      (ngModelChange)="updateSessionTeacherRole(session.id, t.employeeId, $event)"
                                      [ngModelOptions]="{ standalone: true }"
                                      optionLabel="label"
                                      optionValue="value"
                                      appendTo="body"
                                      [style]="{ width: '100%' }"
                                    ></p-select>
                                  </div>
                                  <div class="col-span-3">
                                    <p-select
                                      [options]="statusOptions()"
                                      [ngModel]="t.status"
                                      (ngModelChange)="updateSessionTeacherStatus(session.id, t.employeeId, $event)"
                                      [ngModelOptions]="{ standalone: true }"
                                      optionLabel="label"
                                      optionValue="value"
                                      appendTo="body"
                                      [style]="{ width: '100%' }"
                                    ></p-select>
                                  </div>
                                  <div class="col-span-2 flex justify-end">
                                    <p-button icon="pi pi-times" severity="danger" [text]="true" [rounded]="true"
                                      [pTooltip]="'SESSIONS_DASHBOARD.TEACHER_REMOVE' | translate"
                                      (onClick)="removeSessionTeacher(session.id, t.employeeId)"></p-button>
                                  </div>
                                </div>
                              }
                            </div>
                          } @else {
                            <p class="text-xs text-gray-400 mb-3">{{ 'SESSIONS_DASHBOARD.NO_TEACHERS_YET' | translate }}</p>
                          }

                          <div class="flex items-center gap-2">
                            <p-select
                              [options]="availableEmployeesFor(session.id)"
                              [ngModel]="newSessionTeacherIds[session.id] || null"
                              (ngModelChange)="newSessionTeacherIds[session.id] = $event"
                              [ngModelOptions]="{ standalone: true }"
                              optionLabel="displayName"
                              optionValue="id"
                              appendTo="body"
                              [placeholder]="'SESSIONS_DASHBOARD.ADD_TEACHER' | translate"
                              [filter]="true"
                              filterBy="displayName"
                              [showClear]="true"
                              [style]="{ flex: '1' }"
                            ></p-select>
                            <p-button icon="pi pi-plus" severity="secondary"
                              [disabled]="!newSessionTeacherIds[session.id]"
                              (onClick)="addSessionTeacher(session.id)"></p-button>
                          </div>

                          <div class="mt-3 pt-3 border-t flex justify-end">
                            <p-button
                              [label]="'SESSIONS_DASHBOARD.SAVE_TEACHERS' | translate"
                              icon="pi pi-check"
                              size="small"
                              [loading]="savingTeachersFor() === session.id"
                              (onClick)="saveTeachersForSession(session.id)"
                            ></p-button>
                          </div>
                        }
                      </div>
                    }

                    <!-- Attendance accordion -->
                    @if (expandedAttendanceSessionId() === session.id) {
                      <div class="mt-4 pt-4 border-t border-gray-200">
                        @if (loadingAttendanceFor() === session.id) {
                          <div class="text-center py-6 text-gray-400">
                            <i class="pi pi-spin pi-spinner text-2xl mb-2"></i>
                            <p class="text-sm">{{ 'SESSIONS_DASHBOARD.LOADING_STUDENTS' | translate }}</p>
                          </div>
                        } @else {
                          <div class="flex items-center justify-between mb-3">
                            <span class="text-sm font-medium text-gray-700">
                              {{ 'SESSIONS_DASHBOARD.STUDENT_COUNT' | translate: { count: getAttendanceStudents(session.id).length } }}
                            </span>
                          </div>
                          @if (getAttendanceStudents(session.id).length === 0) {
                            <div class="text-center py-6 text-gray-400 text-sm">
                              <i class="pi pi-users text-3xl mb-2 text-gray-300"></i>
                              <p>{{ 'SESSIONS_DASHBOARD.NO_STUDENTS_ENROLLED' | translate }}</p>
                            </div>
                          } @else {
                            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                              @for (student of getAttendanceStudents(session.id); track student.studentId) {
                                <div class="flex items-center justify-between p-2 rounded-lg border"
                                  [class.border-green-200]="student.isPresent"
                                  [class.bg-green-50]="student.isPresent"
                                  [class.border-gray-200]="!student.isPresent">
                                  <div class="flex items-center gap-3">
                                    <p-checkbox
                                      [ngModel]="student.isPresent"
                                      (ngModelChange)="toggleStudentPresence(session.id, student, $event)"
                                      [binary]="true"
                                      [inputId]="'att-' + session.id + '-' + student.studentId"
                                    ></p-checkbox>
                                    <label [for]="'att-' + session.id + '-' + student.studentId"
                                      class="cursor-pointer text-sm font-medium text-gray-800">
                                      {{ student.studentFirstName }} {{ student.studentLastName }}
                                    </label>
                                  </div>
                                  <span class="text-xs font-semibold px-2 py-0.5 rounded-full"
                                    [class.bg-green-100]="student.isPresent"
                                    [class.text-green-700]="student.isPresent"
                                    [class.bg-gray-100]="!student.isPresent"
                                    [class.text-gray-500]="!student.isPresent">
                                    {{ (student.isPresent ? 'SESSIONS_DASHBOARD.PRESENT' : 'SESSIONS_DASHBOARD.ABSENT') | translate }}
                                  </span>
                                </div>
                              }
                            </div>
                            <div class="mt-3 pt-3 border-t flex items-center justify-between">
                              <span class="text-xs text-gray-500">
                                <span class="text-green-600 font-semibold">{{ 'SESSIONS_DASHBOARD.PRESENT_COUNT' | translate: { count: presentCountForSession(session.id) } }}</span>
                                ·
                                <span class="text-red-500 font-semibold">{{ 'SESSIONS_DASHBOARD.ABSENT_COUNT' | translate: { count: absentCountForSession(session.id) } }}</span>
                              </span>
                              <span class="text-xs flex items-center gap-1"
                                [class.text-gray-400]="attendanceSaveState()[session.id] !== 'saving' && attendanceSaveState()[session.id] !== 'error'"
                                [class.text-blue-500]="attendanceSaveState()[session.id] === 'saving'"
                                [class.text-red-500]="attendanceSaveState()[session.id] === 'error'">
                                @if (attendanceSaveState()[session.id] === 'saving') {
                                  <i class="pi pi-spin pi-spinner"></i>
                                  {{ 'SESSIONS_DASHBOARD.SAVING' | translate }}
                                } @else if (attendanceSaveState()[session.id] === 'saved') {
                                  <i class="pi pi-check"></i>
                                  {{ 'SESSIONS_DASHBOARD.SAVED' | translate }}
                                } @else if (attendanceSaveState()[session.id] === 'error') {
                                  <i class="pi pi-times"></i>
                                  {{ 'SESSIONS_DASHBOARD.SAVE_FAILED' | translate }}
                                } @else {
                                  {{ 'SESSIONS_DASHBOARD.AUTOSAVES' | translate }}
                                }
                              </span>
                            </div>
                          }
                        }
                      </div>
                    }
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
                        [value]="(room.isOccupied ? 'SESSIONS_DASHBOARD.ROOM_OCCUPIED' : 'SESSIONS_DASHBOARD.ROOM_FREE') | translate"
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
                      <p class="text-xs text-red-600">{{ 'SESSIONS_DASHBOARD.SINCE' | translate: { time: formatTime(room.activeSession.startDate) } }}</p>
                    }
                    @if (!room.isOccupied) {
                      <p-button
                        [label]="'SESSIONS_DASHBOARD.START_SESSION' | translate"
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
                    <p class="text-lg">{{ 'SESSIONS_DASHBOARD.NO_ROOMS_BRANCH' | translate }}</p>
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
                  <th>{{ 'SESSIONS_DASHBOARD.COL_ROOM' | translate }}</th>
                  <th>{{ 'SESSIONS_DASHBOARD.COL_CLASS' | translate }}</th>
                  <th>{{ 'SESSIONS_DASHBOARD.COL_COURSE' | translate }}</th>
                  <th>{{ 'SESSIONS_DASHBOARD.COL_STARTED' | translate }}</th>
                  <th>{{ 'SESSIONS_DASHBOARD.COL_ENDED' | translate }}</th>
                  <th>{{ 'SESSIONS_DASHBOARD.COL_DURATION' | translate }}</th>
                  <th>{{ 'SESSIONS_DASHBOARD.COL_STATUS' | translate }}</th>
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
                      [value]="(session.endDate ? 'SESSIONS_DASHBOARD.STATUS_ENDED' : 'SESSIONS_DASHBOARD.STATUS_ACTIVE') | translate"
                      [severity]="session.endDate ? 'secondary' : 'success'"
                    ></p-tag>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="7" class="text-center py-8 text-gray-400">{{ 'SESSIONS_DASHBOARD.NO_SESSIONS' | translate }}</td>
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
      [header]="'SESSIONS_DASHBOARD.DIALOG_START_TITLE' | translate"
      [modal]="true"
      [style]="{ width: '480px' }"
    >
      <form [formGroup]="sessionForm" class="space-y-4 pt-2">

        <!-- Branch -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'SESSIONS_DASHBOARD.FIELD_BRANCH' | translate }} <span class="text-red-500">*</span></label>
          <p-select
            formControlName="branchId"
            [options]="branches()"
            optionLabel="name"
            optionValue="id"
            appendTo="body"
            [placeholder]="'SESSIONS_DASHBOARD.PLACEHOLDER_BRANCH' | translate"
            [style]="{ width: '100%' }"
            (onChange)="onDialogBranchChange()"
          ></p-select>
          @if (sessionForm.get('branchId')?.invalid && sessionForm.get('branchId')?.touched) {
            <small class="text-red-500">{{ 'SESSIONS_DASHBOARD.ERR_BRANCH_REQUIRED' | translate }}</small>
          }
        </div>

        <!-- Room (filtered by selected branch) -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'SESSIONS_DASHBOARD.FIELD_ROOM' | translate }} <span class="text-red-500">*</span></label>
          <p-select
            formControlName="roomId"
            [options]="dialogFreeRooms()"
            optionLabel="code"
            optionValue="id"
            appendTo="body"
            [placeholder]="'SESSIONS_DASHBOARD.PLACEHOLDER_ROOM' | translate"
            [disabled]="!sessionForm.get('branchId')?.value"
            [style]="{ width: '100%' }"
          ></p-select>
          @if (!sessionForm.get('branchId')?.value) {
            <small class="text-gray-400">{{ 'SESSIONS_DASHBOARD.PICK_BRANCH_FIRST' | translate }}</small>
          }
          @if (sessionForm.get('roomId')?.invalid && sessionForm.get('roomId')?.touched) {
            <small class="text-red-500">{{ 'SESSIONS_DASHBOARD.ERR_ROOM_REQUIRED' | translate }}</small>
          }
          @if (sessionForm.get('branchId')?.value && dialogFreeRooms().length === 0) {
            <small class="text-orange-500">{{ 'SESSIONS_DASHBOARD.NO_FREE_ROOMS' | translate }}</small>
          }
        </div>

        <!-- Class (filtered by branch — only classes with students, active sessions shown as disabled) -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'SESSIONS_DASHBOARD.FIELD_CLASS' | translate }} <span class="text-red-500">*</span></label>
          <p-select
            formControlName="classId"
            [options]="dialogActiveClasses()"
            optionLabel="displayName"
            optionValue="id"
            optionDisabled="hasActiveSession"
            appendTo="body"
            [placeholder]="'SESSIONS_DASHBOARD.PLACEHOLDER_CLASS' | translate"
            [disabled]="!sessionForm.get('branchId')?.value || loadingDialogClasses()"
            [style]="{ width: '100%' }"
            (onChange)="onDialogClassChange()"
          >
            <ng-template pTemplate="item" let-cls>
              <div class="flex items-center justify-between w-full" [class.opacity-40]="cls.hasActiveSession">
                <span>{{ cls.displayName }}</span>
                <span class="flex items-center gap-1 ml-3 shrink-0">
                  <span class="text-xs text-gray-400">{{ 'SESSIONS_DASHBOARD.STUDENTS_SHORT' | translate: { count: cls.studentCount } }}</span>
                  @if (cls.hasActiveSession) {
                    <span class="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium ml-1">
                      <i class="pi pi-circle-fill text-orange-500 mr-1" style="font-size:0.45rem"></i>{{ 'SESSIONS_DASHBOARD.IN_SESSION' | translate }}
                    </span>
                  }
                </span>
              </div>
            </ng-template>
          </p-select>
          @if (!sessionForm.get('branchId')?.value) {
            <small class="text-gray-400">{{ 'SESSIONS_DASHBOARD.PICK_BRANCH_FIRST' | translate }}</small>
          }
          @if (loadingDialogClasses()) {
            <small class="text-gray-400"><i class="pi pi-spin pi-spinner mr-1"></i>{{ 'SESSIONS_DASHBOARD.LOADING_CLASSES' | translate }}</small>
          }
          @if (sessionForm.get('classId')?.invalid && sessionForm.get('classId')?.touched) {
            <small class="text-red-500">{{ 'SESSIONS_DASHBOARD.ERR_CLASS_REQUIRED' | translate }}</small>
          }
          @if (sessionForm.get('branchId')?.value && !loadingDialogClasses() && dialogActiveClasses().length === 0) {
            <small class="text-orange-500">{{ 'SESSIONS_DASHBOARD.NO_ELIGIBLE_CLASSES' | translate }}</small>
          }
        </div>

        <!-- Notes -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'SESSIONS_DASHBOARD.FIELD_NOTES' | translate }}</label>
          <textarea pTextarea formControlName="notes" rows="2" [placeholder]="'SESSIONS_DASHBOARD.PLACEHOLDER_NOTES' | translate" class="w-full"></textarea>
        </div>

        <!-- Teacher attendance -->
        <div class="border-t border-gray-200 pt-3">
          <div class="flex items-center justify-between mb-2">
            <div>
              <label class="block text-sm font-semibold text-gray-700">{{ 'SESSIONS_DASHBOARD.TEACHERS_TITLE' | translate }}</label>
              <p class="text-xs text-gray-500">{{ 'SESSIONS_DASHBOARD.TEACHERS_DESC' | translate }}</p>
            </div>
          </div>

          @if (dialogTeachers().length > 0) {
            <div class="space-y-2 mb-2">
              @for (t of dialogTeachers(); track t.employeeId) {
                <div class="grid grid-cols-12 gap-2 items-center bg-gray-50 border border-gray-200 rounded-md p-2">
                  <div class="col-span-4 text-sm font-medium truncate" [title]="employeeLabel(t.employeeId)">
                    {{ employeeLabel(t.employeeId) }}
                  </div>
                  <div class="col-span-3">
                    <p-select
                      [options]="roleOptions()"
                      [ngModel]="t.role"
                      (ngModelChange)="updateTeacherRole(t.employeeId, $event)"
                      [ngModelOptions]="{ standalone: true }"
                      optionLabel="label"
                      optionValue="value"
                      appendTo="body"
                      [style]="{ width: '100%' }"
                    ></p-select>
                  </div>
                  <div class="col-span-3">
                    <p-select
                      [options]="statusOptions()"
                      [ngModel]="t.status"
                      (ngModelChange)="updateTeacherStatus(t.employeeId, $event)"
                      [ngModelOptions]="{ standalone: true }"
                      optionLabel="label"
                      optionValue="value"
                      appendTo="body"
                      [style]="{ width: '100%' }"
                    ></p-select>
                  </div>
                  <div class="col-span-2 flex justify-end">
                    <p-button icon="pi pi-times" severity="danger" [text]="true" [rounded]="true"
                      [pTooltip]="'SESSIONS_DASHBOARD.TEACHER_REMOVE' | translate"
                      (onClick)="removeTeacherFromDialog(t.employeeId)"></p-button>
                  </div>
                </div>
              }
            </div>
          }

          <div class="flex items-center gap-2">
            <p-select
              [options]="availableEmployees()"
              [(ngModel)]="newTeacherEmployeeId"
              [ngModelOptions]="{ standalone: true }"
              optionLabel="displayName"
              optionValue="id"
              appendTo="body"
              [placeholder]="'SESSIONS_DASHBOARD.ADD_TEACHER' | translate"
              [filter]="true"
              filterBy="displayName"
              [showClear]="true"
              [style]="{ flex: '1' }"
            ></p-select>
            <p-button icon="pi pi-plus" severity="secondary"
              [disabled]="!newTeacherEmployeeId"
              (onClick)="addTeacherToDialog()"></p-button>
          </div>
        </div>
      </form>

      <ng-template pTemplate="footer">
        <p-button [label]="'SESSIONS_DASHBOARD.CANCEL' | translate" severity="secondary" [outlined]="true" (onClick)="showStartDialog = false"></p-button>
        <p-button
          [label]="'SESSIONS_DASHBOARD.START_SESSION' | translate"
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
      [header]="'SESSIONS_DASHBOARD.DIALOG_END_TITLE' | translate"
      [modal]="true"
      [style]="{ width: '440px' }"
      (onHide)="onEndDialogHide()"
    >
      @if (endingSession()) {
        <div class="pt-2 space-y-4">
          <!-- Session info -->
          <div class="bg-gray-50 rounded-lg p-3 text-sm text-gray-700">
            <p [innerHTML]="'SESSIONS_DASHBOARD.ENDING_FOR' | translate: { className: endingSession()!.className, roomCode: endingSession()!.roomCode }"></p>
            <p class="text-gray-500 mt-1">
              <i class="pi pi-clock mr-1"></i>{{ 'SESSIONS_DASHBOARD.STARTED_LABEL' | translate: { time: formatDateTime(endingSession()!.startDate) } }}
            </p>
          </div>

          <form [formGroup]="endSessionForm" class="space-y-4">
            <!-- End Date (locked — always same as start date) -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ 'SESSIONS_DASHBOARD.END_DATE' | translate }}
                <span class="ml-1 text-xs text-gray-400 font-normal">{{ 'SESSIONS_DASHBOARD.SAME_AS_START' | translate }}</span>
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
                {{ 'SESSIONS_DASHBOARD.END_TIME' | translate }} <span class="text-red-500">*</span>
              </label>
              <input
                pInputText
                type="time"
                formControlName="endTime"
                class="w-full"
                style="width:100%"
              />
              @if (endSessionForm.get('endTime')?.errors?.['required'] && endSessionForm.get('endTime')?.touched) {
                <small class="text-red-500">{{ 'SESSIONS_DASHBOARD.ERR_END_TIME_REQUIRED' | translate }}</small>
              }
              @if (endSessionForm.get('endTime')?.errors?.['endBeforeStart']) {
                <small class="text-red-500">
                  {{ 'SESSIONS_DASHBOARD.ERR_END_BEFORE_START' | translate: { time: formatTime(endingSession()!.startDate) } }}
                </small>
              }
            </div>

            <!-- Notes -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{{ 'SESSIONS_DASHBOARD.NOTES_OPTIONAL' | translate }}</label>
              <textarea
                pTextarea
                formControlName="notes"
                rows="2"
                [placeholder]="'SESSIONS_DASHBOARD.PLACEHOLDER_END_NOTES' | translate"
                class="w-full"
              ></textarea>
            </div>
          </form>
        </div>
      }

      <ng-template pTemplate="footer">
        <p-button [label]="'SESSIONS_DASHBOARD.CANCEL' | translate" severity="secondary" [outlined]="true" (onClick)="showEndDialog = false"></p-button>
        <p-button
          [label]="'SESSIONS_DASHBOARD.END_SESSION' | translate"
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
  private attendanceService = inject(AttendanceService);
  private teacherAttendanceService = inject(TeacherAttendanceService);
  private employeeService = inject(EmployeeService);
  private notificationService = inject(NotificationService);
  private fb = inject(FormBuilder);

  // ── Teacher attendance in Start dialog ─────────────────────────────────────
  dialogTeachers = signal<DialogTeacherRow[]>([]);
  allEmployees = signal<TeacherOption[]>([]);
  /** Employees not yet picked in dialogTeachers — used to populate the "add" select. */
  availableEmployees = computed<TeacherOption[]>(() => {
    const used = new Set(this.dialogTeachers().map((t) => t.employeeId));
    return this.allEmployees().filter((e) => !used.has(e.id));
  });
  newTeacherEmployeeId: string | null = null;
  private translate = inject(TranslateService);
  private languageService = inject(LanguageService);

  /** Role/status option labels — recompute when the active language changes. */
  roleOptions = computed<{ label: string; value: 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT' }[]>(() => {
    this.languageService.currentLang(); // dependency
    return [
      { label: this.translate.instant('SESSIONS_DASHBOARD.ROLE_PRIMARY'), value: 'PRIMARY' },
      { label: this.translate.instant('SESSIONS_DASHBOARD.ROLE_SUBSTITUTE'), value: 'SUBSTITUTE' },
      { label: this.translate.instant('SESSIONS_DASHBOARD.ROLE_ASSISTANT'), value: 'ASSISTANT' },
    ];
  });
  statusOptions = computed<{ label: string; value: 'PRESENT' | 'ABSENT' }[]>(() => {
    this.languageService.currentLang();
    return [
      { label: this.translate.instant('SESSIONS_DASHBOARD.STATUS_PRESENT'), value: 'PRESENT' },
      { label: this.translate.instant('SESSIONS_DASHBOARD.STATUS_ABSENT'), value: 'ABSENT' },
    ];
  });

  employeeLabel(id: string): string {
    return this.allEmployees().find((e) => e.id === id)?.displayName || '—';
  }

  addTeacherToDialog() {
    if (!this.newTeacherEmployeeId) return;
    const exists = this.dialogTeachers().some((t) => t.employeeId === this.newTeacherEmployeeId);
    if (exists) return;
    const primaryAlreadyPresent = this.dialogTeachers().some(
      (t) => t.role === 'PRIMARY' && t.status === 'PRESENT',
    );
    this.dialogTeachers.update((rows) => [
      ...rows,
      {
        employeeId: this.newTeacherEmployeeId!,
        role: primaryAlreadyPresent ? 'SUBSTITUTE' : 'PRIMARY',
        status: 'PRESENT',
      },
    ]);
    this.newTeacherEmployeeId = null;
  }

  removeTeacherFromDialog(employeeId: string) {
    this.dialogTeachers.update((rows) => rows.filter((t) => t.employeeId !== employeeId));
  }

  updateTeacherRole(employeeId: string, role: 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT') {
    this.dialogTeachers.update((rows) =>
      rows.map((t) => (t.employeeId === employeeId ? { ...t, role } : t)),
    );
  }

  updateTeacherStatus(employeeId: string, status: 'PRESENT' | 'ABSENT') {
    this.dialogTeachers.update((rows) =>
      rows.map((t) => (t.employeeId === employeeId ? { ...t, status } : t)),
    );
  }

  /** Prefill the dialog's teacher list with the class's instructor when the class changes. */
  onDialogClassChange() {
    const classId = this.sessionForm.get('classId')?.value;
    if (!classId) return;
    // If the user already added rows, don't overwrite — they're driving.
    if (this.dialogTeachers().length > 0) return;
    const cls = this.dialogActiveClasses().find((c) => c.id === classId);
    const instructorId = cls?.instructorId || cls?.instructor_id;
    if (instructorId) {
      this.dialogTeachers.set([{ employeeId: instructorId, role: 'PRIMARY', status: 'PRESENT' }]);
    }
  }

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

  /** Inline attendance accordion state */
  expandedAttendanceSessionId = signal<string | null>(null);
  loadingAttendanceFor = signal<string | null>(null);
  savingAttendanceFor = signal<string | null>(null);
  attendanceBySession = signal<Record<string, SessionAttendanceStudent[]>>({});
  /** Per-session UI state for the auto-save indicator */
  attendanceSaveState = signal<Record<string, 'saving' | 'saved' | 'error' | undefined>>({});
  /** Pending debounce timers per session, keyed by sessionId */
  private attendanceSaveTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  /** Timers that clear the "Saved" badge after a moment */
  private attendanceSavedClearTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private readonly ATTENDANCE_SAVE_DEBOUNCE_MS = 600;

  /** Inline teacher-attendance accordion state */
  expandedTeachersSessionId = signal<string | null>(null);
  loadingTeachersFor = signal<string | null>(null);
  savingTeachersFor = signal<string | null>(null);
  teachersBySession = signal<Record<string, DialogTeacherRow[]>>({});
  /** ngModel target for the "add teacher" select inside each session card. Keyed by sessionId. */
  newSessionTeacherIds: Record<string, string | null> = {};

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
    this.loadEmployees();
  }

  loadEmployees() {
    this.employeeService.getAllEmployees().subscribe({
      next: (list: any[]) => {
        this.allEmployees.set(
          list.map((e: any) => ({
            id: e.id,
            displayName: `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email || 'Unnamed',
          })),
        );
      },
    });
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
    this.populateDialogOptionsForBranch(room.branchId);
    this.showStartDialog = true;
  }

  private populateDialogOptionsForBranch(branchId: string) {
    this.dialogFreeRooms.set(
      this.rooms().filter((r: Room) => r.branchId === branchId && !r.isOccupied && r.isActive)
    );
    this.loadingDialogClasses.set(true);
    this.classService.getClassesByBranch(branchId).subscribe({
      next: (classes: any[]) => {
        this.dialogActiveClasses.set(
          classes
            .filter((c: any) => (c.studentCount ?? 0) > 0)
            .map((c: any) => ({
              ...c,
              displayName: `${c.name} (${c.code})`,
            }))
        );
        this.loadingDialogClasses.set(false);
      },
      error: () => this.loadingDialogClasses.set(false),
    });
  }

  buildSessionForm(roomId?: string, branchId?: string) {
    this.sessionForm = this.fb.group({
      branchId: [branchId || '', Validators.required],
      roomId: [roomId || '', Validators.required],
      classId: ['', Validators.required],
      notes: [''],
    });
    this.dialogTeachers.set([]);
    this.newTeacherEmployeeId = null;
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
    this.populateDialogOptionsForBranch(branchId);
  }

  startSession() {
    if (this.sessionForm.invalid) { this.sessionForm.markAllAsTouched(); return; }
    this.saving.set(true);
    const val = this.sessionForm.value;

    const teachers: StartSessionTeacher[] = this.dialogTeachers().map((t) => ({
      employeeId: t.employeeId,
      role: t.role,
      status: t.status,
    }));

    this.sessionService.start({
      roomId: val.roomId,
      classId: val.classId,
      branchId: val.branchId,
      notes: val.notes || undefined,
      teachers: teachers.length > 0 ? teachers : undefined,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showStartDialog = false;
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.MSG_SESSION_STARTED'));
        this.loadAll();
      },
      error: (err: any) => {
        this.saving.set(false);
        this.notificationService.error(err?.error?.message || this.translate.instant('SESSIONS_DASHBOARD.MSG_START_FAILED'));
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
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.MSG_SESSION_ENDED'));
        this.loadAll();
      },
      error: (err: any) => {
        this.saving.set(false);
        this.notificationService.error(err?.error?.message || this.translate.instant('SESSIONS_DASHBOARD.MSG_END_FAILED'));
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

  // ── Attendance accordion ──────────────────────────────────────────────────

  toggleAttendance(session: Session) {
    if (this.expandedAttendanceSessionId() === session.id) {
      this.expandedAttendanceSessionId.set(null);
      return;
    }
    this.expandedAttendanceSessionId.set(session.id);
    if (!this.attendanceBySession()[session.id]) {
      this.loadAttendanceForSession(session.id);
    }
  }

  loadAttendanceForSession(sessionId: string) {
    this.loadingAttendanceFor.set(sessionId);
    this.attendanceService.getBySession(sessionId).subscribe({
      next: (students) => {
        this.attendanceBySession.set({
          ...this.attendanceBySession(),
          [sessionId]: students.map(s => ({ ...s })),
        });
        this.loadingAttendanceFor.set(null);
      },
      error: () => {
        this.loadingAttendanceFor.set(null);
        this.notificationService.error(this.translate.instant('SESSIONS_DASHBOARD.MSG_LOAD_STUDENTS_FAILED'));
      },
    });
  }

  getAttendanceStudents(sessionId: string): SessionAttendanceStudent[] {
    return this.attendanceBySession()[sessionId] || [];
  }

  presentCountForSession(sessionId: string): number {
    return this.getAttendanceStudents(sessionId).filter(s => s.isPresent).length;
  }

  absentCountForSession(sessionId: string): number {
    return this.getAttendanceStudents(sessionId).filter(s => !s.isPresent).length;
  }

  /**
   * Called when the user toggles a student's checkbox. Updates local state immediately
   * and schedules a debounced save so rapid toggles only fire one network call.
   */
  toggleStudentPresence(sessionId: string, student: SessionAttendanceStudent, value: boolean) {
    const updated = this.getAttendanceStudents(sessionId).map((s) =>
      s.studentId === student.studentId ? { ...s, isPresent: value } : s,
    );
    this.attendanceBySession.set({
      ...this.attendanceBySession(),
      [sessionId]: updated,
    });

    if (this.attendanceSaveTimers[sessionId]) {
      clearTimeout(this.attendanceSaveTimers[sessionId]);
    }
    if (this.attendanceSavedClearTimers[sessionId]) {
      clearTimeout(this.attendanceSavedClearTimers[sessionId]);
      delete this.attendanceSavedClearTimers[sessionId];
    }
    this.attendanceSaveTimers[sessionId] = setTimeout(() => {
      delete this.attendanceSaveTimers[sessionId];
      this.flushAttendanceSave(sessionId);
    }, this.ATTENDANCE_SAVE_DEBOUNCE_MS);
  }

  private flushAttendanceSave(sessionId: string) {
    const students = this.getAttendanceStudents(sessionId);
    const presentIds = students.filter((s) => s.isPresent).map((s) => s.studentId);
    this.attendanceSaveState.set({ ...this.attendanceSaveState(), [sessionId]: 'saving' });
    this.attendanceService.saveForSession(sessionId, presentIds).subscribe({
      next: () => {
        this.attendanceSaveState.set({ ...this.attendanceSaveState(), [sessionId]: 'saved' });
        this.attendanceSavedClearTimers[sessionId] = setTimeout(() => {
          const next = { ...this.attendanceSaveState() };
          delete next[sessionId];
          this.attendanceSaveState.set(next);
          delete this.attendanceSavedClearTimers[sessionId];
        }, 2000);
      },
      error: (err: any) => {
        this.attendanceSaveState.set({ ...this.attendanceSaveState(), [sessionId]: 'error' });
        this.notificationService.error(
          err?.error?.message || this.translate.instant('SESSIONS_DASHBOARD.MSG_ATTENDANCE_SAVE_FAILED'),
        );
      },
    });
  }

  // ── Live teacher-attendance editor on the active session card ──────────────

  toggleTeachers(session: Session) {
    if (this.expandedTeachersSessionId() === session.id) {
      this.expandedTeachersSessionId.set(null);
      return;
    }
    this.expandedTeachersSessionId.set(session.id);
    if (!this.teachersBySession()[session.id]) {
      this.loadTeachersForSession(session.id);
    }
  }

  loadTeachersForSession(sessionId: string) {
    this.loadingTeachersFor.set(sessionId);
    this.teacherAttendanceService.getBySession(sessionId).subscribe({
      next: (rows: SessionTeacherAttendanceRow[]) => {
        this.teachersBySession.set({
          ...this.teachersBySession(),
          [sessionId]: rows.map((r) => ({
            employeeId: r.employeeId,
            role: r.role,
            status: r.status,
          })),
        });
        this.loadingTeachersFor.set(null);
      },
      error: () => {
        this.loadingTeachersFor.set(null);
        this.notificationService.error(this.translate.instant('SESSIONS_DASHBOARD.MSG_LOAD_TEACHERS_FAILED'));
      },
    });
  }

  getTeacherRows(sessionId: string): DialogTeacherRow[] {
    return this.teachersBySession()[sessionId] || [];
  }

  availableEmployeesFor(sessionId: string): TeacherOption[] {
    const used = new Set(this.getTeacherRows(sessionId).map((t) => t.employeeId));
    return this.allEmployees().filter((e) => !used.has(e.id));
  }

  addSessionTeacher(sessionId: string) {
    const empId = this.newSessionTeacherIds[sessionId];
    if (!empId) return;
    const rows = this.getTeacherRows(sessionId);
    if (rows.some((t) => t.employeeId === empId)) return;
    const primaryAlreadyPresent = rows.some((t) => t.role === 'PRIMARY' && t.status === 'PRESENT');
    const newRow: DialogTeacherRow = {
      employeeId: empId,
      role: primaryAlreadyPresent ? 'SUBSTITUTE' : 'PRIMARY',
      status: 'PRESENT',
    };
    this.teachersBySession.set({
      ...this.teachersBySession(),
      [sessionId]: [...rows, newRow],
    });
    this.newSessionTeacherIds[sessionId] = null;
  }

  removeSessionTeacher(sessionId: string, employeeId: string) {
    this.teachersBySession.set({
      ...this.teachersBySession(),
      [sessionId]: this.getTeacherRows(sessionId).filter((t) => t.employeeId !== employeeId),
    });
  }

  updateSessionTeacherRole(sessionId: string, employeeId: string, role: 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT') {
    this.teachersBySession.set({
      ...this.teachersBySession(),
      [sessionId]: this.getTeacherRows(sessionId).map((t) => (t.employeeId === employeeId ? { ...t, role } : t)),
    });
  }

  updateSessionTeacherStatus(sessionId: string, employeeId: string, status: 'PRESENT' | 'ABSENT') {
    this.teachersBySession.set({
      ...this.teachersBySession(),
      [sessionId]: this.getTeacherRows(sessionId).map((t) => (t.employeeId === employeeId ? { ...t, status } : t)),
    });
  }

  saveTeachersForSession(sessionId: string) {
    const payload = this.getTeacherRows(sessionId).map((t) => ({
      employeeId: t.employeeId,
      role: t.role,
      status: t.status,
    }));
    this.savingTeachersFor.set(sessionId);
    this.teacherAttendanceService.saveForSession(sessionId, payload).subscribe({
      next: (res) => {
        this.savingTeachersFor.set(null);
        this.notificationService.success(this.translate.instant('SESSIONS_DASHBOARD.MSG_TEACHERS_SAVED', { count: res.count }));
      },
      error: (err: any) => {
        this.savingTeachersFor.set(null);
        this.notificationService.error(err?.error?.message || this.translate.instant('SESSIONS_DASHBOARD.MSG_TEACHERS_SAVE_FAILED'));
      },
    });
  }
}
