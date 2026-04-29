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
  courses?: Partial<ResourcePermission>;
  classes?: Partial<ResourcePermission>;
  students?: Partial<ResourcePermission>;
  enrollments?: Partial<ResourcePermission>;
  employees?: Partial<ResourcePermission>;
  revenues?: Partial<ResourcePermission>;
  expenses?: Partial<ResourcePermission>;
  withdrawals?: Partial<ResourcePermission>;
  refunds?: Partial<ResourcePermission>;
  debts?: Partial<ResourcePermission>;
  products?: Partial<ResourcePermission>;
  product_sales?: Partial<ResourcePermission>;
  reports?: Partial<ResourcePermission>;
  users?: Partial<ResourcePermission>;
  master_courses?: Partial<ResourcePermission>;
  events?: Partial<ResourcePermission>;
  rooms?: Partial<ResourcePermission>;
  sessions?: Partial<ResourcePermission>;
  timetable?: Partial<ResourcePermission>;
}

export type PermissionResource = keyof UserPermissions;
export type PermissionAction = keyof ResourcePermission;

export const PERMISSION_RESOURCES: PermissionResource[] = [
  'dashboard',
  'branches',
  'courses',
  'classes',
  'students',
  'enrollments',
  'employees',
  'revenues',
  'expenses',
  'withdrawals',
  'refunds',
  'debts',
  'products',
  'product_sales',
  'reports',
  'users',
  'master_courses',
  'events',
  'rooms',
  'sessions',
  'timetable',
];

export const FINANCIAL_RESOURCES: PermissionResource[] = [
  'revenues',
  'expenses',
  'withdrawals',
  'refunds',
  'debts',
  'reports',
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
    classes:      FULL,
    students:     FULL,
    enrollments:  FULL,
    employees:    FULL,
    revenues:     FULL,
    expenses:     FULL,
    withdrawals:  FULL,
    refunds:      FULL,
    debts:        FULL,
    products:     FULL,
    product_sales: FULL,
    reports:      FULL,
    users:        FULL,
    master_courses: FULL,
    events: FULL,
    rooms: FULL,
    sessions: FULL,
    timetable: FULL,
  },
  [UserRole.ADMIN]: {
    dashboard:    FULL,
    branches:     FULL,
    courses:      FULL,
    classes:      FULL,
    students:     FULL,
    enrollments:  FULL,
    employees:    FULL,
    revenues:     FULL,
    expenses:     FULL,
    withdrawals:  FULL,
    refunds:      FULL,
    debts:        FULL,
    products:     FULL,
    product_sales: FULL,
    reports:      FULL,
    users:        FULL,
    master_courses: FULL,
    events: FULL,
    rooms: FULL,
    sessions: FULL,
    timetable: FULL,
  },
  [UserRole.BRANCH_ADMIN]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      FULL,
    classes:      FULL,
    students:     FULL,
    enrollments:  FULL,
    employees:    FULL,
    revenues:     FULL,
    expenses:     FULL,
    withdrawals:  FULL,
    refunds:      FULL,
    debts:        FULL,
    products:     FULL,
    product_sales: FULL,
    reports:      READ_ONLY,
    users:        NO_ACCESS,
    master_courses: READ_WRITE,
    events: FULL,
    rooms: FULL,
    sessions: FULL,
    timetable: READ_WRITE,
  },
  [UserRole.BRANCH_MANAGER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      FULL,
    classes:      FULL,
    students:     FULL,
    enrollments:  FULL,
    employees:    FULL,
    revenues:     FULL,
    expenses:     FULL,
    withdrawals:  FULL,
    refunds:      FULL,
    debts:        FULL,
    products:     FULL,
    product_sales: FULL,
    reports:      READ_ONLY,
    users:        NO_ACCESS,
    master_courses: READ_WRITE,
    events: FULL,
    rooms: FULL,
    sessions: FULL,
    timetable: READ_WRITE,
  },
  [UserRole.ACADEMIC_MANAGER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      FULL,
    classes:      FULL,
    students:     FULL,
    enrollments:  READ_WRITE,
    employees:    READ_ONLY,
    revenues:     NO_ACCESS,
    expenses:     NO_ACCESS,
    withdrawals:  NO_ACCESS,
    refunds:      NO_ACCESS,
    debts:        NO_ACCESS,
    products:     READ_ONLY,
    product_sales: NO_ACCESS,
    reports:      NO_ACCESS,
    users:        NO_ACCESS,
    master_courses: FULL,
    events: FULL,
    rooms: READ_WRITE,
    sessions: READ_WRITE,
    timetable: READ_WRITE,
  },
  [UserRole.SALES_MANAGER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      READ_ONLY,
    classes:      READ_ONLY,
    students:     READ_WRITE,
    enrollments:  READ_WRITE,
    employees:    READ_ONLY,
    revenues:     NO_ACCESS,
    expenses:     NO_ACCESS,
    withdrawals:  NO_ACCESS,
    refunds:      NO_ACCESS,
    debts:        NO_ACCESS,
    products:     FULL,
    product_sales: FULL,
    reports:      NO_ACCESS,
    users:        NO_ACCESS,
    master_courses: READ_ONLY,
    events: READ_ONLY,
    rooms: READ_ONLY,
    sessions: READ_ONLY,
    timetable: READ_ONLY,
  },
  [UserRole.ACCOUNTANT]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      READ_ONLY,
    classes:      READ_ONLY,
    students:     READ_ONLY,
    enrollments:  READ_ONLY,
    employees:    READ_ONLY,
    revenues:     FULL,
    expenses:     FULL,
    withdrawals:  FULL,
    refunds:      FULL,
    debts:        FULL,
    products:     READ_ONLY,
    product_sales: READ_ONLY,
    reports:      FULL,
    users:        NO_ACCESS,
    master_courses: READ_ONLY,
    events: READ_ONLY,
    rooms: READ_ONLY,
    sessions: READ_ONLY,
    timetable: READ_ONLY,
  },
  [UserRole.VIEWER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    courses:      READ_ONLY,
    classes:      READ_ONLY,
    students:     READ_ONLY,
    enrollments:  READ_ONLY,
    employees:    NO_ACCESS,
    revenues:     NO_ACCESS,
    expenses:     NO_ACCESS,
    withdrawals:  NO_ACCESS,
    refunds:      NO_ACCESS,
    debts:        NO_ACCESS,
    products:     READ_ONLY,
    product_sales: NO_ACCESS,
    reports:      NO_ACCESS,
    users:        NO_ACCESS,
    master_courses: READ_ONLY,
    events: READ_ONLY,
    rooms: READ_ONLY,
    sessions: READ_ONLY,
    timetable: READ_ONLY,
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
