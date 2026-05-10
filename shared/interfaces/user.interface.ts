import { UserRole } from '../enums/user-role.enum';
import { UserPermissions } from './permissions.interface';

export interface User {
  id: string;
  companyId: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  branchId?: string | null;
  linkedEmployeeId?: string | null;  // Optional link to an employee record
  permissions?: UserPermissions | null; // Custom permission overrides (null = use role defaults)
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
  branchIds?: string[];              // All branch IDs (for BRANCH_ADMIN multi-branch)
  linkedEmployeeId?: string | null;
  permissions?: UserPermissions | null;
  isActive: boolean;
  countryCode?: string | null;
  phone?: string | null;
  phoneVerified?: boolean;
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
  branchIds?: string[];              // For BRANCH_ADMIN: assign multiple branches
  linkedEmployeeId?: string | null;
  permissions?: UserPermissions | null;
}

export interface UserUpdateDto {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  branchId?: string | null;
  branchIds?: string[];
  linkedEmployeeId?: string | null;
  permissions?: UserPermissions | null;
  isActive?: boolean;
}

export interface ConvertEmployeeToUserDto {
  employeeId: string;
  email: string;
  password: string;
  role: UserRole;
  branchIds?: string[];
  permissions?: UserPermissions | null;
}

export interface LoginDto {
  identifier: string; // email or phone (with or without country code / leading 0)
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
  countryCode: string;
  phone: string;
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

export interface RegisterResponse {
  countryCode: string;
  phone: string;
  message: string;
}
