import { UserRole } from '../enums/user-role.enum';

export interface User {
  id: string;
  companyId: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  branchId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SafeUser {
  id: string;
  companyId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  branchId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserCreateDto {
  companyId: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  branchId?: string | null;
}

export interface UserUpdateDto {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  branchId?: string | null;
  isActive?: boolean;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  // Company details
  companyName: string;
  companyEmail: string;
  companyCode?: string;
  industry?: string;
  timezone?: string;

  // User details (becomes company owner/admin)
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
}

export interface CompanySummary {
  id: string;
  name: string;
  code: string;
  subscriptionTier: string;
  subscriptionStatus: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: SafeUser;
  company?: CompanySummary;
}
