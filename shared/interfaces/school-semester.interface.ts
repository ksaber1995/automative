/**
 * A SCHOOL tenant's semester/term — company-wide, no relation to educational
 * stages or subjects. Backed by `school.semesters` (migration 095).
 */
export interface SchoolSemester {
  id: string;
  companyId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolSemesterCreateDto {
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
}

export interface SchoolSemesterUpdateDto {
  name?: string;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
}
