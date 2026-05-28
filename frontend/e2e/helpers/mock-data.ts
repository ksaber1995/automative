// Centralized canned data for the e2e suite. Each feature spec spreads or
// overrides these to avoid duplicating boilerplate.

export const COMPANY = {
  id: 'c0000000-0000-0000-0000-000000000001',
  name: 'Acme Robotics Academy',
  subscriptionTier: 'PRO',
  subscriptionStatus: 'ACTIVE',
};

export const TOKEN = 'header.eyJleHAiOjk5OTk5OTk5OTl9.sig'; // exp ~year 5138

export const USERS = {
  admin: {
    id: 'u-admin-0001',
    companyId: COMPANY.id,
    email: 'admin@acme.test',
    firstName: 'Ada',
    lastName: 'Admin',
    role: 'ADMIN',
    branchId: null,
    branchIds: [],
    permissions: null,
    isActive: true,
    emailVerified: true,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  globalAdmin: {
    id: 'u-ga-0001',
    companyId: COMPANY.id,
    email: 'ga@acme.test',
    firstName: 'Grace',
    lastName: 'Global',
    role: 'GLOBAL_ADMIN',
    branchId: null,
    branchIds: [],
    permissions: null,
    isActive: true,
    emailVerified: true,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  branchAdmin: {
    id: 'u-ba-0001',
    companyId: COMPANY.id,
    email: 'ba@acme.test',
    firstName: 'Ben',
    lastName: 'Branch',
    role: 'BRANCH_ADMIN',
    branchId: 'b-0001',
    branchIds: ['b-0001'],
    permissions: null,
    isActive: true,
    emailVerified: true,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  accountant: {
    id: 'u-acc-0001',
    companyId: COMPANY.id,
    email: 'acc@acme.test',
    firstName: 'Cara',
    lastName: 'Coin',
    role: 'ACCOUNTANT',
    branchId: 'b-0001',
    branchIds: ['b-0001'],
    permissions: null,
    isActive: true,
    emailVerified: true,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  viewer: {
    id: 'u-v-0001',
    companyId: COMPANY.id,
    email: 'viewer@acme.test',
    firstName: 'Vic',
    lastName: 'View',
    role: 'VIEWER',
    branchId: 'b-0001',
    branchIds: ['b-0001'],
    permissions: null,
    isActive: true,
    emailVerified: true,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
} as const;

export type MockUser = (typeof USERS)[keyof typeof USERS];

export const BRANCHES = [
  {
    id: 'b-0001',
    companyId: COMPANY.id,
    name: 'Downtown HQ',
    code: 'DT01',
    address: '1 Main St',
    city: 'Cairo',
    state: 'CA',
    phone: '+201234567890',
    email: 'dt@acme.test',
    isActive: true,
    openingDate: '2023-01-01',
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
    hasFinancials: true,
  },
  {
    id: 'b-0002',
    companyId: COMPANY.id,
    name: 'Westside Lab',
    code: 'WS01',
    address: '2 West Ave',
    city: 'Alexandria',
    state: 'AL',
    phone: '+201234567891',
    email: 'ws@acme.test',
    isActive: true,
    openingDate: '2023-06-01',
    createdAt: '2023-06-01T00:00:00Z',
    updatedAt: '2023-06-01T00:00:00Z',
    hasFinancials: false,
  },
];

export const STUDENTS = [
  {
    id: 's-0001',
    companyId: COMPANY.id,
    branchId: 'b-0001',
    firstName: 'Sami',
    lastName: 'Student',
    email: 'sami@acme.test',
    phone: '+201111111111',
    dateOfBirth: '2010-05-10',
    gender: 'male',
    parentName: 'Parent One',
    parentPhone: '+201111111112',
    address: '3 Side St',
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 's-0002',
    companyId: COMPANY.id,
    branchId: 'b-0002',
    firstName: 'Layla',
    lastName: 'Learner',
    email: 'layla@acme.test',
    phone: '+201222222222',
    dateOfBirth: '2011-07-22',
    gender: 'female',
    parentName: 'Parent Two',
    parentPhone: '+201222222223',
    address: '4 East St',
    isActive: true,
    createdAt: '2024-01-15T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
  },
];

export const COURSES = [
  {
    id: 'c-0001',
    companyId: COMPANY.id,
    branchId: 'b-0001',
    name: 'Intro to Robotics',
    code: 'ROB101',
    description: 'Beginner robotics',
    price: 5000,
    durationHours: 24,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

export const MASTER_COURSES = [
  {
    id: 'mc-0001',
    companyId: COMPANY.id,
    branchId: 'b-0001',
    name: 'Robotics Master Track',
    code: 'MROB',
    description: 'Year-long master program',
    totalPrice: 30000,
    installmentCount: 6,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

export const CLASSES = [
  {
    id: 'cls-0001',
    companyId: COMPANY.id,
    branchId: 'b-0001',
    courseId: 'c-0001',
    name: 'ROB101 - Spring',
    teacherId: 'e-teacher-01',
    startDate: '2025-03-01',
    endDate: '2025-06-01',
    capacity: 20,
    enrolledCount: 8,
    status: 'ACTIVE',
    createdAt: '2025-02-15T00:00:00Z',
    updatedAt: '2025-02-15T00:00:00Z',
  },
];

export const EVENTS = [
  {
    id: 'ev-0001',
    companyId: COMPANY.id,
    branchId: 'b-0001',
    name: 'Open Day 2025',
    startDate: '2025-05-01',
    endDate: '2025-05-01',
    price: 100,
    capacity: 50,
    description: 'Open house event',
    createdAt: '2025-04-01T00:00:00Z',
    updatedAt: '2025-04-01T00:00:00Z',
  },
];

export const EMPLOYEES = [
  {
    id: 'e-teacher-01',
    companyId: COMPANY.id,
    branchId: 'b-0001',
    firstName: 'Tariq',
    lastName: 'Teacher',
    email: 'tariq@acme.test',
    phone: '+2010000001',
    role: 'TEACHER',
    salary: 8000,
    isActive: true,
    hireDate: '2023-01-01',
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
];

export const ROOMS = [
  {
    id: 'r-0001',
    companyId: COMPANY.id,
    branchId: 'b-0001',
    name: 'Lab A',
    capacity: 20,
    isActive: true,
  },
];

export const REVENUES = [
  {
    id: 'rev-0001',
    companyId: COMPANY.id,
    branchId: 'b-0001',
    amount: 5000,
    paymentMethod: 'CASH',
    category: 'TUITION',
    description: 'Enrollment payment',
    date: '2025-05-01',
    createdAt: '2025-05-01T00:00:00Z',
  },
];

export const EXPENSES = [
  {
    id: 'exp-0001',
    companyId: COMPANY.id,
    branchId: 'b-0001',
    amount: 1500,
    category: 'RENT',
    description: 'May rent',
    date: '2025-05-01',
    paid: false,
    createdAt: '2025-05-01T00:00:00Z',
  },
];

export const PRODUCTS = [
  {
    id: 'p-0001',
    companyId: COMPANY.id,
    branchId: 'b-0001',
    name: 'Robotics Kit',
    sku: 'KIT-001',
    price: 1200,
    stock: 15,
    isActive: true,
  },
];

export const DASHBOARD_STATS = {
  companyWideSummary: {
    totalRevenue: 125000,
    enrollmentRevenue: 110000,
    productRevenue: 15000,
    totalRefunds: 2000,
    fixedExpenses: 20000,
    variableExpenses: 15000,
    salaries: 10000,
    sharedExpenses: 3000,
    totalExpenses: 48000,
    netProfit: 77000,
    currentCash: 50000,
    totalOutstandingDebts: 5000,
    availableCash: 45000,
    allocationMethod: 'EQUAL',
    globalOverhead: 3000,
    unallocatedRevenue: 0,
    unallocatedExpenses: 0,
    unallocatedNetProfit: 0,
    sumBranchNetProfit: 77000,
  },
  branchSummaries: [],
  revenueByMonth: [],
  expensesByCategory: [],
  topPerformingBranches: [],
  period: { startDate: '2025-01-01', endDate: '2025-12-31' },
};

export function paged<T>(items: T[]) {
  return items;
}
