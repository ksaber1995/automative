import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

// =============================================
// Common Schemas
// =============================================
const UUIDSchema = z.string().uuid();
const OptionalUUIDSchema = z.preprocess(
  (val) => (val === '' || val === null) ? undefined : val,
  z.string().uuid().optional()
);
const DateStringSchema = z.string().datetime();

// User Roles (extended RBAC)
const UserRoleSchema = z.enum([
  'GLOBAL_ADMIN', 'BRANCH_ADMIN', 'ACADEMIC_MANAGER', 'SALES_MANAGER', 'VIEWER',
  'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT',
]);

// Permissions schema
const ResourcePermissionSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  delete: z.boolean(),
}).partial();

const UserPermissionsSchema = z.object({
  dashboard:    ResourcePermissionSchema.optional(),
  branches:     ResourcePermissionSchema.optional(),
  courses:      ResourcePermissionSchema.optional(),
  classes:      ResourcePermissionSchema.optional(),
  students:     ResourcePermissionSchema.optional(),
  enrollments:  ResourcePermissionSchema.optional(),
  employees:    ResourcePermissionSchema.optional(),
  revenues:     ResourcePermissionSchema.optional(),
  expenses:     ResourcePermissionSchema.optional(),
  withdrawals:  ResourcePermissionSchema.optional(),
  refunds:      ResourcePermissionSchema.optional(),
  debts:        ResourcePermissionSchema.optional(),
  products:     ResourcePermissionSchema.optional(),
  product_sales: ResourcePermissionSchema.optional(),
  reports:      ResourcePermissionSchema.optional(),
  users:        ResourcePermissionSchema.optional(),
  master_courses: ResourcePermissionSchema.optional(),
  events:        ResourcePermissionSchema.optional(),
  rooms:         ResourcePermissionSchema.optional(),
  sessions:      ResourcePermissionSchema.optional(),
  timetable:     ResourcePermissionSchema.optional(),
  cash:          ResourcePermissionSchema.optional(),
}).optional().nullable();

// Subscription Tiers
const SubscriptionTierSchema = z.enum(['BASIC', 'PROFESSIONAL', 'ENTERPRISE']);

// Subscription Status
const SubscriptionStatusSchema = z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']);

// Enrollment Status
const EnrollmentStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'DROPPED', 'PENDING']);

// Payment Status
const PaymentStatusSchema = z.enum(['PENDING', 'PARTIAL', 'PAID', 'REFUNDED']);

// Payment Mode
const PaymentModeSchema = z.enum(['FULL', 'INSTALLMENTS']);

// Payment Methods
const PaymentMethodSchema = z.enum(['BANK_TRANSFER', 'CASH', 'CREDIT_CARD', 'CHECK']);

// Expense Types and Categories
const ExpenseTypeSchema = z.enum(['FIXED', 'VARIABLE', 'SHARED', 'CAPITAL']);
const ExpenseCategorySchema = z.enum(['SALARIES', 'RENT', 'UTILITIES', 'ELECTRICITY', 'INTERNET', 'WATER', 'MARKETING', 'SUPPLIES', 'EQUIPMENT', 'MAINTENANCE', 'INSURANCE', 'SOFTWARE', 'ADMINISTRATION', 'COGS', 'INVENTORY', 'OTHER']);

// Withdrawal Status
const WithdrawalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

// Withdrawal Category
const WithdrawalCategorySchema = z.enum(['OWNER_DRAW', 'PROFIT_DISTRIBUTION', 'DIVIDEND', 'OTHER']);

// Global Expense Allocation Method
const GlobalExpenseAllocationSchema = z.enum(['PROPORTIONAL', 'EQUAL', 'OVERHEAD']);

// Debt Status
const DebtStatusSchema = z.enum(['ACTIVE', 'PAID', 'OVERDUE', 'CANCELLED']);

// =============================================
// Company Schemas
// =============================================
const CompanySchema = z.object({
  id: UUIDSchema,
  name: z.string(),
  code: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zipCode: z.string().nullable(),
  country: z.string().nullable(),
  taxId: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  industry: z.string().nullable(),
  subscriptionTier: SubscriptionTierSchema,
  subscriptionStatus: SubscriptionStatusSchema,
  subscriptionStartDate: z.string().nullable(),
  subscriptionEndDate: z.string().nullable(),
  maxBranches: z.number(),
  maxUsers: z.number(),
  timezone: z.string(),
  currency: z.string(),
  locale: z.string(),
  isActive: z.boolean(),
  globalExpenseAllocation: GlobalExpenseAllocationSchema.default('OVERHEAD'),
  onboardingCompleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Auth Schemas
// =============================================
const LoginRequestSchema = z.object({
  // Identifier can be either an email address or a phone number.
  // Phone is normalized server-side, so users can enter either local
  // ("01097628565") or international ("201097628565" / "+201097628565") format.
  identifier: z.string().min(3),
  password: z.string().min(6),
});

const RegisterRequestSchema = z.object({
  // Company details
  companyName: z.string().min(1),
  // Industry is hidden in the registration UI but submitted with a default
  // ("Tech Center") so the backend can store it. Optional so future clients
  // that omit it still validate.
  industry: z.string().optional(),

  // User details (becomes company owner/admin)
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  countryCode: z.string().min(1),
  phone: z.string().min(4),

  // reCAPTCHA v3 token captured by the client before submit.
  recaptchaToken: z.string().optional(),
});

const RegisterResponseSchema = z.object({
  email: z.string(),
  message: z.string(),
});

const VerifyEmailRequestSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

const ResendEmailOtpRequestSchema = z.object({
  email: z.string().email(),
});

const ForgotPasswordRequestSchema = z.object({
  email: z.string().email(),
  recaptchaToken: z.string().optional(),
});

const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6),
});

const SafeUserSchema = z.object({
  id: UUIDSchema,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: UserRoleSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema.nullable().optional(),
  branchIds: z.array(UUIDSchema).optional(),
  linkedEmployeeId: UUIDSchema.nullable().optional(),
  permissions: UserPermissionsSchema,
  isActive: z.boolean(),
  countryCode: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  emailVerified: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: SafeUserSchema,
  company: z.object({
    id: UUIDSchema,
    name: z.string(),
    subscriptionTier: SubscriptionTierSchema,
    subscriptionStatus: SubscriptionStatusSchema,
  }).optional(),
});

// =============================================
// User Management Schemas
// =============================================
const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: UserRoleSchema,
  branchId: OptionalUUIDSchema,
  branchIds: z.array(UUIDSchema).optional(),
  linkedEmployeeId: OptionalUUIDSchema,
  permissions: UserPermissionsSchema,
});

const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: UserRoleSchema.optional(),
  branchId: OptionalUUIDSchema,
  branchIds: z.array(UUIDSchema).optional(),
  linkedEmployeeId: OptionalUUIDSchema,
  permissions: UserPermissionsSchema,
  isActive: z.boolean().optional(),
});

const ConvertEmployeeToUserSchema = z.object({
  employeeId: UUIDSchema,
  email: z.string().email(),
  password: z.string().min(6),
  role: UserRoleSchema,
  branchIds: z.array(UUIDSchema).optional(),
  permissions: UserPermissionsSchema,
});

// =============================================
// Student Schemas
// =============================================
const CreateStudentSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().optional(),
  email: z.union([z.string().email(), z.literal('')]).optional(),
  phone: z.string().optional(),
  parentName: z.string(),
  parentPhone: z.string(),
  parentEmail: z.union([z.string().email(), z.literal('')]).optional(),
  address: z.string().optional(),
  branchId: UUIDSchema,
  enrollmentDate: z.string(),
  notes: z.string().optional(),
});

const UpdateStudentSchema = CreateStudentSchema.partial();

const StudentSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  parentName: z.string(),
  parentPhone: z.string(),
  parentEmail: z.string().nullable(),
  address: z.string().nullable(),
  branchId: UUIDSchema,
  isActive: z.boolean(),
  enrollmentDate: z.string(),
  churnDate: z.string().nullable(),
  churnReason: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Branch Schemas
// =============================================
const CreateBranchSchema = z.object({
  name: z.string(),
  code: z.string(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  openingDate: z.string().optional(),
});

const UpdateBranchSchema = CreateBranchSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const BranchSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  name: z.string(),
  code: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  isActive: z.boolean(),
  openingDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Course Schemas
// =============================================
const CreateCourseSchema = z.object({
  branchId: UUIDSchema,
  name: z.string(),
  code: z.string(),
  description: z.string().optional(),
  price: z.number(),
  duration: z.number(),
  maxStudents: z.number().optional(),
  instructorId: OptionalUUIDSchema,
  defaultRoomId: OptionalUUIDSchema,
});

const UpdateCourseSchema = CreateCourseSchema.partial();

// =============================================
// Master Course Schemas
// =============================================
const CreateMasterCourseSchema = z.object({
  branchId: UUIDSchema,
  name: z.string(),
  code: z.string(),
  description: z.string().optional(),
  defaultPrice: z.number(),
  defaultDuration: z.number(),
  defaultMaxStudents: z.number().optional(),
});

const UpdateMasterCourseSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  description: z.string().optional(),
  defaultPrice: z.number().optional(),
  defaultDuration: z.number().optional(),
  defaultMaxStudents: z.number().optional(),
  isActive: z.boolean().optional(),
});

const MasterCourseSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema,
  branchName: z.string().nullable().optional(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  defaultPrice: z.number(),
  defaultDuration: z.number(),
  defaultMaxStudents: z.number().nullable(),
  isActive: z.boolean(),
  linkedCourseCount: z.number().optional(),
  branchCount: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Event Schemas
// =============================================
const EventTypeSchema = z.enum(['TRIP', 'COMPETITION', 'WORKSHOP', 'SEMINAR', 'CAMP', 'OTHER']);
const EventStatusSchema = z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED']);

const CreateEventSchema = z.object({
  branchId: OptionalUUIDSchema,
  name: z.string(),
  code: z.string().optional(),
  eventType: EventTypeSchema.optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: EventStatusSchema.optional(),
  subscriptionPrice: z.number().nullable().optional(),
});

const UpdateEventSchema = CreateEventSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const EventSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema.nullable(),
  name: z.string(),
  code: z.string().nullable(),
  eventType: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: z.string(),
  subscriptionPrice: z.number().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const EventPLSchema = z.object({
  eventId: UUIDSchema,
  revenue: z.number(),
  revenueCount: z.number(),
  expenses: z.number(),
  expenseCount: z.number(),
  refunds: z.number(),
  refundCount: z.number(),
  productRevenue: z.number(),
  productCost: z.number(),
  productMargin: z.number(),
  productSaleCount: z.number(),
  netProfit: z.number(),
});

const LinkedCourseSummarySchema = z.object({
  id: UUIDSchema,
  branchId: UUIDSchema.nullable(),
  branchName: z.string().nullable(),
  name: z.string(),
  code: z.string(),
  price: z.number(),
  duration: z.number(),
  maxStudents: z.number().nullable(),
  isActive: z.boolean(),
});

const CourseSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema.nullable(),
  masterCourseId: UUIDSchema.nullable().optional(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  duration: z.number(),
  maxStudents: z.number().nullable(),
  instructorId: UUIDSchema.nullable(),
  isActive: z.boolean(),
  enrollmentCount: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Class Schemas
// =============================================
const ClassTypeSchema = z.enum(['ONLINE', 'OFFLINE']);

const CreateClassSchema = z.object({
  courseId: UUIDSchema,
  // Class branch/company are derived from the linked course. Keep `branchId` optional
  // for backward compatibility with older clients; the server ignores it.
  branchId: OptionalUUIDSchema,
  instructorId: OptionalUUIDSchema,
  name: z.string(),
  code: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  daysOfWeek: z.string().optional(),
  maxStudents: z.number().optional(),
  notes: z.string().optional(),
  type: ClassTypeSchema.optional(),
});

const UpdateClassSchema = z.object({
  instructorId: OptionalUUIDSchema,
  name: z.string().optional(),
  code: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  daysOfWeek: z.string().optional(),
  maxStudents: z.number().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  type: ClassTypeSchema.optional(),
});

const ClassStatusSchema = z.enum(['SCHEDULED', 'IN_PROGRESS', 'DONE']);

const ClassSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  courseId: UUIDSchema,
  branchId: UUIDSchema,
  instructorId: UUIDSchema.nullable(),
  name: z.string(),
  code: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  daysOfWeek: z.string().nullable(),
  maxStudents: z.number().nullable(),
  currentEnrollment: z.number(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  isFinished: z.boolean().optional(),
  finishedAt: z.string().nullable().optional(),
  type: ClassTypeSchema.optional(),
  status: ClassStatusSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Enrollment Schemas
// =============================================
const CreateEnrollmentSchema = z.object({
  studentId: UUIDSchema,
  classId: UUIDSchema,
  courseId: UUIDSchema,
  branchId: UUIDSchema,
  enrollmentDate: z.string(),
  status: EnrollmentStatusSchema,
  originalPrice: z.number(),
  discountPercent: z.number().optional(),
  discountAmount: z.number().optional(),
  finalPrice: z.number(),
  paymentMode: PaymentModeSchema.default('FULL'),
  downPayment: z.number().optional(),
  paymentStatus: PaymentStatusSchema.optional(),
  notes: z.string().optional(),
});

const UpdateEnrollmentSchema = CreateEnrollmentSchema.partial();

const EnrollmentSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  studentId: UUIDSchema,
  classId: UUIDSchema,
  courseId: UUIDSchema,
  branchId: UUIDSchema,
  enrollmentDate: z.string(),
  status: EnrollmentStatusSchema,
  originalPrice: z.number(),
  discountPercent: z.number(),
  discountAmount: z.number(),
  finalPrice: z.number(),
  paymentMode: PaymentModeSchema,
  downPayment: z.number(),
  amountPaid: z.number(),
  paymentStatus: PaymentStatusSchema,
  completionDate: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const EnrollmentPaymentSchema = z.object({
  id: UUIDSchema,
  enrollmentId: UUIDSchema,
  companyId: UUIDSchema,
  amount: z.number(),
  paymentDate: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

const CreateEnrollmentPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string(),
  notes: z.string().optional(),
});

const DueEnrollmentSchema = z.object({
  id: UUIDSchema,
  studentId: UUIDSchema,
  studentName: z.string(),
  courseId: UUIDSchema,
  courseName: z.string(),
  branchId: UUIDSchema,
  branchName: z.string(),
  enrollmentDate: z.string(),
  finalPrice: z.number(),
  amountPaid: z.number(),
  remaining: z.number(),
  paymentStatus: PaymentStatusSchema,
  status: EnrollmentStatusSchema,
  type: z.enum(['ENROLLMENT', 'MASTER_ENROLLMENT']),
});

const RefundSchema = z.object({
  id: UUIDSchema,
  enrollmentId: UUIDSchema.nullable(),
  companyId: UUIDSchema,
  studentId: UUIDSchema.nullable(),
  amount: z.number(),
  refundDate: z.string(),
  type: z.enum(['FULL', 'PARTIAL']),
  reason: z.string().nullable(),
  createdAt: z.string(),
});

const RefundWithDetailsSchema = RefundSchema.extend({
  studentName: z.string().nullable(),
  courseName: z.string().nullable(),
  branchName: z.string().nullable(),
  branchId: UUIDSchema.nullable(),
  eventId: UUIDSchema.nullable().optional(),
  eventName: z.string().nullable().optional(),
  productSaleId: UUIDSchema.nullable().optional(),
  productName: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  source: z.enum(['ENROLLMENT', 'MASTER_ENROLLMENT', 'EVENT', 'PRODUCT_SALE']),
});

const CreateRefundSchema = z.object({
  type: z.enum(['FULL', 'PARTIAL']),
  amount: z.number().positive(),
  refundDate: z.string(),
  reason: z.string().optional(),
});

// =============================================
// Revenue Schemas (Read-only, calculated from enrollments and product sales)
// =============================================
const RevenueItemSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema.nullable(),
  branchName: z.string().nullable(),
  source: z.enum(['ENROLLMENT', 'PRODUCT_SALE', 'MASTER_ENROLLMENT', 'EVENT']),
  sourceId: UUIDSchema,
  studentId: UUIDSchema.nullable(),
  amount: z.number(),
  totalRefunded: z.number(),
  description: z.string(),
  date: z.string(),
  paymentMethod: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  studentName: z.string().nullable(),
  courseName: z.string().nullable(),
  productName: z.string().nullable(),
  eventId: UUIDSchema.nullable(),
  eventName: z.string().nullable(),
  createdAt: z.string(),
});

const RevenueSummarySchema = z.object({
  totalRevenue: z.number(),
  enrollmentRevenue: z.number(),
  productRevenue: z.number(),
  masterRevenue: z.number(),
  eventRevenue: z.number(),
  byBranch: z.array(z.object({
    branchId: z.string(),
    branchName: z.string(),
    revenue: z.number(),
  })),
  byMonth: z.array(z.object({
    month: z.string(),
    revenue: z.number(),
  })),
});

// =============================================
// Expense Schemas
// =============================================
const CreateExpenseSchema = z.object({
  branchId: OptionalUUIDSchema,
  type: ExpenseTypeSchema,
  category: ExpenseCategorySchema,
  amount: z.number(),
  description: z.string().nullish(),
  date: z.string(),
  isRecurring: z.boolean().optional(),
  distributionMethod: z.string().nullish(),
  vendor: z.string().nullish(),
  invoiceNumber: z.string().nullish(),
  notes: z.string().nullish(),
  assetName: z.string().nullish(),
  amortizationMonths: z.number().int().min(1).nullish(),
  eventId: OptionalUUIDSchema,
});

const UpdateExpenseSchema = CreateExpenseSchema.partial();

const ExpenseSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema.nullable(),
  type: ExpenseTypeSchema,
  category: ExpenseCategorySchema,
  amount: z.number(),
  description: z.string().nullable(),
  date: z.string(),
  isRecurring: z.boolean(),
  distributionMethod: z.string().nullable(),
  vendor: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  notes: z.string().nullable(),
  assetName: z.string().nullable(),
  amortizationMonths: z.number().nullable(),
  monthlyAmount: z.number().nullable(),
  bonusAmount: z.number().nullable(),
  discountAmount: z.number().nullable(),
  adjustmentReason: z.string().nullable(),
  eventId: UUIDSchema.nullable().optional(),
  totalPaid: z.number().optional(),
  lastPaymentDate: z.string().nullable().optional(),
  paymentCount: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ExpensePaymentSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  expenseId: UUIDSchema.nullable(),
  branchId: UUIDSchema.nullable(),
  employeeId: UUIDSchema.nullable(),
  eventId: UUIDSchema.nullable(),
  type: ExpenseTypeSchema,
  category: ExpenseCategorySchema,
  amount: z.number(),
  date: z.string(),
  notes: z.string().nullable(),
  vendor: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  bonusAmount: z.number(),
  discountAmount: z.number(),
  adjustmentReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateExpensePaymentSchema = z.object({
  expenseId: OptionalUUIDSchema,
  branchId: OptionalUUIDSchema,
  employeeId: OptionalUUIDSchema,
  eventId: OptionalUUIDSchema,
  type: ExpenseTypeSchema,
  category: ExpenseCategorySchema,
  amount: z.number().positive(),
  date: z.string(),
  notes: z.string().nullish(),
  vendor: z.string().nullish(),
  invoiceNumber: z.string().nullish(),
  bonusAmount: z.number().min(0).optional(),
  discountAmount: z.number().min(0).optional(),
  adjustmentReason: z.string().nullish(),
});

// =============================================
// Employee Schemas
// =============================================
const CreateEmployeeSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  department: z.string().optional(),
  position: z.string().optional(),
  salary: z.number().optional(),
  hireDate: z.string().optional(),
  branchId: OptionalUUIDSchema,
  isGlobal: z.boolean().optional(),
});

