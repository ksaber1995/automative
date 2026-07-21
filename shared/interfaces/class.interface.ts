export type ClassStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'DONE';
export type ClassType = 'ONLINE' | 'OFFLINE';

// Per-day start/end time for a class. `day` is an UPPER weekday name (e.g. MONDAY).
export interface ClassDayTime {
  day: string;
  startTime: string;
  endTime: string;
}

export interface Class {
  id: string;
  companyId: string;
  courseId: string;
  branchId: string;
  instructorId?: string;
  /** The room the class is scheduled in. A session may still be opened elsewhere. */
  roomId?: string | null;
  roomCode?: string | null;
  name: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  daysOfWeek?: string;
  dayTimes?: ClassDayTime[];
  maxStudents?: number;
  currentEnrollment: number;
  notes?: string;
  isActive: boolean;
  isFinished?: boolean;
  finishedAt?: string | null;
  type?: ClassType;
  status?: ClassStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ClassCreateDto {
  courseId: string;
  branchId: string;
  instructorId?: string;
  roomId?: string | null;
  name: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  daysOfWeek?: string;
  dayTimes?: ClassDayTime[];
  maxStudents?: number;
  notes?: string;
  type?: ClassType;
}

export interface ClassUpdateDto {
  courseId?: string;
  branchId?: string;
  instructorId?: string;
  roomId?: string | null;
  name?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  daysOfWeek?: string;
  dayTimes?: ClassDayTime[];
  maxStudents?: number;
  notes?: string;
  type?: ClassType;
}

// Extended interface with populated data for frontend display
export interface ClassWithDetails extends Class {
  courseName?: string;
  branchName?: string;
  instructorName?: string;
  teacher?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  studentCount?: number;
  schedule?: {
    daysOfWeek?: string;
    startTime?: string;
    endTime?: string;
  };
  students?: Array<{
    id: string;
    name: string;
    email?: string;
    enrollmentStatus?: string;
  }>;
}
