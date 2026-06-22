export interface SessionAttendance {
  id: string;
  sessionId: string;
  studentId: string;
  notes?: string | null;
  createdAt: string;
}

export interface SessionAttendanceStudent {
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
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
  totalStudents: number;
  presentCount: number;
  absentCount: number;
}
