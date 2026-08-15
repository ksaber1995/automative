export interface SessionAttendance {
  id: string;
  sessionId: string;
  studentId: string;
  notes?: string | null;
  createdAt: string;
}

export interface SessionAttendanceStudent {
  studentId: string;
  studentName: string;
  parentName?: string | null;
  parentPhone?: string | null;
  studentPhone?: string | null;
  isPresent: boolean;
  attendanceId?: string | null;
  notes?: string | null;
}

export interface BulkAttendanceDto {
  presentStudentIds: string[];
}

export interface StudentAttendanceRecord {
  sessionId: string;
  sessionStartDate: string;
  sessionEndDate?: string | null;
  classId: string;
  className: string;
  roomCode?: string | null;
  isPresent: boolean;
}

export interface ClassAttendanceSummary {
  sessionId: string;
  sessionStartDate: string;
  sessionEndDate?: string | null;
  roomCode?: string | null;
  /**
   * Students there were to attend THIS lesson — those who had joined the class
   * by the day it ran, not the class roster as it stands today.
   */
  totalStudents: number;
  presentCount: number;
  absentCount: number;
}
