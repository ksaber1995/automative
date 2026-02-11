export interface Employee {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  branchId?: string | null;
  isGlobal: boolean;
  salary: number;
  hireDate: string;
  terminationDate?: string | null;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeCreateDto {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  branchId?: string | null;
  isGlobal: boolean;
  salary: number;
  hireDate: string;
  notes?: string;
}

export interface EmployeeUpdateDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  position?: string;
  department?: string;
  branchId?: string | null;
  isGlobal?: boolean;
  salary?: number;
  terminationDate?: string;
  isActive?: boolean;
  notes?: string;
}
