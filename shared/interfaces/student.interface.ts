export interface Student {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email?: string;
  phone?: string;
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
  address?: string;
  branchId: string;
  isActive: boolean;
  enrollmentDate: string;
  churnDate?: string;
  churnReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentCreateDto {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email?: string;
  phone?: string;
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
  address?: string;
  branchId: string;
  enrollmentDate: string;
  notes?: string;
}

export interface StudentUpdateDto {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  address?: string;
  branchId?: string;
  isActive?: boolean;
  notes?: string;
}
