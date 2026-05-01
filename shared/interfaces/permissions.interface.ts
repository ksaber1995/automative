import { UserRole } from '../enums/user-role.enum';

/**
 * Granular permission per resource.
 * Each resource can have read, write, and delete access independently.
 */
export interface ResourcePermission {
  read: boolean;
  write: boolean;
  delete: boolean;
}

/**
 * Full permission map for a user.
 * Stored as JSONB in the database.
 * Overrides the role defaults when present.
 */
export interface UserPermissions {
  dashboard?: Partial<ResourcePermission>;
  branches?: Partial<ResourcePermission>;
  /** Courses permission also covers Classes, Master Courses, Rooms, Sessions, and Timetable. */
  courses?: Partial<ResourcePermission>;
  students?: Partial<ResourcePermission>;
  enrollments?: Partial<ResourcePermission>;
  employees?: Partial<ResourcePermission>;
  revenues?: Partial<ResourcePermission>;
  expenses?: Partial<ResourcePermission>;
  refunds?: Partial<ResourcePermission>;
  debts?: Partial<ResourcePermission>;
  products?: Partial<ResourcePermission>;
  product_sales?: Partial<ResourcePermission>;
  reports?: Partial<ResourcePermission>;
  users?: Partial<ResourcePermission>;
  events?: Partial<ResourcePermission>;
  /** Cash permission also covers Withdrawals. */
  cash?: Partial<ResourcePermission>;
}

export type PermissionResource = keyof UserPermissions;
export type PermissionAction = keyof ResourcePermission;

export const PERMISSION_RESOURCES: PermissionResource[] = [
  'dashboard',
  'branches',
  'courses',
  'students',
  'enrollments',
  'employees',
  'revenues',
  'expenses',
  'refunds',
  'debts',
  'products',
  'product_sales',
  'reports',
  'users',
  'events',
  'cash',
];

export const FINANCIAL_RESOURCES: PermissionResource[] = [
  'revenues',
  'expenses',
  'refunds',
  'debts',
  'reports',
  'cash',
];

const FULL: ResourcePermission = { read: true, write: true, delete: true };
const READ_WRITE: ResourcePermission = { read: true, write: true, delete: false };
const READ_ONLY: ResourcePermission = { read: true, write: false, delete: false };
const NO_ACCESS: ResourcePermission = { read: false, write: false, delete: false };

/**
 * Default permissions for each role.
 * These are applied when a user has no custom permission overrides.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, UserPermissions> = {
  [UserRole.GLOBAL_ADMIN]: {
    dashboard:    FULL,
    branches:     FULL,
    courses:      FULL,
    students:     FULL,
    enrollments:  FULL,
    employees:    FULL,
    revenues:     FULL,
    expenses:     FULL,
    refunds:      FULL,
    debts:        FULL,
    products:     FULL,
    product_sales: FULL,
    reports:      FULL,
    users:        FULL,
    events: FULL,
    cash: FULL,
  },
  [UserRole.ADMIN]: {
    dashboard:    FULL,
    branches:     FULL,
    courses:      FULL,
    students:     FULL,
    enrollments:  FULL,
    employees:    FULL,
    revenues:     FULL,
    expenses:     FULL,
    refunds:      FULL,
    debts:        FULL,
    products:     FULL,
    product_sales: FULL,
    reports:      FULL,
    users:        FULL,
    events: FULL,
    cash: FULL,
  },
  [UserRole.BRANCH_ADMIN]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      FULL,
    students:     FULL,
    enrollments:  FULL,
    employees:    FULL,
    revenues:     FULL,
    expenses:     FULL,
    refunds:      FULL,
    debts:        FULL,
    products:     FULL,
    product_sales: FULL,
    reports:      READ_ONLY,
    users:        NO_ACCESS,
    events: FULL,
    cash: READ_ONLY,
  },
  [UserRole.BRANCH_MANAGER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      FULL,
    students:     FULL,
    enrollments:  FULL,
    employees:    FULL,
    revenues:     FULL,
    expenses:     FULL,
    refunds:      FULL,
    debts:        FULL,
    products:     FULL,
    product_sales: FULL,
    reports:      READ_ONLY,
    users:        NO_ACCESS,
    events: FULL,
    cash: READ_ONLY,
  },
  [UserRole.ACADEMIC_MANAGER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      FULL,
    students:     FULL,
    enrollments:  READ_WRITE,
    employees:    READ_ONLY,
    revenues:     NO_ACCESS,
    expenses:     NO_ACCESS,
    refunds:      NO_ACCESS,
    debts:        NO_ACCESS,
    products:     READ_ONLY,
    product_sales: NO_ACCESS,
    reports:      NO_ACCESS,
    users:        NO_ACCESS,
    events: FULL,
    cash: NO_ACCESS,
  },
  [UserRole.SALES_MANAGER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      READ_ONLY,
    students:     READ_WRITE,
    enrollments:  READ_WRITE,
    employees:    READ_ONLY,
    revenues:     NO_ACCESS,
    expenses:     NO_ACCESS,
    refunds:      NO_ACCESS,
    debts:        NO_ACCESS,
    products:     FULL,
    product_sales: FULL,
    reports:      NO_ACCESS,
    users:        NO_ACCESS,
    events: READ_ONLY,
    cash: NO_ACCESS,
  },
  [UserRole.ACCOUNTANT]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      READ_ONLY,
    students:     READ_ONLY,
    enrollments:  READ_ONLY,
    employees:    READ_ONLY,
    revenues:     FULL,
    expenses:     FULL,
    refunds:      FULL,
    debts:        FULL,
    products:     READ_ONLY,
    product_sales: READ_ONLY,
    reports:      FULL,
    users:        NO_ACCESS,
    events: READ_ONLY,
    cash: FULL,
  },
  [UserRole.VIEWER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      READ_ONLY,
    students:     READ_ONLY,
    enrollments:  READ_ONLY,
    employees:    NO_ACCESS,
    revenues:     NO_ACCESS,
    expenses:     NO_ACCESS,
    refunds:      NO_ACCESS,
    debts:        NO_ACCESS,
    products:     READ_ONLY,
    product_sales: NO_ACCESS,
    reports:      NO_ACCESS,
    users:        NO_ACCESS,
    events: READ_ONLY,
    cash: NO_ACCESS,
  },
};

/**
 * Resolve the effective permission for a user on a given resource and action.
 * Custom permissions in `userPermissions` override role defaults.
 */
export function resolvePermission(
  role: UserRole,
  resource: PermissionResource,
  action: PermissionAction,
  userPermissions?: UserPermissions | null
): boolean {
  // Custom permission override takes precedence
  if (userPermissions?.[resource]?.[action] !== undefined) {
    return userPermissions[resource]![action] as boolean;
  }
  // Fall back to role default
  return ROLE_DEFAULT_PERMISSIONS[role]?.[resource]?.[action] ?? false;
}
