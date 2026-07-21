import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

export interface TimetableEntry {
  classId: string;
  className: string;
  courseId: string;
  courseName: string | null;
  branchId: string;
  branchName: string | null;
  instructorId: string | null;
  instructorName: string | null;
  roomId: string | null;
  roomCode: string | null;
  sessionId: string | null;
  sessionStart: string | null;
  sessionEnd: string | null;
  /** False for a prepared (pre-attendance) session that hasn't been formally started. */
  sessionStarted: boolean;
  isInProgress: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startTime: string | null;
  endTime: string | null;
  daysOfWeek: string | null;
  studentCount: number;
  maxStudents: number | null;
  notes: string | null;
}

export interface TimetableDay {
  date: string;
  dayOfWeek: string;
  entries: TimetableEntry[];
}

export interface TimetableFilters {
  date: string;
  branchId?: string;
  teacherId?: string;
  courseId?: string;
  /** Rooms hang off the day's session, so this only matches classes that have one. */
  roomId?: string;
}

@Injectable({ providedIn: 'root' })
export class TimetableService {
  private api = inject(ApiService);

  getDay(filters: TimetableFilters): Observable<TimetableDay> {
    const params: any = { date: filters.date };
    if (filters.branchId) params.branchId = filters.branchId;
    if (filters.teacherId) params.teacherId = filters.teacherId;
    if (filters.courseId) params.courseId = filters.courseId;
    if (filters.roomId) params.roomId = filters.roomId;
    return this.api.get<TimetableDay>('timetable', params);
  }
}
