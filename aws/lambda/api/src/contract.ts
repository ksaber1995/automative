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
  email: z.string().email(),
  password: z.string().min(6),
});

const RegisterRequestSchema = z.object({
  // Company details
  companyName: z.string().min(1),
  companyEmail: z.string().email(),
  companyCode: z.preprocess((val) => (val === '' || val === null) ? undefined : val, z.string().optional()),

  // User details (becomes company owner/admin)
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.preprocess((val) => (val === '' || val === null) ? undefined : val, z.string().optional()),
});

const RegisterResponseSchema = z.object({
  email: z.string(),
  message: z.string(),
});

const VerifyEmailRequestSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

const ResendOtpRequestSchema = z.object({
  email: z.string().email(),
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
    code: z.string(),
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

const CloneMasterCourseSchema = z.object({
  branchId: UUIDSchema,
  code: z.string().optional(),
});

const MasterCourseSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema.nullable(),
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

const ApplyMasterCourseSchema = z.object({
  applyName: z.boolean().optional(),
  applyDescription: z.boolean().optional(),
  applyPrice: z.boolean().optional(),
  applyDuration: z.boolean().optional(),
  applyMaxStudents: z.boolean().optional(),
});

const InstantiateMasterCourseSchema = z.object({
  branchIds: z.array(UUIDSchema),
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
  budget: z.number().optional(),
  status: EventStatusSchema.optional(),
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
  budget: z.number().nullable(),
  status: z.string(),
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
  budget: z.number().nullable(),
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
const CreateClassSchema = z.object({
  courseId: UUIDSchema,
  branchId: UUIDSchema,
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
});

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
});

const RefundSchema = z.object({
  id: UUIDSchema,
  enrollmentId: UUIDSchema,
  companyId: UUIDSchema,
  studentId: UUIDSchema,
  amount: z.number(),
  refundDate: z.string(),
  type: z.enum(['FULL', 'PARTIAL']),
  reason: z.string().nullable(),
  createdAt: z.string(),
});

const RefundWithDetailsSchema = RefundSchema.extend({
  studentName: z.string(),
  courseName: z.string(),
  branchName: z.string(),
  branchId: UUIDSchema,
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
  branchId: UUIDSchema,
  branchName: z.string(),
  source: z.enum(['ENROLLMENT', 'PRODUCT_SALE']),
  sourceId: UUIDSchema,
  amount: z.number(),
  totalRefunded: z.number(),
  description: z.string(),
  date: z.string(),
  paymentMethod: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  studentName: z.string().nullable(),
  courseName: z.string().nullable(),
  productName: z.string().nullable(),
  createdAt: z.string(),
});

const RevenueSummarySchema = z.object({
  totalRevenue: z.number(),
  enrollmentRevenue: z.number(),
  productRevenue: z.number(),
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
  description: z.string().optional(),
  date: z.string(),
  isRecurring: z.boolean().optional(),
  recurringDay: z.number().optional(),
  distributionMethod: z.string().optional(),
  vendor: z.string().optional(),
  invoiceNumber: z.string().optional(),
  notes: z.string().optional(),
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
  recurringDay: z.number().nullable(),
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
  createdAt: z.string(),
  updatedAt: z.string(),
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
  isGlobal: z.boolean(),
  branchId: OptionalUUIDSchema,
  recordStockExpense: z.boolean().optional(),
  purchaseDate: z.string().optional(),
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
  isGlobal: z.boolean(),
  branchId: UUIDSchema.nullable(),
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
  branchId: UUIDSchema,
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
        403: z.object({ message: z.string(), code: z.string(), email: z.string() }),
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
    resendOtp: {
      method: 'POST',
      path: '/api/auth/resend-otp',
      body: ResendOtpRequestSchema,
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
    delete: {
      method: 'DELETE',
      path: '/api/branches/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string() }),
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
    apply: {
      method: 'POST',
      path: '/api/master-courses/:id/apply',
      pathParams: z.object({ id: UUIDSchema }),
      body: ApplyMasterCourseSchema,
      responses: {
        200: z.object({ updatedCount: z.number(), skippedCount: z.number() }),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    instantiate: {
      method: 'POST',
      path: '/api/master-courses/:id/instantiate',
      pathParams: z.object({ id: UUIDSchema }),
      body: InstantiateMasterCourseSchema,
      responses: {
        201: z.object({
          createdCount: z.number(),
          skippedCount: z.number(),
          created: z.array(z.object({ id: UUIDSchema, branchId: UUIDSchema })),
        }),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    clone: {
      method: 'POST',
      path: '/api/master-courses/:id/clone',
      pathParams: z.object({ id: UUIDSchema }),
      body: CloneMasterCourseSchema,
      responses: {
        201: MasterCourseSchema,
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
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
        source: z.enum(['ENROLLMENT', 'PRODUCT_SALE', 'ALL']).optional(),
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
          expenses: z.array(z.any()),
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
        201: ExpenseSchema,
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
      },
    },
    getEmployeeSalaryHistory: {
      method: 'GET',
      path: '/api/expenses/employee/:employeeId/salary-history',
      pathParams: z.object({ employeeId: UUIDSchema }),
      responses: {
        200: z.array(ExpenseSchema),
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
      body: z.object({}),
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
        201: ExpenseSchema,
        400: z.object({ message: z.string() }),
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
          byBranch: z.array(z.any()),
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
    adjust: {
      method: 'POST',
      path: '/api/cash/adjust',
      body: z.any(),
      responses: {
        200: z.any(),
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

  // Reports routes
  reports: {
    financial: {
      method: 'GET',
      path: '/api/reports/excel/financial',
      query: z.object({
        startDate: z.string(),
        endDate: z.string(),
      }),
      responses: {
        200: z.object({
          data: z.string(), // base64 encoded Excel file
          filename: z.string(),
        }),
        400: z.object({ message: z.string() }),
      },
    },
    financialMonthly: {
      method: 'GET',
      path: '/api/reports/excel/financial-monthly',
      query: z.object({
        startDate: z.string(),
        endDate: z.string(),
      }),
      responses: {
        200: z.object({
          data: z.string(), // base64 encoded Excel file
          filename: z.string(),
        }),
        400: z.object({ message: z.string() }),
      },
    },
    branch: {
      method: 'GET',
      path: '/api/reports/excel/branch/:branchId',
      pathParams: z.object({
        branchId: UUIDSchema,
      }),
      query: z.object({
        startDate: z.string(),
        endDate: z.string(),
      }),
      responses: {
        200: z.object({
          data: z.string(), // base64 encoded Excel file
          filename: z.string(),
        }),
        400: z.object({ message: z.string() }),
      },
    },
    churn: {
      method: 'GET',
      path: '/api/reports/excel/churn',
      query: z.object({
        startDate: z.string(),
        endDate: z.string(),
      }),
      responses: {
        200: z.object({
          data: z.string(), // base64 encoded Excel file
          filename: z.string(),
        }),
        400: z.object({ message: z.string() }),
      },
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
});

export type Contract = typeof contract;
