export interface Room {
  id: string;
  companyId: string;
  branchId: string;
  code: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoomWithStatus extends Room {
  branchName?: string;
  isOccupied: boolean;
  activeSession?: {
    id: string;
    classId: string;
    className: string;
    startDate: string;
  } | null;
}

export interface RoomCreateDto {
  branchId: string;
  code: string;
  description?: string;
}

export interface RoomUpdateDto {
  code?: string;
  description?: string;
  isActive?: boolean;
}
