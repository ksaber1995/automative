export interface Session {
  id: string;
  companyId: string;
  branchId: string;
  roomId: string | null;
  classId: string;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionWithDetails extends Session {
  roomCode: string | null;
  roomDescription?: string | null;
  className: string;
  classCode: string;
  courseName?: string;
  branchName?: string;
  durationMinutes?: number | null;
}

export interface SessionStartDto {
  roomId?: string;
  classId: string;
  branchId: string;
  notes?: string;
}

export interface SessionEndDto {
  notes?: string;
}