const UpdateEmployeeSchema = CreateEmployeeSchema.partial();

const EmployeeSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  department: z.string().nullable(),
  position: z.string().nullable(),
  salary: z.number().nullable(),
  hireDate: z.string().nullable(),
  branchId: UUIDSchema.nullable(),
  isGlobal: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Withdrawal Schemas
// =============================================
const WithdrawalStakeholderSchema = z.object({
  stakeholderName: z.string(),
  stakeholderEmail: z.string().optional(),
  amount: z.number(),
});

const CreateWithdrawalSchema = z.object({
  amount: z.number(),
  stakeholders: z.array(WithdrawalStakeholderSchema),
  withdrawalDate: z.string(),
  reason: z.string(),
  category: WithdrawalCategorySchema,
  paymentMethod: PaymentMethodSchema,
  notes: z.string().optional(),
});

const UpdateWithdrawalSchema = z.object({
  stakeholders: z.array(WithdrawalStakeholderSchema).optional(),
  reason: z.string().optional(),
  category: WithdrawalCategorySchema.optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  notes: z.string().optional(),
});

const WithdrawalSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  amount: z.number(),
  stakeholders: z.array(WithdrawalStakeholderSchema),
  withdrawalDate: z.string(),
  reason: z.string(),
  category: WithdrawalCategorySchema,
  paymentMethod: PaymentMethodSchema,
  approvedBy: z.string(),
  notes: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const WithdrawalSummarySchema = z.object({
  totalWithdrawals: z.number(),
  totalAmount: z.number(),
  byCategory: z.array(z.object({
    category: z.string(),
    amount: z.number(),
    count: z.number(),
  })),
  byStakeholder: z.array(z.object({
    name: z.string(),
    amount: z.number(),
    count: z.number(),
  })),
  withdrawals: z.array(WithdrawalSchema),
});

// Product Category
const ProductCategorySchema = z.enum(['STATIONERY', 'BOOKS', 'ELECTRONICS', 'SUPPLIES', 'MERCHANDISE', 'OTHER']);

// =============================================
// Product Schemas
// =============================================
const CreateProductSchema = z.object({
  name: z.string(),
  code: z.string(),
  description: z.string(),
  category: ProductCategorySchema,
  costPrice: z.number(),
  sellingPrice: z.number(),
  stock: z.number(),
  minStock: z.number(),
  unit: z.string(),
  branchId: UUIDSchema,
  recordStockExpense: z.boolean().optional(),
  purchaseDate: z.string().optional(),
});

const RestockProductSchema = z.object({
  quantity: z.number().int().positive(),
  costPerUnit: z.number().min(0),
  date: z.string().optional(),
  notes: z.string().optional(),
});

const UpdateProductSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  description: z.string().optional(),
  category: ProductCategorySchema.optional(),
  costPrice: z.number().optional(),
  sellingPrice: z.number().optional(),
  stock: z.number().optional(),
  minStock: z.number().optional(),
  unit: z.string().optional(),
  isActive: z.boolean().optional(),
});

const ProductSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  name: z.string(),
  code: z.string(),
  description: z.string(),
  category: ProductCategorySchema,
  costPrice: z.number(),
  sellingPrice: z.number(),
  stock: z.number(),
  minStock: z.number(),
  unit: z.string(),
  branchId: UUIDSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Product Sale Schemas
// =============================================
const DiscountTypeSchema = z.enum(['NONE', 'PERCENTAGE', 'FIXED_AMOUNT']);

const CreateProductSaleSchema = z.object({
  productId: UUIDSchema,
  branchId: OptionalUUIDSchema,
  quantity: z.number(),
  discountType: DiscountTypeSchema.optional().default('NONE'),
  discountValue: z.number().optional().default(0),
  date: z.string(),
  paymentMethod: PaymentMethodSchema.optional(),
  receiptNumber: z.string().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  notes: z.string().optional(),
  eventId: OptionalUUIDSchema,
});

const ProductSaleSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  productId: UUIDSchema,
  productName: z.string().nullable(),
  branchId: UUIDSchema,
  quantity: z.number(),
  unitPrice: z.number(),
  discountType: z.string(),
  discountValue: z.number(),
  discountAmount: z.number(),
  subtotal: z.number(),
  totalAmount: z.number(),
  saleDate: z.string(),
  paymentMethod: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  notes: z.string().nullable(),
  eventId: UUIDSchema.nullable().optional(),
  totalRefunded: z.number().optional(),
  createdAt: z.string(),
});

