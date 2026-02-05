import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

// =============================================
// Common Schemas
// =============================================
const UUIDSchema = z.string().uuid();
const DateStringSchema = z.string().datetime();

// User Roles
const UserRoleSchema = z.enum(['ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT']);

// Enrollment Status
const EnrollmentStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'DROPPED', 'PENDING']);

// Payment Status
const PaymentStatusSchema = z.enum(['PENDING', 'PARTIAL', 'PAID', 'REFUNDED']);

// Payment Methods
const PaymentMethodSchema = z.enum(['BANK_TRANSFER', 'CASH', 'CREDIT_CARD', 'CHECK']);

// Expense Types and Categories
const ExpenseTypeSchema = z.enum(['FIXED', 'VARIABLE', 'SHARED']);
const ExpenseCategorySchema = z.enum(['SALARIES', 'RENT', 'UTILITIES', 'MARKETING', 'SUPPLIES', 'MAINTENANCE', 'OTHER']);

// Withdrawal Status
const WithdrawalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

// Debt Status
const DebtStatusSchema = z.enum(['ACTIVE', 'PAID', 'OVERDUE', 'CANCELLED']);

// =============================================
// Auth Schemas
// =============================================
const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string(),
  lastName: z.string(),
  role: UserRoleSchema,
  branchId: UUIDSchema.optional(),
});

const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: UUIDSchema,
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    role: UserRoleSchema,
    branchId: UUIDSchema.nullable(),
    isActive: z.boolean(),
  }),
});

// =============================================
// Student Schemas
// =============================================
const CreateStudentSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  parentName: z.string(),
  parentPhone: z.string(),
  parentEmail: z.string().email().optional(),
  address: z.string().optional(),
  branchId: UUIDSchema,
  enrollmentDate: z.string(),
  notes: z.string().optional(),
});

const UpdateStudentSchema = CreateStudentSchema.partial();

const StudentSchema = z.object({
  id: UUIDSchema,
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
  zipCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  managerId: UUIDSchema.optional(),
  openingDate: z.string().optional(),
});

const UpdateBranchSchema = CreateBranchSchema.partial();

const BranchSchema = z.object({
  id: UUIDSchema,
  name: z.string(),
  code: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zipCode: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  managerId: UUIDSchema.nullable(),
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
});

const UpdateCourseSchema = CreateCourseSchema.partial();

const CourseSchema = z.object({
  id: UUIDSchema,
  branchId: UUIDSchema,
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  duration: z.number(),
  maxStudents: z.number().nullable(),
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
  paymentStatus: PaymentStatusSchema,
  notes: z.string().optional(),
});

const UpdateEnrollmentSchema = CreateEnrollmentSchema.partial();

const EnrollmentSchema = z.object({
  id: UUIDSchema,
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
  paymentStatus: PaymentStatusSchema,
  completionDate: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Revenue Schemas
// =============================================
const CreateRevenueSchema = z.object({
  branchId: UUIDSchema,
  courseId: UUIDSchema.optional(),
  enrollmentId: UUIDSchema.optional(),
  studentId: UUIDSchema.optional(),
  amount: z.number(),
  description: z.string().optional(),
  date: z.string(),
  paymentMethod: PaymentMethodSchema.optional(),
  receiptNumber: z.string().optional(),
  notes: z.string().optional(),
});

const UpdateRevenueSchema = CreateRevenueSchema.partial();

const RevenueSchema = z.object({
  id: UUIDSchema,
  branchId: UUIDSchema,
  courseId: UUIDSchema.nullable(),
  enrollmentId: UUIDSchema.nullable(),
  studentId: UUIDSchema.nullable(),
  amount: z.number(),
  description: z.string().nullable(),
  date: z.string(),
  paymentMethod: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Expense Schemas
// =============================================
const CreateExpenseSchema = z.object({
  branchId: UUIDSchema.optional(),
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
});

const UpdateExpenseSchema = CreateExpenseSchema.partial();

const ExpenseSchema = z.object({
  id: UUIDSchema,
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
  createdAt: z.string(),
  updatedAt: z.string(),
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
      },
    },
    register: {
      method: 'POST',
      path: '/api/auth/register',
      body: RegisterRequestSchema,
      responses: {
        201: AuthResponseSchema,
        400: z.object({ message: z.string() }),
      },
    },
    profile: {
      method: 'GET',
      path: '/api/auth/profile',
      responses: {
        200: z.object({
          id: UUIDSchema,
          email: z.string(),
          firstName: z.string(),
          lastName: z.string(),
          role: UserRoleSchema,
          branchId: UUIDSchema.nullable(),
          isActive: z.boolean(),
        }),
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
        branchId: UUIDSchema.optional(),
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
      body: z.object({}),
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
    getById: {
      method: 'GET',
      path: '/api/branches/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: BranchSchema,
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
        branchId: UUIDSchema.optional(),
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
  },

  // Revenues routes
  revenues: {
    create: {
      method: 'POST',
      path: '/api/revenues',
      body: CreateRevenueSchema,
      responses: {
        201: RevenueSchema,
        400: z.object({ message: z.string() }),
      },
    },
    list: {
      method: 'GET',
      path: '/api/revenues',
      query: z.object({
        branchId: UUIDSchema.optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
      responses: {
        200: z.array(RevenueSchema),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/revenues/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: RevenueSchema,
        404: z.object({ message: z.string() }),
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/revenues/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateRevenueSchema,
      responses: {
        200: RevenueSchema,
        404: z.object({ message: z.string() }),
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
      }),
      responses: {
        200: z.array(ExpenseSchema),
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
});

export type Contract = typeof contract;
