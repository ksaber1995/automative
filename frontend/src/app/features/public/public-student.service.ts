import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

export interface PublicStudentCourse {
  courseName: string;
  className: string | null;
  status: string;
  paymentStatus: string;
  enrollmentDate: string | null;
}

export interface PublicStudentAttendanceRecent {
  sessionStartDate: string;
  sessionNumber?: number | null;
  className: string;
  roomCode: string | null;
  isPresent: boolean;
  status?: 'PRESENT' | 'ABSENT' | 'SUBSTITUTED';
  substitutedInClassName?: string | null;
}

export interface PublicStudentExam {
  examName: string;
  courseName: string;
  examDate: string;
  grade: string;
  maxGrade?: number | null;
}

export interface PublicStudentProfile {
  student: {
    firstName: string;
    lastName: string;
    branchName: string;
    academyName: string;
  };
  courses: PublicStudentCourse[];
  attendance: {
    totalSessions: number;
    presentCount: number;
    absentCount: number;
    attendanceRate: number;
    recent: PublicStudentAttendanceRecent[];
  };
  exams?: PublicStudentExam[];
}

/**
 * Fetches the public, unauthenticated student profile by QR token. The
 * auth interceptor skips token attachment for `/public/` URLs, so this works
 * for a logged-out visitor (e.g. a parent scanning the printed QR).
 */
@Injectable({ providedIn: 'root' })
export class PublicStudentService {
  private api = inject(ApiService);

  getProfile(qrToken: string): Observable<PublicStudentProfile> {
    return this.api.get<PublicStudentProfile>(`public/students/${qrToken}`);
  }
}