// =============================================
// API Contract
// =============================================
export const contract = c.router({
  // Auth routes
  auth: {
    login: {
      method: 'POST',
      path: '/api/auth/login',
      body: LoginRequestSchema,
      responses: {
        200: AuthResponseSchema,
        401: z.object({ message: z.string() }),
        403: z.object({
          message: z.string(),
          code: z.string(),
          email: z.string().optional(),
        }),
      },
    },
    register: {
      method: 'POST',
      path: '/api/auth/register',
      body: RegisterRequestSchema,
      responses: {
        201: RegisterResponseSchema,
        400: z.object({ message: z.string() }),
      },
    },
    verifyEmail: {
      method: 'POST',
      path: '/api/auth/verify-email',
      body: VerifyEmailRequestSchema,
      responses: {
        200: AuthResponseSchema,
        400: z.object({ message: z.string() }),
      },
    },
    resendEmailOtp: {
      method: 'POST',
      path: '/api/auth/resend-email-otp',
      body: ResendEmailOtpRequestSchema,
      responses: {
        200: z.object({ message: z.string() }),
        400: z.object({ message: z.string() }),
      },
    },
    forgotPassword: {
      method: 'POST',
      path: '/api/auth/forgot-password',
      body: ForgotPasswordRequestSchema,
      responses: {
        200: z.object({ message: z.string() }),
        400: z.object({ message: z.string() }),
      },
    },
    resetPassword: {
      method: 'POST',
      path: '/api/auth/reset-password',
      body: ResetPasswordRequestSchema,
      responses: {
        200: z.object({ message: z.string() }),
        400: z.object({ message: z.string() }),
      },
    },
    profile: {
      method: 'GET',
      path: '/api/auth/profile',
      responses: {
        200: SafeUserSchema,
        401: z.object({ message: z.string() }),
      },
      headers: z.object({
        authorization: z.string(),
      }),
    },
  },

  // Students routes
  students: {
    create: {
      method: 'POST',
      path: '/api/students',
      body: CreateStudentSchema,
      responses: {
        201: StudentSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/students',
      query: z.object({
        branchId: OptionalUUIDSchema,
      }),
      responses: {
        200: z.array(StudentSchema),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/students/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: StudentSchema,
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/students/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateStudentSchema,
      responses: {
        200: StudentSchema,
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/students/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Branches routes
  branches: {
    create: {
      method: 'POST',
      path: '/api/branches',
      body: CreateBranchSchema,
      responses: {
        201: BranchSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/branches',
      responses: {
        200: z.array(BranchSchema),
      },
    },
    listActive: {
      method: 'GET',
      path: '/api/branches/active',
      responses: {
        200: z.array(BranchSchema),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/branches/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: BranchSchema,
        404: z.object({ message: z.string() }),
      },
    },
    getStats: {
      method: 'GET',
      path: '/api/branches/:id/stats',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.object({
          courseCount: z.number(),
          studentCount: z.number(),
          classCount: z.number(),
          employeeCount: z.number(),
          totalRevenue: z.number(),
          totalExpenses: z.number(),
          netProfit: z.number(),
          activeEnrollments: z.number(),
        }),
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/branches/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateBranchSchema,
      responses: {
        200: BranchSchema,
        404: z.object({ message: z.string() }),
      },
    },
    getDeletionImpact: {
      method: 'GET',
      path: '/api/branches/:id/deletion-impact',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.object({
          hasFinancials: z.boolean(),
          counts: z.object({
            revenues: z.number(),
            expenses: z.number(),
            expensePayments: z.number(),
            students: z.number(),
            employees: z.number(),
            products: z.number(),
          }),
        }),
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/branches/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({
        studentsHandling: z.enum(['delete', 'deactivate']).optional(),
        employeesHandling: z.enum(['delete', 'deactivate']).optional(),
      }).optional(),
      responses: {
        200: z.object({
          message: z.string(),
          deactivated: z.boolean(),
          counts: z.object({
            revenues: z.number(),
            expenses: z.number(),
            expensePayments: z.number(),
            students: z.number(),
            employees: z.number(),
            products: z.number(),
          }),
        }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Courses routes
  courses: {
    create: {
      method: 'POST',
      path: '/api/courses',
      body: CreateCourseSchema,
      responses: {
        201: CourseSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/courses',
      query: z.object({
        branchId: OptionalUUIDSchema,
      }),
      responses: {
        200: z.array(CourseSchema),
      },
    },
    listActive: {
      method: 'GET',
      path: '/api/courses/active',
      query: z.object({
        branchId: OptionalUUIDSchema,
      }),
      responses: {
        200: z.array(CourseSchema),
      },
    },
    getEnrollments: {
      method: 'GET',
      path: '/api/courses/:id/enrollments',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(z.any()),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: CourseSchema,
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateCourseSchema,
      responses: {
        200: CourseSchema,
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Events routes
  events: {
    create: {
      method: 'POST',
      path: '/api/events',
      body: CreateEventSchema,
      responses: { 201: EventSchema, 400: z.object({ message: z.string() }) },
    },
    list: {
      method: 'GET',
      path: '/api/events',
      query: z.object({
        branchId: OptionalUUIDSchema,
        status: z.string().optional(),
      }),
      responses: { 200: z.array(EventSchema) },
    },
    getById: {
      method: 'GET',
      path: '/api/events/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: EventSchema, 404: z.object({ message: z.string() }) },
    },
    update: {
      method: 'PATCH',
      path: '/api/events/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateEventSchema,
      responses: { 200: EventSchema, 404: z.object({ message: z.string() }) },
    },
    delete: {
      method: 'DELETE',
      path: '/api/events/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: { 200: z.object({ message: z.string() }), 404: z.object({ message: z.string() }) },
    },
    getPL: {
      method: 'GET',
      path: '/api/events/:id/pl',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: EventPLSchema, 404: z.object({ message: z.string() }) },
    },
    listSubscriptions: {
      method: 'GET',
      path: '/api/events/:eventId/subscriptions',
      pathParams: z.object({ eventId: UUIDSchema }),
      responses: { 200: z.array(z.any()), 404: z.object({ message: z.string() }) },
    },
    createSubscription: {
      method: 'POST',
      path: '/api/events/:eventId/subscriptions',
      pathParams: z.object({ eventId: UUIDSchema }),
      body: z.object({
        studentId: OptionalUUIDSchema,
        externalFirstName: z.string().optional(),
        externalLastName: z.string().optional(),
        externalAge: z.number().optional(),
        externalMobile: z.string().optional(),
        amount: z.number(),
        paymentDate: z.string(),
        paymentMethod: z.string().optional(),
        notes: z.string().optional(),
      }),
      responses: {
        201: z.any(),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    deleteSubscription: {
      method: 'DELETE',
      path: '/api/events/subscriptions/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    listExpenses: {
      method: 'GET',
      path: '/api/events/:eventId/expenses',
      pathParams: z.object({ eventId: UUIDSchema }),
      responses: { 200: z.array(z.any()), 404: z.object({ message: z.string() }) },
    },
    listRefunds: {
      method: 'GET',
      path: '/api/events/:eventId/refunds',
      pathParams: z.object({ eventId: UUIDSchema }),
      responses: { 200: z.array(z.any()), 404: z.object({ message: z.string() }) },
    },
    createRefund: {
      method: 'POST',
      path: '/api/events/:eventId/refunds',
      pathParams: z.object({ eventId: UUIDSchema }),
      body: z.object({
        subscriptionId: UUIDSchema,
        amount: z.number(),
        refundDate: z.string(),
        type: z.enum(['FULL', 'PARTIAL']).optional(),
        reason: z.string().optional(),
      }),
      responses: {
        201: z.any(),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Demo leads (public contact form from landing page)
  demoLeads: {
    create: {
      method: 'POST',
      path: '/api/demo-leads',
      body: z.object({
        name: z.string().min(2),
        email: z.string().email(),
        phone: z.string().optional(),
        company: z.string().optional(),
        country: z.string().optional(),
        branchCount: z.number().optional(),
        message: z.string().optional(),
        source: z.string().optional(),
        recaptchaToken: z.string().optional(),
      }),
      responses: {
        201: z.object({ id: UUIDSchema, message: z.string() }),
        400: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/demo-leads',
      responses: {
        200: z.array(z.any()),
        401: z.object({ message: z.string() }),
      },
    },
  },

  // Master courses routes
  masterCourses: {
    create: {
      method: 'POST',
      path: '/api/master-courses',
      body: CreateMasterCourseSchema,
      responses: {
        201: MasterCourseSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/master-courses',
      responses: {
        200: z.array(MasterCourseSchema),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/master-courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: MasterCourseSchema,
        404: z.object({ message: z.string() }),
      },
    },
    getLinkedCourses: {
      method: 'GET',
      path: '/api/master-courses/:id/linked-courses',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(LinkedCourseSummarySchema),
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/master-courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateMasterCourseSchema,
      responses: {
        200: MasterCourseSchema,
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/master-courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    addCourse: {
      method: 'POST',
      path: '/api/master-courses/:id/courses',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ courseId: UUIDSchema }),
      responses: {
        200: z.object({ message: z.string() }),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    removeCourse: {
      method: 'DELETE',
      path: '/api/master-courses/:id/courses/:courseId',
      pathParams: z.object({ id: UUIDSchema, courseId: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    availableCourses: {
      method: 'GET',
      path: '/api/master-courses/:id/available-courses',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(z.any()),
        404: z.object({ message: z.string() }),
      },
    },
    listEnrollments: {
      method: 'GET',
      path: '/api/master-courses/:id/enrollments',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: z.array(z.any()) },
    },
  },

  // Master enrollments (student bought a bundle).
  // Ordering matters: more-specific paths MUST come before `/:id`.
  masterEnrollments: {
    coverageCheck: {
      method: 'GET',
      path: '/api/master-enrollments/coverage',
      query: z.object({ studentId: UUIDSchema, courseId: UUIDSchema }),
      responses: { 200: z.any() },
    },
    listByStudent: {
      method: 'GET',
      path: '/api/master-enrollments/by-student/:studentId',
      pathParams: z.object({ studentId: UUIDSchema }),
      responses: { 200: z.array(z.any()) },
    },
    list: {
      method: 'GET',
      path: '/api/master-enrollments',
      query: z.object({
        status: z.string().optional(),
        branchId: OptionalUUIDSchema,
        studentId: OptionalUUIDSchema,
      }),
      responses: { 200: z.array(z.any()) },
    },
    create: {
      method: 'POST',
      path: '/api/master-enrollments',
      body: z.object({
        studentId: UUIDSchema,
        masterCourseId: UUIDSchema,
        enrollmentDate: z.string(),
        originalPrice: z.number().optional(),
        discountPercent: z.number().optional(),
        discountAmount: z.number().optional(),
        finalPrice: z.number().optional(),
        paymentMode: z.enum(['FULL', 'INSTALLMENTS']).optional(),
        downPayment: z.number().optional(),
        amountPaid: z.number().optional(),
        paymentMethod: z.string().optional(),
        notes: z.string().optional(),
      }),
      responses: {
        201: z.any(),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    cancel: {
      method: 'POST',
      path: '/api/master-enrollments/:id/cancel',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    getPayments: {
      method: 'GET',
      path: '/api/master-enrollments/:id/payments',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: z.array(z.any()), 404: z.object({ message: z.string() }) },
    },
    addPayment: {
      method: 'POST',
      path: '/api/master-enrollments/:id/payments',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({
        amount: z.number(),
        paymentDate: z.string(),
        notes: z.string().optional(),
      }),
      responses: {
        201: z.any(),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    createRefund: {
      method: 'POST',
      path: '/api/master-enrollments/:id/refunds',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({
        type: z.enum(['FULL', 'PARTIAL']),
        amount: z.number(),
        refundDate: z.string(),
        reason: z.string().optional(),
      }),
      responses: {
        201: z.any(),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    listRefunds: {
      method: 'GET',
      path: '/api/master-enrollments/:id/refunds',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: z.array(z.any()), 404: z.object({ message: z.string() }) },
    },
    getById: {
      method: 'GET',
      path: '/api/master-enrollments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: z.any(), 404: z.object({ message: z.string() }) },
    },
  },

  // Classes routes
  classes: {
    create: {
      method: 'POST',
      path: '/api/classes',
      body: CreateClassSchema,
      responses: {
        201: ClassSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/classes',
      query: z.object({
        courseId: OptionalUUIDSchema,
        branchId: OptionalUUIDSchema,
        instructorId: OptionalUUIDSchema,
      }),
      responses: {
        200: z.array(ClassSchema),
      },
    },
    listActive: {
      method: 'GET',
      path: '/api/classes/active',
      query: z.object({
        courseId: OptionalUUIDSchema,
        branchId: OptionalUUIDSchema,
      }),
      responses: {
        200: z.array(ClassSchema),
      },
    },
    checkTeacherAvailability: {
      method: 'GET',
      path: '/api/classes/check-teacher-availability',
      query: z.object({
        instructorId: UUIDSchema,
        startDate: z.string(),
        endDate: z.string(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        daysOfWeek: z.string().optional(),
        excludeClassId: OptionalUUIDSchema,
      }),
      responses: {
        200: z.object({
          available: z.boolean(),
          conflicts: z.array(z.object({
            id: UUIDSchema,
            name: z.string(),
            code: z.string(),
            daysOfWeek: z.string().nullable(),
            startTime: z.string().nullable(),
            endTime: z.string().nullable(),
            startDate: z.string(),
            endDate: z.string(),
          })),
        }),
        400: z.object({ message: z.string() }),
      },
    },
    getEnrollments: {
      method: 'GET',
      path: '/api/classes/:id/enrollments',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(z.object({
          enrollmentId: UUIDSchema,
          studentId: UUIDSchema,
          studentFirstName: z.string(),
          studentLastName: z.string(),
          enrollmentDate: z.string(),
          status: EnrollmentStatusSchema,
          paymentMode: PaymentModeSchema,
          originalPrice: z.number(),
          discountPercent: z.number(),
          discountAmount: z.number(),
          finalPrice: z.number(),
          downPayment: z.number(),
          amountPaid: z.number(),
          paymentStatus: PaymentStatusSchema,
          notes: z.string().nullable(),
          createdAt: z.string(),
        })),
        404: z.object({ message: z.string() }),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/classes/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: ClassSchema,
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/classes/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateClassSchema,
      responses: {
        200: ClassSchema,
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/classes/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    finish: {
      method: 'POST',
      path: '/api/classes/:id/finish',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ClassSchema,
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Master class enrollments (joining a class within a bundle)
  masterClassEnrollments: {
    create: {
      method: 'POST' as const,
      path: '/api/master-class-enrollments',
      body: z.object({
        masterEnrollmentId: UUIDSchema,
        classId: UUIDSchema,
        courseId: UUIDSchema,
        branchId: UUIDSchema,
        enrolledAt: z.string().optional(),
        notes: z.string().optional(),
      }),
      responses: {
        201: z.any(),
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    listByMasterEnrollment: {
      method: 'GET' as const,
      path: '/api/master-class-enrollments',
      query: z.object({ masterEnrollmentId: UUIDSchema }),
      responses: {
        200: z.array(z.any()),
        403: z.object({ message: z.string() }),
      },
    },
    updateStatus: {
      method: 'PATCH' as const,
      path: '/api/master-class-enrollments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({
        status: z.enum(['ACTIVE', 'COMPLETED', 'DROPPED']),
        notes: z.string().optional(),
      }),
      responses: {
        200: z.any(),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Enrollments routes
  enrollments: {
    create: {
      method: 'POST',
      path: '/api/enrollments',
      body: CreateEnrollmentSchema,
      responses: {
        201: EnrollmentSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/enrollments',
      query: z.object({
        studentId: OptionalUUIDSchema,
        courseId: OptionalUUIDSchema,
        branchId: OptionalUUIDSchema,
        status: z.string().optional(),
      }),
      responses: {
        200: z.array(EnrollmentSchema),
      },
    },
    listDues: {
      method: 'GET',
      path: '/api/dues',
      query: z.object({
        branchId: OptionalUUIDSchema,
      }),
      responses: {
        200: z.array(DueEnrollmentSchema),
      },
    },
    listRefunds: {
      method: 'GET',
      path: '/api/refunds',
      query: z.object({
        branchId: OptionalUUIDSchema,
        studentId: OptionalUUIDSchema,
        type: z.enum(['FULL', 'PARTIAL']).optional(),
        source: z.enum(['ENROLLMENT', 'MASTER_ENROLLMENT', 'EVENT', 'PRODUCT_SALE', 'ALL']).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: z.array(RefundWithDetailsSchema),
      },
    },
    getRefunds: {
      method: 'GET',
      path: '/api/enrollments/:id/refunds',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(RefundSchema),
        404: z.object({ message: z.string() }),
      },
    },
    createRefund: {
      method: 'POST',
      path: '/api/enrollments/:id/refunds',
      pathParams: z.object({ id: UUIDSchema }),
      body: CreateRefundSchema,
      responses: {
        201: RefundSchema,
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    getPayments: {
      method: 'GET',
      path: '/api/enrollments/:id/payments',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(EnrollmentPaymentSchema),
        404: z.object({ message: z.string() }),
      },
    },
    addPayment: {
      method: 'POST',
      path: '/api/enrollments/:id/payments',
      pathParams: z.object({ id: UUIDSchema }),
      body: CreateEnrollmentPaymentSchema,
      responses: {
        201: EnrollmentPaymentSchema,
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/enrollments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: EnrollmentSchema,
        404: z.object({ message: z.string() }),
      },
    },
    getByStudent: {
      method: 'GET',
      path: '/api/enrollments/student/:studentId',
      pathParams: z.object({ studentId: UUIDSchema }),
      responses: {
        200: z.array(EnrollmentSchema),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/enrollments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateEnrollmentSchema,
      responses: {
        200: EnrollmentSchema,
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/enrollments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Revenues routes (Read-only - calculated from enrollments and product sales)
  revenues: {
    list: {
      method: 'GET',
      path: '/api/revenues',
      query: z.object({
        branchId: UUIDSchema.optional(),
        source: z.enum(['ENROLLMENT', 'PRODUCT_SALE', 'MASTER_ENROLLMENT', 'EVENT', 'ALL']).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: z.array(RevenueItemSchema),
      },
    },
    summary: {
      method: 'GET',
      path: '/api/revenues/summary',
      query: z.object({
        branchId: UUIDSchema.optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: RevenueSummarySchema,
      },
    },
  },

  // Expenses routes
  expenses: {
    create: {
      method: 'POST',
      path: '/api/expenses',
      body: CreateExpenseSchema,
      responses: {
        201: ExpenseSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/expenses',
      query: z.object({
        branchId: UUIDSchema.optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        isRecurring: z.string().optional(),
        category: z.string().optional(),
        type: z.string().optional(),
      }),
      responses: {
        200: z.array(ExpenseSchema),
      },
    },
    getDue: {
      method: 'GET',
      path: '/api/expenses/due',
      query: z.object({ month: z.string().optional() }),
      responses: {
        200: z.object({
          items: z.array(z.object({
            id: z.string(),
            type: z.enum(['recurring', 'salary']),
            label: z.string(),
            amount: z.number(),
            category: z.string(),
            branchId: z.string().nullable(),
            branchName: z.string().nullable(),
            templateId: z.string().nullable(),
            employeeId: z.string().nullable(),
          })),
          totalDue: z.number(),
          month: z.string(),
        }),
      },
    },
    paySalaries: {
      method: 'POST',
      path: '/api/expenses/pay-salaries',
      body: z.object({ date: z.string().optional(), branchId: UUIDSchema.optional() }),
      responses: {
        201: z.object({
          created: z.number(),
          skipped: z.number(),
          skippedNames: z.array(z.string()),
          payments: z.array(z.any()),
          message: z.string(),
        }),
        400: z.object({ message: z.string() }),
      },
    },
    payEmployeeSalary: {
      method: 'POST',
      path: '/api/expenses/pay-employee/:employeeId',
      pathParams: z.object({ employeeId: UUIDSchema }),
      body: z.object({
        date: z.string().optional(),
        bonusAmount: z.number().min(0).optional(),
        discountAmount: z.number().min(0).optional(),
        adjustmentReason: z.string().optional(),
      }),
      responses: {
        201: ExpensePaymentSchema,
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    getEmployeeSalaryHistory: {
      method: 'GET',
      path: '/api/expenses/employee/:employeeId/salary-history',
      pathParams: z.object({ employeeId: UUIDSchema }),
      responses: {
        200: z.array(ExpensePaymentSchema),
        404: z.object({ message: z.string() }),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/expenses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: ExpenseSchema,
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/expenses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateExpenseSchema,
      responses: {
        200: ExpenseSchema,
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/expenses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    payRecurring: {
      method: 'POST',
      path: '/api/expenses/:id/pay',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ date: z.string().optional() }),
      responses: {
        201: ExpensePaymentSchema,
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    getPayments: {
      method: 'GET',
      path: '/api/expenses/:id/payments',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(ExpensePaymentSchema),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Installments routes
  installments: {
    create: {
      method: 'POST',
      path: '/api/installments',
      body: z.object({
        branchId: OptionalUUIDSchema,
        name: z.string().min(1),
        description: z.string().optional(),
        type: ExpenseTypeSchema.optional(),
        category: ExpenseCategorySchema,
        totalAmount: z.number().positive(),
        downpaymentAmount: z.number().min(0).optional(),
        monthsCount: z.number().int().min(1),
        startDate: z.string(),
        vendor: z.string().optional(),
        invoiceNumber: z.string().optional(),
        notes: z.string().optional(),
      }),
      responses: {
        201: z.object({
          plan: z.any(),
          schedule: z.array(z.any()),
          downpaymentPayment: z.any().nullable(),
        }),
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/installments',
      query: z.object({
        branchId: UUIDSchema.optional(),
        status: z.string().optional(),
      }),
      responses: {
        200: z.array(z.any()),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/installments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.object({
          plan: z.any(),
          schedule: z.array(z.any()),
          downpaymentPayment: z.any().nullable(),
        }),
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/installments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    pay: {
      method: 'POST',
      path: '/api/installments/:id/schedule/:scheduleId/pay',
      pathParams: z.object({ id: UUIDSchema, scheduleId: UUIDSchema }),
      body: z.object({
        date: z.string().optional(),
        amount: z.number().positive().optional(),
        notes: z.string().optional(),
      }),
      responses: {
        201: z.object({ payment: z.any(), schedule: z.any() }),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    unpay: {
      method: 'DELETE',
      path: '/api/installments/:id/schedule/:scheduleId/pay',
      pathParams: z.object({ id: UUIDSchema, scheduleId: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Expense Payments routes
  expensePayments: {
    create: {
      method: 'POST',
      path: '/api/expense-payments',
      body: CreateExpensePaymentSchema,
      responses: {
        201: ExpensePaymentSchema,
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/expense-payments',
      query: z.object({
        expenseId: UUIDSchema.optional(),
        branchId: UUIDSchema.optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        category: z.string().optional(),
      }),
      responses: {
        200: z.array(ExpensePaymentSchema),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/expense-payments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: ExpensePaymentSchema,
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/expense-payments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Analytics routes
  analytics: {
    dashboard: {
      method: 'GET',
      path: '/api/analytics/dashboard',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: z.object({
          companyWideSummary: z.any(),
          branchSummaries: z.array(z.any()),
          revenueByMonth: z.array(z.any()),
          expensesByCategory: z.array(z.any()),
          topPerformingBranches: z.array(z.any()),
          period: z.object({
            startDate: z.string(),
            endDate: z.string(),
          }),
        }),
      },
    },
  },

  // Companies routes
  companies: {
    getSettings: {
      method: 'GET' as const,
      path: '/api/companies/settings',
      responses: {
        200: z.object({
          id: UUIDSchema,
          name: z.string(),
          globalExpenseAllocation: GlobalExpenseAllocationSchema,
        }),
        401: z.object({ message: z.string() }),
      },
    },
    updateSettings: {
      method: 'PATCH' as const,
      path: '/api/companies/settings',
      body: z.object({
        globalExpenseAllocation: GlobalExpenseAllocationSchema.optional(),
      }),
      responses: {
        200: z.object({
          id: UUIDSchema,
          name: z.string(),
          globalExpenseAllocation: GlobalExpenseAllocationSchema,
        }),
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
      },
    },
  },

  // Employees routes
  employees: {
    create: {
      method: 'POST',
      path: '/api/employees',
      body: CreateEmployeeSchema,
      responses: {
        201: EmployeeSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/employees',
      query: z.object({
        branchId: UUIDSchema.optional(),
        isGlobal: z.string().optional(),
      }),
      responses: {
        200: z.array(EmployeeSchema),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/employees/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: EmployeeSchema,
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/employees/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateEmployeeSchema,
      responses: {
        200: EmployeeSchema,
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/employees/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        400: z.object({
          message: z.string(),
          assignedClasses: z.array(z.object({
            id: UUIDSchema,
            name: z.string(),
            code: z.string(),
          })).optional(),
        }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Withdrawals routes
  withdrawals: {
    create: {
      method: 'POST',
      path: '/api/withdrawals',
      body: CreateWithdrawalSchema,
      responses: {
        201: WithdrawalSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/withdrawals',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: z.array(WithdrawalSchema),
      },
    },
    summary: {
      method: 'GET',
      path: '/api/withdrawals/summary',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: WithdrawalSummarySchema,
      },
    },
    getByStakeholder: {
      method: 'GET',
      path: '/api/withdrawals/stakeholder/:stakeholderName',
      pathParams: z.object({ stakeholderName: z.string() }),
      responses: {
        200: z.array(WithdrawalSchema),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/withdrawals/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: WithdrawalSchema,
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/withdrawals/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateWithdrawalSchema,
      responses: {
        200: WithdrawalSchema,
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/withdrawals/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Products routes
  products: {
    create: {
      method: 'POST',
      path: '/api/products',
      body: CreateProductSchema,
      responses: {
        201: ProductSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/products',
      query: z.object({
        branchId: OptionalUUIDSchema,
      }),
      responses: {
        200: z.array(ProductSchema),
      },
    },
    getAvailable: {
      method: 'GET',
      path: '/api/products/available/:branchId',
      pathParams: z.object({ branchId: UUIDSchema }),
      responses: {
        200: z.array(ProductSchema),
      },
    },
    getLowStock: {
      method: 'GET',
      path: '/api/products/low-stock',
      query: z.object({
        branchId: OptionalUUIDSchema,
      }),
      responses: {
        200: z.array(ProductSchema),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/products/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: ProductSchema,
        404: z.object({ message: z.string() }),
      },
    },
    adjustStock: {
      method: 'PATCH',
      path: '/api/products/:id/stock',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({
        quantity: z.number(),
        operation: z.enum(['add', 'subtract']),
      }),
      responses: {
        200: ProductSchema,
        404: z.object({ message: z.string() }),
      },
    },
    restock: {
      method: 'POST',
      path: '/api/products/:id/restock',
      pathParams: z.object({ id: UUIDSchema }),
      body: RestockProductSchema,
      responses: {
        200: ProductSchema,
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/products/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateProductSchema,
      responses: {
        200: ProductSchema,
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/products/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Product Sales routes
  productSales: {
    create: {
      method: 'POST',
      path: '/api/product-sales',
      body: CreateProductSaleSchema,
      responses: {
        201: ProductSaleSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/product-sales',
      query: z.object({
        branchId: OptionalUUIDSchema,
        productId: OptionalUUIDSchema,
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: z.array(ProductSaleSchema),
      },
    },
    summary: {
      method: 'GET',
      path: '/api/product-sales/summary',
      query: z.object({
        branchId: UUIDSchema.optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: z.object({
          totalSales: z.number(),
          totalQuantity: z.number(),
          totalRevenue: z.number(),
          byProduct: z.array(z.object({
            productId: z.string(),
            productName: z.string(),
            quantity: z.number(),
            revenue: z.number(),
          })),
        }),
      },
    },
    topProducts: {
      method: 'GET',
      path: '/api/product-sales/top-products',
      query: z.object({
        branchId: UUIDSchema.optional(),
        limit: z.string().optional(),
      }),
      responses: {
        200: z.array(z.object({
          productId: z.string(),
          productName: z.string(),
          productCode: z.string(),
          quantity: z.number(),
        })),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/product-sales/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: ProductSaleSchema,
        404: z.object({ message: z.string() }),
      },
    },
    listRefunds: {
      method: 'GET',
      path: '/api/product-sales/:id/refunds',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(RefundSchema),
        404: z.object({ message: z.string() }),
      },
    },
    createRefund: {
      method: 'POST',
      path: '/api/product-sales/:id/refunds',
      pathParams: z.object({ id: UUIDSchema }),
      body: CreateRefundSchema,
      responses: {
        201: RefundSchema,
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Debts routes
  debts: {
    create: {
      method: 'POST',
      path: '/api/debts',
      body: z.object({
        debtType: z.string(),
        creditorName: z.string(),
        principalAmount: z.number(),
        interestRate: z.number(),
        takenDate: z.string(),
        dueDate: z.string(),
        branchId: OptionalUUIDSchema,
        notes: z.string().optional(),
      }),
      responses: {
        201: z.any(),
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/debts',
      query: z.object({
        status: z.string().optional(),
      }),
      responses: {
        200: z.array(z.any()),
      },
    },
    summary: {
      method: 'GET',
      path: '/api/debts/summary',
      responses: {
        200: z.object({
          totalOutstanding: z.number(),
          totalBorrowed: z.number(),
          totalInterestPaid: z.number(),
          activeDebtsCount: z.number(),
          debts: z.array(z.any()),
        }),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/debts/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.any(),
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/debts/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.any(),
      responses: {
        200: z.any(),
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/debts/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.any(),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Cash routes
  cash: {
    current: {
      method: 'GET',
      path: '/api/cash/current',
      responses: {
        200: z.object({
          totalCash: z.number(),
          baseCash: z.number().optional(),
          adjustmentsTotal: z.number().optional(),
          unallocatedAdjustments: z.number().optional(),
          unallocatedRevenue: z.number().optional(),
          unallocatedExpenses: z.number().optional(),
          unallocatedNet: z.number().optional(),
          sumBranchCash: z.number().optional(),
          byBranch: z.array(z.object({
            branchId: UUIDSchema,
            branchName: z.string(),
            baseCash: z.number().optional(),
            branchAdjustments: z.number().optional(),
            distributedAdjustments: z.number().optional(),
            cash: z.number(),
          })),
        }),
      },
    },
    state: {
      method: 'GET',
      path: '/api/cash/state',
      responses: {
        200: z.any(),
      },
    },
    listAdjustments: {
      method: 'GET',
      path: '/api/cash/adjustments',
      query: z.object({
        branchId: z.string().optional(),
      }),
      responses: {
        200: z.array(z.object({
          id: UUIDSchema,
          companyId: UUIDSchema,
          branchId: UUIDSchema.nullable(),
          branchName: z.string().nullable(),
          type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT']),
          amount: z.number(),
          observedAmount: z.number().nullable(),
          systemAmount: z.number().nullable(),
          date: z.string(),
          notes: z.string().nullable(),
          createdByUserId: UUIDSchema.nullable(),
          createdAt: z.string(),
        })),
      },
    },
    adjust: {
      method: 'POST',
      path: '/api/cash/adjust',
      body: z.object({
        type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT']),
        branchId: OptionalUUIDSchema,
        amount: z.number().optional(),
        observedAmount: z.number().optional(),
        date: z.string().optional(),
        notes: z.string().optional().nullable(),
      }),
      responses: {
        201: z.any(),
        400: z.object({ message: z.string() }),
      },
    },
    deleteAdjustment: {
      method: 'DELETE',
      path: '/api/cash/adjustments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string(), id: UUIDSchema }),
        404: z.object({ message: z.string() }),
      },
    },
    flow: {
      method: 'GET',
      path: '/api/cash/flow',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: z.array(z.any()),
      },
    },
  },

  // Reports routes (chart data, read-only)
  reports: {
    monthlyPL: {
      method: 'GET',
      path: '/api/reports/monthly-pl',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        branchId: OptionalUUIDSchema,
      }),
      responses: { 200: z.array(z.any()) },
    },
    salaryGrowth: {
      method: 'GET',
      path: '/api/reports/salary-growth',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        branchId: OptionalUUIDSchema,
      }),
      responses: { 200: z.array(z.any()) },
    },
    topCourses: {
      method: 'GET',
      path: '/api/reports/top-courses',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        branchId: OptionalUUIDSchema,
      }),
      responses: { 200: z.array(z.any()) },
    },
    studentsOverTime: {
      method: 'GET',
      path: '/api/reports/students-over-time',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        branchId: OptionalUUIDSchema,
      }),
      responses: { 200: z.array(z.any()) },
    },
    studentChurn: {
      method: 'GET',
      path: '/api/reports/student-churn',
      query: z.object({
        branchId: OptionalUUIDSchema,
        inactiveMonths: z.string().optional(),
      }),
      responses: { 200: z.any() },
    },
    profitByCourse: {
      method: 'GET',
      path: '/api/reports/profit-by-course',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        branchId: OptionalUUIDSchema,
      }),
      responses: { 200: z.array(z.any()) },
    },
    profitByBranch: {
      method: 'GET',
      path: '/api/reports/profit-by-branch',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: { 200: z.array(z.any()) },
    },
    profitByProduct: {
      method: 'GET',
      path: '/api/reports/profit-by-product',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        branchId: OptionalUUIDSchema,
      }),
      responses: { 200: z.array(z.any()) },
    },
    expensesByCategory: {
      method: 'GET',
      path: '/api/reports/expenses-by-category',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        branchId: OptionalUUIDSchema,
      }),
      responses: { 200: z.array(z.any()) },
    },
    profitByEvent: {
      method: 'GET',
      path: '/api/reports/profit-by-event',
      query: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        branchId: OptionalUUIDSchema,
      }),
      responses: { 200: z.array(z.any()) },
    },
  },

  // Debug routes (development only)
  debug: {
    checkClassesTable: {
      method: 'GET',
      path: '/api/debug/classes-table',
      responses: {
        200: z.object({
          success: z.boolean(),
          columns: z.any(),
        }),
        500: z.object({
          success: z.boolean(),
          error: z.string(),
        }),
      },
    },
  },

  // Subscription routes
  subscriptions: {
    getMySubscription: {
      method: 'GET',
      path: '/api/subscription',
      responses: {
        200: z.object({
          id: UUIDSchema,
          companyId: UUIDSchema,
          status: z.enum(['TRIAL', 'MONTHLY', 'ANNUAL', 'EXPIRED']),
          price: z.number(),
          trialStartDate: z.string().nullable(),
          trialEndDate: z.string().nullable(),
          subscriptionStartDate: z.string().nullable(),
          subscriptionEndDate: z.string().nullable(),
          notes: z.string().nullable(),
          createdAt: z.string(),
          updatedAt: z.string(),
        }),
        401: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    updateSubscription: {
      method: 'PATCH',
      path: '/api/subscription/:companyId',
      pathParams: z.object({ companyId: UUIDSchema }),
      body: z.object({
        status: z.enum(['TRIAL', 'MONTHLY', 'ANNUAL', 'EXPIRED']).optional(),
        price: z.number().optional(),
        trialStartDate: z.string().nullable().optional(),
        trialEndDate: z.string().nullable().optional(),
        subscriptionStartDate: z.string().nullable().optional(),
        subscriptionEndDate: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
      responses: {
        200: z.object({
          id: UUIDSchema,
          companyId: UUIDSchema,
          status: z.enum(['TRIAL', 'MONTHLY', 'ANNUAL', 'EXPIRED']),
          price: z.number(),
          trialStartDate: z.string().nullable(),
          trialEndDate: z.string().nullable(),
          subscriptionStartDate: z.string().nullable(),
          subscriptionEndDate: z.string().nullable(),
          notes: z.string().nullable(),
          createdAt: z.string(),
          updatedAt: z.string(),
        }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // Migration routes (one-time use)
  migrations: {
    runInstructorMigration: {
      method: 'POST',
      path: '/api/migrations/add-instructor',
      body: z.object({}).optional(),
      responses: {
        200: z.object({
          success: z.boolean(),
          message: z.string(),
          verification: z.any().optional(),
        }),
        500: z.object({
          success: z.boolean(),
          message: z.string(),
          error: z.string().optional(),
        }),
      },
    },
    runClassesInstructorMigration: {
      method: 'POST',
      path: '/api/migrations/add-instructor-to-classes',
      body: z.object({}).optional(),
      responses: {
        200: z.object({
          success: z.boolean(),
          message: z.string(),
          verification: z.any().optional(),
        }),
        500: z.object({
          success: z.boolean(),
          message: z.string(),
          error: z.string().optional(),
        }),
      },
    },
    updateClassesTableStructure: {
      method: 'POST',
      path: '/api/migrations/update-classes-structure',
      body: z.object({}).optional(),
      responses: {
        200: z.object({
          success: z.boolean(),
          message: z.string(),
          addedColumns: z.array(z.string()).optional(),
        }),
        500: z.object({
          success: z.boolean(),
          message: z.string(),
          error: z.string().optional(),
        }),
      },
    },
    updateProductsTableStructure: {
      method: 'POST',
      path: '/api/migrations/update-products-structure',
      body: z.object({}).optional(),
      responses: {
        200: z.object({
          success: z.boolean(),
          message: z.string(),
          updatedColumns: z.any().optional(),
        }),
        500: z.object({
          success: z.boolean(),
          message: z.string(),
          error: z.string().optional(),
        }),
      },
    },
    runRbacMigration: {
      method: 'POST',
      path: '/api/migrations/run-rbac',
      body: z.object({}).optional(),
      responses: {
        200: z.object({
          success: z.boolean(),
          message: z.string(),
        }),
        500: z.object({
          success: z.boolean(),
          message: z.string(),
          error: z.string().optional(),
        }),
      },
    },
    createMasterClassEnrollments: {
      method: 'POST',
      path: '/api/migrations/create-master-class-enrollments',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    createExpensePaymentsTable: {
      method: 'POST',
      path: '/api/migrations/create-expense-payments-table',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string(), migratedCount: z.number().optional() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    cleanupOrphanedPayments: {
      method: 'POST',
      path: '/api/migrations/cleanup-orphaned-payments',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string(), deletedCount: z.number() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    clearAdminPermissions: {
      method: 'POST',
      path: '/api/migrations/clear-admin-permissions',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string(), clearedCount: z.number() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    createSessionAttendanceTable: {
      method: 'POST',
      path: '/api/migrations/create-session-attendance-table',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    createInstallmentTables: {
      method: 'POST',
      path: '/api/migrations/create-installment-tables',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    addRefundSubscriptionLink: {
      method: 'POST',
      path: '/api/migrations/add-refund-subscription-link',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    fixEventSubscriptionStudentFk: {
      method: 'POST',
      path: '/api/migrations/fix-event-subscription-student-fk',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    addEventSubscriptionPrice: {
      method: 'POST',
      path: '/api/migrations/add-event-subscription-price',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    addProductSaleRefundLink: {
      method: 'POST',
      path: '/api/migrations/add-product-sale-refund-link',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    createSessionTeacherAttendanceTable: {
      method: 'POST',
      path: '/api/migrations/create-session-teacher-attendance-table',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    mergePermissions: {
      method: 'POST',
      path: '/api/migrations/merge-permissions',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string(), mergedCount: z.number() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    createEventFeatureTables: {
      method: 'POST',
      path: '/api/migrations/create-event-feature-tables',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    runPhoneAuthMigration: {
      method: 'POST',
      path: '/api/migrations/add-phone-auth',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    runEmailVerificationMigration: {
      method: 'POST',
      path: '/api/migrations/email-verification',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
  },

  // ============================================================
  // Users Management
  // ============================================================
  users: {
    list: {
      method: 'GET',
      path: '/api/users',
      query: z.object({
        branchId: z.string().optional(),
        role: z.string().optional(),
        isActive: z.preprocess(
          (v) => v === 'true' ? true : v === 'false' ? false : undefined,
          z.boolean().optional()
        ),
      }),
      responses: {
        200: z.object({ users: z.array(SafeUserSchema) }),
        403: z.object({ message: z.string() }),
      },
    },
    get: {
      method: 'GET',
      path: '/api/users/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: SafeUserSchema,
        404: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
      },
    },
    create: {
      method: 'POST',
      path: '/api/users',
      body: CreateUserSchema,
      responses: {
        201: SafeUserSchema,
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/users/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateUserSchema,
      responses: {
        200: SafeUserSchema,
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    updatePermissions: {
      method: 'PATCH',
      path: '/api/users/:id/permissions',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ permissions: UserPermissionsSchema }),
      responses: {
        200: z.object({ message: z.string(), permissions: UserPermissionsSchema }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    resetPassword: {
      method: 'POST',
      path: '/api/users/:id/reset-password',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ password: z.string().min(6) }),
      responses: {
        200: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    deactivate: {
      method: 'POST',
      path: '/api/users/:id/deactivate',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    activate: {
      method: 'POST',
      path: '/api/users/:id/activate',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    convertEmployee: {
      method: 'POST',
      path: '/api/users/convert-employee',
      body: ConvertEmployeeToUserSchema,
      responses: {
        201: SafeUserSchema,
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // ============================================================
  // Rooms Management
  // ============================================================
  rooms: {
    create: {
      method: 'POST' as const,
      path: '/api/rooms',
      body: z.object({
        branchId: UUIDSchema,
        code: z.string(),
        description: z.string().optional(),
      }),
      responses: {
        201: z.object({
          id: UUIDSchema,
          companyId: UUIDSchema,
          branchId: UUIDSchema,
          code: z.string(),
          description: z.string().nullable(),
          isActive: z.boolean(),
          createdAt: z.string(),
          updatedAt: z.string(),
        }),
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/rooms',
      query: z.object({
        branchId: z.string().optional(),
      }),
      responses: {
        200: z.array(z.any()),
        403: z.object({ message: z.string() }),
      },
    },
    listActive: {
      method: 'GET' as const,
      path: '/api/rooms/active',
      query: z.object({
        branchId: z.string().optional(),
      }),
      responses: {
        200: z.array(z.any()),
        403: z.object({ message: z.string() }),
      },
    },
    getById: {
      method: 'GET' as const,
      path: '/api/rooms/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.any(),
        404: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/rooms/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({
        code: z.string().optional(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
      responses: {
        200: z.any(),
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/rooms/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
  },

  // ============================================================
  // Attendance Management
  // ============================================================
  attendance: {
    getBySession: {
      method: 'GET' as const,
      path: '/api/attendance/session/:sessionId',
      pathParams: z.object({ sessionId: UUIDSchema }),
      responses: {
        200: z.array(z.object({
          studentId: UUIDSchema,
          studentFirstName: z.string(),
          studentLastName: z.string(),
          isPresent: z.boolean(),
          attendanceId: UUIDSchema.nullable().optional(),
        })),
        401: z.object({ message: z.string() }),
        402: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    saveForSession: {
      method: 'POST' as const,
      path: '/api/attendance/session/:sessionId',
      pathParams: z.object({ sessionId: UUIDSchema }),
      body: z.object({ presentStudentIds: z.array(UUIDSchema) }),
      responses: {
        200: z.object({ message: z.string(), presentCount: z.number() }),
        401: z.object({ message: z.string() }),
        402: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    getByStudent: {
      method: 'GET' as const,
      path: '/api/attendance/student/:studentId',
      pathParams: z.object({ studentId: UUIDSchema }),
      responses: {
        200: z.array(z.object({
          sessionId: UUIDSchema,
          sessionStartDate: z.string(),
          sessionEndDate: z.string().nullable(),
          classId: UUIDSchema,
          className: z.string(),
          classCode: z.string(),
          roomCode: z.string().nullable(),
          isPresent: z.boolean(),
        })),
        401: z.object({ message: z.string() }),
        402: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    getByClass: {
      method: 'GET' as const,
      path: '/api/attendance/class/:classId',
      pathParams: z.object({ classId: UUIDSchema }),
      responses: {
        200: z.array(z.object({
          sessionId: UUIDSchema,
          sessionStartDate: z.string(),
          sessionEndDate: z.string().nullable(),
          roomCode: z.string().nullable(),
          totalStudents: z.number(),
          presentCount: z.number(),
          absentCount: z.number(),
        })),
        401: z.object({ message: z.string() }),
        402: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    getTeachersBySession: {
      method: 'GET' as const,
      path: '/api/attendance/teachers/session/:sessionId',
      pathParams: z.object({ sessionId: UUIDSchema }),
      responses: {
        200: z.array(z.object({
          id: UUIDSchema,
          sessionId: UUIDSchema,
          employeeId: UUIDSchema,
          employeeFirstName: z.string(),
          employeeLastName: z.string(),
          employeePosition: z.string().nullable(),
          role: z.enum(['PRIMARY', 'SUBSTITUTE', 'ASSISTANT']),
          status: z.enum(['PRESENT', 'ABSENT']),
          notes: z.string().nullable(),
          createdAt: z.string(),
        })),
        401: z.object({ message: z.string() }),
        402: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    saveTeachersForSession: {
      method: 'POST' as const,
      path: '/api/attendance/teachers/session/:sessionId',
      pathParams: z.object({ sessionId: UUIDSchema }),
      body: z.object({
        teachers: z.array(z.object({
          employeeId: UUIDSchema,
          role: z.enum(['PRIMARY', 'SUBSTITUTE', 'ASSISTANT']),
          status: z.enum(['PRESENT', 'ABSENT']),
          notes: z.string().nullish(),
        })),
      }),
      responses: {
        200: z.object({ message: z.string(), count: z.number() }),
        401: z.object({ message: z.string() }),
        402: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    getTeachersHistory: {
      method: 'GET' as const,
      path: '/api/attendance/teachers',
      query: z.object({
        branchId: UUIDSchema.optional(),
        employeeId: UUIDSchema.optional(),
        classId: UUIDSchema.optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: z.array(z.object({
          id: UUIDSchema,
          sessionId: UUIDSchema,
          employeeId: UUIDSchema,
          employeeFirstName: z.string(),
          employeeLastName: z.string(),
          employeePosition: z.string().nullable(),
          role: z.enum(['PRIMARY', 'SUBSTITUTE', 'ASSISTANT']),
          status: z.enum(['PRESENT', 'ABSENT']),
          notes: z.string().nullable(),
          sessionStartDate: z.string(),
          sessionEndDate: z.string().nullable(),
          durationMinutes: z.number().nullable(),
          branchId: UUIDSchema.nullable(),
          branchName: z.string().nullable(),
          classId: UUIDSchema.nullable(),
          className: z.string().nullable(),
          classCode: z.string().nullable(),
          courseName: z.string().nullable(),
          roomCode: z.string().nullable(),
        })),
        401: z.object({ message: z.string() }),
        402: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
  },

  // ============================================================
  // Sessions Management
  // ============================================================
  sessions: {
    start: {
      method: 'POST' as const,
      path: '/api/sessions/start',
      body: z.object({
        roomId: OptionalUUIDSchema,
        classId: UUIDSchema,
        branchId: UUIDSchema,
        notes: z.string().optional(),
        teachers: z.array(z.object({
          employeeId: UUIDSchema,
          role: z.enum(['PRIMARY', 'SUBSTITUTE', 'ASSISTANT']).optional(),
          status: z.enum(['PRESENT', 'ABSENT']).optional(),
          notes: z.string().nullish(),
        })).optional(),
      }),
      responses: {
        201: z.any(),
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    end: {
      method: 'PATCH' as const,
      path: '/api/sessions/:id/end',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({
        notes: z.string().optional(),
      }),
      responses: {
        200: z.any(),
        400: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/sessions',
      query: z.object({
        branchId: z.string().optional(),
        classId: z.string().optional(),
        roomId: z.string().optional(),
      }),
      responses: {
        200: z.array(z.any()),
        403: z.object({ message: z.string() }),
      },
    },
    listActive: {
      method: 'GET' as const,
      path: '/api/sessions/active',
      query: z.object({
        branchId: z.string().optional(),
      }),
      responses: {
        200: z.array(z.any()),
        403: z.object({ message: z.string() }),
      },
    },
    getById: {
      method: 'GET' as const,
      path: '/api/sessions/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.any(),
        404: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
      },
    },
  },

  // ============================================================
  // Timetable
  // ============================================================
  timetable: {
    getDay: {
      method: 'GET' as const,
      path: '/api/timetable',
      query: z.object({
        date: z.string(),
        branchId: z.string().optional(),
        teacherId: z.string().optional(),
        courseId: z.string().optional(),
      }),
      responses: {
        200: z.object({
          date: z.string(),
          dayOfWeek: z.string(),
          entries: z.array(z.any()),
        }),
        400: z.object({ message: z.string() }),
        401: z.object({ message: z.string() }),
        402: z.object({ message: z.string() }),
        403: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
  },
});

export type Contract = typeof contract;
