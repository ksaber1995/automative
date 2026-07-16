export enum UserRole {
  // Legacy roles (kept for backward compatibility)
  ADMIN = 'ADMIN',
  BRANCH_MANAGER = 'BRANCH_MANAGER',
  ACCOUNTANT = 'ACCOUNTANT',

  // New RBAC roles
  GLOBAL_ADMIN = 'GLOBAL_ADMIN',       // Full access to everything across all branches
  BRANCH_ADMIN = 'BRANCH_ADMIN',       // Full access to one or more assigned branches
  ACADEMIC_MANAGER = 'ACADEMIC_MANAGER', // Manage students/courses/classes/enrollments — no financials
  SALES_MANAGER = 'SALES_MANAGER',     // Manage products/sales/enrollments — no financials
  VIEWER = 'VIEWER',                   // Read-only access to academic data
}

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.GLOBAL_ADMIN]: 'Global Admin',
  [UserRole.BRANCH_ADMIN]: 'Branch Admin',
  [UserRole.ACADEMIC_MANAGER]: 'Academic Manager',
  [UserRole.SALES_MANAGER]: 'Sales Manager',
  [UserRole.VIEWER]: 'Viewer',
  // Legacy
  [UserRole.ADMIN]: 'Administrator',
  [UserRole.BRANCH_MANAGER]: 'Branch Manager',
  [UserRole.ACCOUNTANT]: 'Accountant',
};

export const NEW_ROLES: UserRole[] = [
  UserRole.GLOBAL_ADMIN,
  UserRole.BRANCH_ADMIN,
  UserRole.ACADEMIC_MANAGER,
  UserRole.SALES_MANAGER,
  UserRole.VIEWER,
];

export const ALL_ROLES: UserRole[] = [
  UserRole.GLOBAL_ADMIN,
  UserRole.BRANCH_ADMIN,
  UserRole.ACADEMIC_MANAGER,
  UserRole.SALES_MANAGER,
  UserRole.VIEWER,
  UserRole.ADMIN,
  UserRole.BRANCH_MANAGER,
  UserRole.ACCOUNTANT,
];
