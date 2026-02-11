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

// Withdrawal Category
const WithdrawalCategorySchema = z.enum(['OWNER_DRAW', 'PROFIT_DISTRIBUTION', 'DIVIDEND', 'OTHER']);

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
  branchId: OptionalUUIDSchema,
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
  managerId: OptionalUUIDSchema,
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
  instructorId: OptionalUUIDSchema,
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
  instructorId: UUIDSchema.nullable(),
  isActive: z.boolean(),
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
// Revenue Schemas (Read-only, calculated from enrollments and product sales)
// =============================================
const RevenueItemSchema = z.object({
  id: UUIDSchema,
  branchId: UUIDSchema,
  branchName: z.string(),
  source: z.enum(['ENROLLMENT', 'PRODUCT_SALE']),
  sourceId: UUIDSchema,
  amount: z.number(),
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
// Employee Schemas
// =============================================
const CreateEmployeeSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email().optional(),
  position: z.string().optional(),
  salary: z.number().optional(),
  branchId: OptionalUUIDSchema,
  isGlobal: z.boolean().optional(),
});

const UpdateEmployeeSchema = CreateEmployeeSchema.partial();

const EmployeeSchema = z.object({
  id: UUIDSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  position: z.string().nullable(),
  salary: z.number().nullable(),
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
const CreateProductSaleSchema = z.object({
  productId: UUIDSchema,
  branchId: UUIDSchema,
  quantity: z.number(),
  unitPrice: z.number(),
  totalAmount: z.number(),
  saleDate: z.string(),
  paymentMethod: PaymentMethodSchema.optional(),
  customerName: z.string().optional(),
  notes: z.string().optional(),
});

const ProductSaleSchema = z.object({
  id: UUIDSchema,
  productId: UUIDSchema,
  branchId: UUIDSchema,
  quantity: z.number(),
  unitPrice: z.number(),
  totalAmount: z.number(),
  saleDate: z.string(),
  paymentMethod: z.string().nullable(),
  customerName: z.string().nullable(),
  notes: z.string().nullable(),
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
    financialMonthly: {
      method: 'GET',
      path: '/api/reports/excel/financial-monthly',
      query: z.object({
        startDate: z.string(),
        endDate: z.string(),
        branchId: UUIDSchema.optional(),
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
  },
});

export type Contract = typeof contract;
