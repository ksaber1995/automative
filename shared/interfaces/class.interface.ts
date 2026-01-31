export interface Class {
  id: string;
  courseId: string;
  name: string; // e.g., "Section A", "Morning Class"
  code: string; // e.g., "ROB-101-A"
  teacherId: string; // Employee ID
  schedule: ClassSchedule;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  maxStudents?: number;
  isActive: boolean;
  branchId: string; // Inherited from course for easy filtering
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassSchedule {
  days: DayOfWeek[]; // e.g., ['MONDAY', 'WEDNESDAY']
  startTime: string; // e.g., "15:00" (24-hour format)
  endTime: string; // e.g., "17:00" (24-hour format)
}

export enum DayOfWeek {
  SUNDAY = 'SUNDAY',
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
}

export interface ClassCreateDto {
  courseId: string;
  name: string;
  code: string;
  teacherId: string;
  schedule: ClassSchedule;
  startDate: string;
  endDate: string;
  maxStudents?: number;
  notes?: string;
}

export interface ClassUpdateDto {
  name?: string;
  code?: string;
  teacherId?: string;
  schedule?: ClassSchedule;
  startDate?: string;
  endDate?: string;
  maxStudents?: number;
  isActive?: boolean;
  notes?: string;
}

// Extended interface with populated data for frontend display
export interface ClassWithDetails extends Class {
  course?: {
    id: string;
    name: string;
    code: string;
  };
  teacher?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  studentCount?: number;
  students?: Array<{
    id: string;
    firstName: string;
    lastName: string;
    enrollmentId: string;
    enrollmentDate: string;
    paymentStatus: string;
  }>;
}
