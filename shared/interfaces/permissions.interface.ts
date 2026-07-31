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
  /**
   * Academy permission covers: Courses, Classes, Master Courses, Rooms,
   * Sessions, Timetable, Attendance, and Events. Granting `academy.read`
   * additionally grants read access to `students` and `employees`.
   */
  academy?: Partial<ResourcePermission>;
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
  /** Cash permission also covers Withdrawals. */
  cash?: Partial<ResourcePermission>;
}

export type PermissionResource = keyof UserPermissions;
export type PermissionAction = keyof ResourcePermission;

export const PERMISSION_RESOURCES: PermissionResource[] = [
  'dashboard',
  'branches',
  'academy',
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
 * Record it, but don't get to read the books. Used by SECRETARY for the money
 * resources: the front desk takes a payment or issues a refund, without the
 * revenue and expense lists — the totals — being theirs to browse.
 */
const RECORD_ONLY: ResourcePermission = { read: false, write: true, delete: true };

/**
 * Default permissions for each role.
 * These are applied when a user has no custom permission overrides.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, UserPermissions> = {
  [UserRole.GLOBAL_ADMIN]: {
    dashboard:    FULL,
    branches:     FULL,
    academy:      FULL,
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
    cash: FULL,
  },
  [UserRole.ADMIN]: {
    dashboard:    FULL,
    branches:     FULL,
    academy:      FULL,
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
    cash: FULL,
  },
  [UserRole.BRANCH_ADMIN]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    academy:      FULL,
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
    cash: READ_ONLY,
  },
  [UserRole.BRANCH_MANAGER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    academy:      FULL,
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
    cash: READ_ONLY,
  },
  [UserRole.ACADEMIC_MANAGER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    academy:      FULL,
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
    cash: NO_ACCESS,
  },
  [UserRole.SALES_MANAGER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    academy:      READ_ONLY,
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
    cash: NO_ACCESS,
  },
  /**
   * The front desk. Modelled on how a real secretary account was already being
   * run by hand before this role existed: they register students, enrol them,
   * take the money and sell books, and they run the academy day to day
   * (classes, sessions, attendance) — but staff, users, reports, debts and the
   * cash drawer are not theirs, and neither is browsing the revenue, expense or
   * refund lists. RECORD_ONLY on those three is the point of the role: take a
   * payment, don't read the books.
   */
  [UserRole.SECRETARY]: {
    dashboard:    NO_ACCESS,
    branches:     READ_ONLY,
    academy:      FULL,
    students:     FULL,
    enrollments:  READ_WRITE,
    employees:    NO_ACCESS,
    revenues:     RECORD_ONLY,
    expenses:     RECORD_ONLY,
    refunds:      RECORD_ONLY,
    debts:        NO_ACCESS,
    products:     FULL,
    product_sales: FULL,
    reports:      NO_ACCESS,
    users:        NO_ACCESS,
    cash: NO_ACCESS,
  },
  [UserRole.ACCOUNTANT]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    academy:      READ_ONLY,
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
    cash: FULL,
  },
  [UserRole.VIEWER]: {
    dashboard:    READ_ONLY,
    branches:     READ_ONLY,
    academy:      READ_ONLY,
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
    cash: NO_ACCESS,
  },
};

/**
 * Resolve the effective permission for a user on a given resource and action.
 *
 * Cascade rule: `academy.read` additionally grants `students.read` and
 * `employees.read` even when those are otherwise denied. Write/delete do
 * NOT cascade — write access to students/employees requires its own
 * explicit permission.
 *
 * Custom permissions in `userPermissions` override role defaults.
 */
export function resolvePermission(
  role: UserRole,
  resource: PermissionResource,
  action: PermissionAction,
  userPermissions?: UserPermissions | null
): boolean {
  const direct = resolveDirect(role, resource, action, userPermissions);
  if (direct) return true;

  // Cascade: academy.read implies students.read + employees.read.
  if (action === 'read' && (resource === 'students' || resource === 'employees')) {
    return resolveDirect(role, 'academy', 'read', userPermissions);
  }
  return false;
}

function resolveDirect(
  role: UserRole,
  resource: PermissionResource,
  action: PermissionAction,
  userPermissions?: UserPermissions | null
): boolean {
  if (userPermissions?.[resource]?.[action] !== undefined) {
    return userPermissions[resource]![action] as boolean;
  }
  return ROLE_DEFAULT_PERMISSIONS[role]?.[resource]?.[action] ?? false;
}
