import { UserRole } from '../enums/user-role.enum';
import { UserPermissions } from './permissions.interface';

/**
 * What kind of academy a tenant is, which decides only what things are CALLED.
 *
 * SPORTS is an ordinary ADVANCED academy that speaks of coaches, trainees and
 * groups instead of teachers, students and classes. It is deliberately separate
 * from `companyType` and `plan`: every feature gate keys off those, and a sports
 * academy must pass all of them exactly as a general one does.
 */
export type CompanyVertical = 'GENERAL' | 'SPORTS';

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
  /** The owning company's display name — what the debug banner shows. */
  companyName?: string | null;
  // Owning company's registration type. SCHOOL exists in the schema ahead of
  // its signup flow shipping — see RegisterDto.type below.
  companyType?: 'ACADEMY' | 'TEACHER' | 'SCHOOL';
  plan?: 'SIMPLE' | 'ADVANCED';      // Feature plan; ADVANCED unlocks CRM & add-ons
  /** What this academy calls things. Drives the vocabulary overlay, nothing else. */
  vertical?: CompanyVertical;
  /** The pre-printed QR card pool — sold per academy, off unless we switch it on. */
  qrCardsEnabled?: boolean;
  /**
   * Online exams — lessons, question banks and the student exam portal. Switched
   * on per tenant from the admin console; off for everyone else. Read at login, so
   * a change needs a re-login (or AuthService.refreshUser) to be noticed.
   * Deliberately absent from RegisterDto: this is not a signup choice.
   */
  onlineExamsEnabled?: boolean;
  qrFree?: boolean;                  // Teacher tenant in the free QR-activation launch tier
  branchId?: string | null;
  branchIds?: string[];              // All branch IDs (for BRANCH_ADMIN multi-branch)
  linkedEmployeeId?: string | null;
  permissions?: UserPermissions | null;
  isActive: boolean;
  countryCode?: string | null;
  phone?: string | null;
  emailVerified?: boolean;
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
  // Account type chosen at signup: ACADEMY (institution) or TEACHER (individual).
  // SCHOOL is a recognised value with no signup flow yet — the login page shows
  // it as "Coming soon" and the register endpoint rejects it until that ships.
  type?: 'ACADEMY' | 'TEACHER' | 'SCHOOL';
  // Feature plan chosen at signup (academies only).
  plan?: 'SIMPLE' | 'ADVANCED';
  // Vocabulary chosen by which signup link was used. SPORTS forces an ADVANCED
  // academy server-side, so it is not a way to get advanced features for free.
  vertical?: CompanyVertical;
  qrCardsEnabled?: boolean;
  industry?: string;
  timezone?: string;

  // User details (becomes company owner/admin)
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  countryCode: string;
  phone: string;

  // Google reCAPTCHA v3 token captured on the client before submit.
  recaptchaToken?: string;
}

export interface CompanySummary {
  id: string;
  name: string;
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
  email: string;
  message: string;
}
