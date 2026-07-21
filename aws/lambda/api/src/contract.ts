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

// Standard error envelope. `code` is an i18n key (e.g. `ERRORS.BRANCHES.NOT_FOUND`)
// the frontend translates via ngx-translate. `message` is the English fallback.
const ApiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
});

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
const EnrollmentStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'DROPPED', 'PENDING', 'ON_HOLD']);

// Payment Status
const PaymentStatusSchema = z.enum(['PENDING', 'PARTIAL', 'PAID', 'REFUNDED']);

// Payment Mode
const PaymentModeSchema = z.enum(['FULL', 'INSTALLMENTS', 'MONTHLY_SUBSCRIPTION']);

// Course Payment Type
const CoursePaymentTypeSchema = z.enum(['ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION']);

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

// Student ID card — the shared back face, configured once per company.
// Lengths are capped so a pasted essay can't blow up the rendered card.
// Per-card-set tuning: logo size/offset, photo offset, and the three colours the
// palette is derived from. All optional and all deltas — absent means "the template
// as designed". Bounds mirror CARD_ADJUST_BOUNDS; the renderer clamps again, since
// this schema is the only thing between a client and the stored blob.
const CardAdjustSchema = z.object({
  logoScale: z.number().min(50).max(200),
  logoDx: z.number().min(-120).max(120),
  logoDy: z.number().min(-120).max(120),
  photoDx: z.number().min(-120).max(120),
  photoDy: z.number().min(-120).max(120),
  // '' = keep the template's own colour; otherwise a 6-digit hex.
  bg: z.string().regex(/^(#[0-9a-fA-F]{6})?$/),
  text: z.string().regex(/^(#[0-9a-fA-F]{6})?$/),
  accent: z.string().regex(/^(#[0-9a-fA-F]{6})?$/),
});

// Where the QR and serial sit on a tenant's own pool artwork ('custom'). Bounds
// mirror DEFAULT_POOL_ART/POOL_ART_SAFE; the renderer clamps again, since this is
// the only thing between a client and the stored blob.
const PoolArtLayoutSchema = z.object({
  qrX: z.number().min(0).max(1016),
  qrY: z.number().min(0).max(638),
  qrSize: z.number().min(90).max(460),
  qrTile: z.boolean(),
  codeX: z.number().min(0).max(1016),
  codeY: z.number().min(0).max(638),
  codeSize: z.number().min(12).max(80),
  codeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  codeChip: z.boolean(),
});

const CardDesignSchema = z.object({
  template: z.enum(['navy', 'maroon', 'minimal', 'portrait']),
  // The pool cards' design — chosen separately from the personal student cards.
  agnosticTemplate: z.enum(['aurora', 'ribbon', 'mono', 'wave', 'crest', 'custom']).optional(),
  teacherName: z.string().max(80),
  teacherTitle: z.string().max(80),
  phone: z.string().max(40),
  whatsapp: z.string().max(40),
  email: z.string().max(120),
  location: z.string().max(80),
  qrLink: z.string().max(500),
  slogan: z.string().max(200),
  instructions: z.array(z.string().max(160)).max(5),
  highlights: z.array(z.string().max(60)).max(4),
  // Data URLs (the page downscales before saving). Capped so one upload can't
  // blow the Lambda request limit or bloat every card-design read.
  photo: z.string().max(700_000).optional(),
  logo: z.string().max(700_000).optional(),
  student: CardAdjustSchema.optional(),
  pool: CardAdjustSchema.optional(),
  poolBack: CardAdjustSchema.optional(),
  // The academy's own pool artwork. A full-bleed card image is heavier than a logo,
  // so the cap is higher — the page downscales to card size and encodes JPEG before
  // saving, which lands these around 150 KB each rather than near the cap.
  artFront: z.string().max(1_400_000).optional(),
  artBack: z.string().max(1_400_000).optional(),
  poolArt: PoolArtLayoutSchema.optional(),
});

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
  // ("01000000000") or international ("201000000000" / "+201000000000") format.
  identifier: z.string().min(3),
  password: z.string().min(6),
});

const RegisterRequestSchema = z.object({
  // Company details
  companyName: z.string().min(1),
  // Account type: ACADEMY (institution) or TEACHER (individual). Optional so
  // older clients that omit it still validate; the backend defaults to ACADEMY.
  type: z.enum(['ACADEMY', 'TEACHER']).optional(),
  // Feature plan chosen at signup (academies only; teachers are always SIMPLE).
  plan: z.enum(['SIMPLE', 'ADVANCED']).optional(),
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
  phone: z.string().min(1),
  recaptchaToken: z.string().optional(),
});

const ResetPasswordRequestSchema = z.object({
  phone: z.string().min(1),
  otp: z.string().length(6),
  password: z.string().min(6),
});

const SafeUserSchema = z.object({
  id: UUIDSchema,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: UserRoleSchema,
  companyId: UUIDSchema,
  companyType: z.enum(['ACADEMY', 'TEACHER']).optional(),
  plan: z.enum(['SIMPLE', 'ADVANCED']).optional(), // Feature plan; ADVANCED unlocks CRM
  qrFree: z.boolean().optional(), // Teacher tenant is in the free QR-activation launch tier
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
export const ACQUISITION_CHANNELS = [
  'FACEBOOK',
  'INSTAGRAM',
  'TWITTER',
  'TIKTOK',
  'REFERRAL',
  'WALK_IN',
  'OTHER',
] as const;
const AcquisitionChannelSchema = z.enum(ACQUISITION_CHANNELS);

const GenderSchema = z.enum(['MALE', 'FEMALE']);

const CreateStudentSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().nullable().optional(),
  gender: GenderSchema.nullable().optional(),
  email: z.union([z.string().email(), z.literal('')]).nullable().optional(),
  phone: z.string().nullable().optional(),
  parentName: z.string(),
  parentPhone: z.string(),
  address: z.string().nullable().optional(),
  branchId: UUIDSchema,
  notes: z.string().nullable().optional(),
  acquisitionChannel: AcquisitionChannelSchema.nullable().optional(),
});

const UpdateStudentSchema = CreateStudentSchema.partial();

// One parsed row from the bulk-import spreadsheet. Kept deliberately lenient
// (only firstName is required; email/phone are free strings, not format-checked)
// so a single malformed cell can't reject the whole batch — the frontend has
// already validated/previewed the rows, and the backend records per-row errors.
const BulkImportStudentRowSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  gender: GenderSchema.nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  parentName: z.string().nullable().optional(),
  parentPhone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const BulkImportStudentsSchema = z.object({
  branchId: UUIDSchema,
  students: z.array(BulkImportStudentRowSchema).min(1).max(1000),
});

const BulkImportResultSchema = z.object({
  created: z.number(),
  failed: z.number(),
  errors: z.array(z.object({ row: z.number(), message: z.string() })),
});

const StudentSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string().nullable(),
  gender: GenderSchema.nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  parentName: z.string(),
  parentPhone: z.string(),
  address: z.string().nullable(),
  branchId: UUIDSchema,
  isActive: z.boolean(),
  inactiveDate: z.string().nullable(),
  inactiveReason: z.string().nullable(),
  notes: z.string().nullable(),
  acquisitionChannel: AcquisitionChannelSchema.nullable(),
  // Short sequential per-company number for QR-less attendance / payment lookup.
  studentCode: z.number().nullable().optional(),
  qrToken: z.string().nullable().optional(),
  qrActivated: z.boolean().optional(),
  qrExpiration: z.string().nullable().optional(),
  qrPrice: z.number().nullable().optional(),
  qrPaid: z.boolean().optional(),
  hasSubscriptions: z.boolean().optional(),
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
  hasFinancials: z.boolean().optional(),
});

// =============================================
// Level Schemas
// =============================================
const CreateLevelSchema = z.object({
  name: z.string(),
  age: z.number().nullable().optional(),
  // Optional age range. Both nullable; the route rejects toAge <= fromAge.
  fromAge: z.number().nullable().optional(),
  toAge: z.number().nullable().optional(),
});

const UpdateLevelSchema = CreateLevelSchema.partial();

const LevelSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  name: z.string(),
  age: z.number().nullable(),
  fromAge: z.number().nullable().optional(),
  toAge: z.number().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// A level as embedded on a course response (id + display name).
const CourseLevelSchema = z.object({
  id: UUIDSchema,
  name: z.string().nullable(),
});

// =============================================
// Subject Schemas
// =============================================
const CreateSubjectSchema = z.object({
  name: z.string(),
});

const UpdateSubjectSchema = CreateSubjectSchema.partial();

const SubjectSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// A subject as embedded on a course response (id + display name).
const CourseSubjectSchema = z.object({
  id: UUIDSchema,
  name: z.string().nullable(),
});

// =============================================
// Course Schemas
// =============================================
const CreateCourseSchema = z.object({
  branchId: UUIDSchema,
  name: z.string(),
  description: z.string().optional(),
  price: z.number(),
  instructorId: OptionalUUIDSchema,
  defaultRoomId: OptionalUUIDSchema,
  // Legacy single level (kept for back-compat) and the new multi-level array.
  levelId: OptionalUUIDSchema,
  levelIds: z.array(UUIDSchema).optional(),
  // Subjects a course is tagged with (academy-only in the UI).
  subjectIds: z.array(UUIDSchema).optional(),
  // Payment model: ONE_TIME (default), MONTHLY_SUBSCRIPTION, or PER_SESSION. Without
  // this the field is stripped from the request body and every course saves as ONE_TIME.
  paymentType: CoursePaymentTypeSchema.optional(),
  monthlyFee: z.number().optional(),
  // PER_SESSION settings (price column holds the per-session fee):
  sessionPackageSize: z.number().int().positive().nullable().optional(),
  sessionPackagePrice: z.number().nullable().optional(),
  chargeAbsentSessions: z.boolean().optional(),
});

const UpdateCourseSchema = CreateCourseSchema.partial();

// =============================================
// Master Course Schemas
// =============================================
const CreateMasterCourseSchema = z.object({
  branchId: UUIDSchema,
  name: z.string(),
  description: z.string().optional(),
  defaultPrice: z.number(),
  defaultDuration: z.number(),
  defaultMaxStudents: z.number().optional(),
  levelId: OptionalUUIDSchema,
});

const UpdateMasterCourseSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  defaultPrice: z.number().optional(),
  defaultDuration: z.number().optional(),
  defaultMaxStudents: z.number().optional(),
  levelId: OptionalUUIDSchema,
  isActive: z.boolean().optional(),
});

const MasterCourseSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema,
  branchName: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable(),
  defaultPrice: z.number(),
  defaultDuration: z.number(),
  defaultMaxStudents: z.number().nullable(),
  levelId: UUIDSchema.nullable().optional(),
  levelName: z.string().nullable().optional(),
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

// =============================================
// Exam Schemas
// =============================================
const ExamStatusSchema = z.enum(['SCHEDULED', 'DONE']);

const CreateExamSchema = z.object({
  // Homework is created from a session, where the class is known but the course
  // is not: pass classId and the server derives courseId (and branch) from it.
  courseId: OptionalUUIDSchema,
  name: z.string().min(1),
  examDate: z.string().min(1),
  maxGrade: z.number().nullable().optional(),
  status: ExamStatusSchema.optional(),
  isHomework: z.boolean().optional(),
  classId: OptionalUUIDSchema,
  sessionId: OptionalUUIDSchema,
});

const UpdateExamSchema = CreateExamSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const ExamSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema.nullable(),
  courseId: UUIDSchema,
  courseName: z.string().optional(),
  name: z.string(),
  examDate: z.string(),
  maxGrade: z.number().nullable(),
  status: z.string(),
  resultCount: z.number().optional(),
  isHomework: z.boolean(),
  classId: UUIDSchema.nullable(),
  className: z.string().optional(),
  sessionId: UUIDSchema.nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ExamResultRowSchema = z.object({
  studentId: UUIDSchema,
  firstName: z.string(),
  lastName: z.string(),
  parentName: z.string().nullable().optional(),
  parentPhone: z.string().nullable().optional(),
  studentPhone: z.string().nullable().optional(),
  grade: z.string().nullable(),
  isAbsent: z.boolean().optional(),
  recordedAt: z.string().nullable(),
});

const QrExamResultSchema = z.object({
  studentId: UUIDSchema,
  studentFirstName: z.string(),
  studentLastName: z.string(),
  grade: z.string(),
  alreadyRecorded: z.boolean(),
  code: z.string(),
  message: z.string(),
});

const StudentExamResultSchema = z.object({
  examName: z.string(),
  courseName: z.string(),
  examDate: z.string(),
  grade: z.string(),
  maxGrade: z.number().nullable().optional(),
  /** Homework and exams share this table; the student page lists them separately. */
  isHomework: z.boolean().optional(),
  className: z.string().nullable().optional(),
});

const LinkedCourseSummarySchema = z.object({
  id: UUIDSchema,
  branchId: UUIDSchema.nullable(),
  branchName: z.string().nullable(),
  name: z.string(),
  code: z.string(),
  price: z.number(),
  isActive: z.boolean(),
});

const CourseSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema.nullable(),
  masterCourseId: UUIDSchema.nullable().optional(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  instructorId: UUIDSchema.nullable(),
  levelId: UUIDSchema.nullable().optional(),
  levelName: z.string().nullable().optional(),
  levelIds: z.array(UUIDSchema).optional(),
  levels: z.array(CourseLevelSchema).optional(),
  subjectIds: z.array(UUIDSchema).optional(),
  subjects: z.array(CourseSubjectSchema).optional(),
  isActive: z.boolean(),
  enrollmentCount: z.number().optional(),
  paymentType: CoursePaymentTypeSchema.default('ONE_TIME'),
  sessionPackageSize: z.number().nullable().optional(),
  sessionPackagePrice: z.number().nullable().optional(),
  chargeAbsentSessions: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// =============================================
// Monthly Subscription Schemas  (NEW)
// =============================================
const MonthlyPaymentStatusSchema = z.enum(['PENDING', 'PAID', 'PARTIAL', 'OVERDUE', 'REFUNDED']);

const MonthlySubscriptionPaymentSchema = z.object({
  id: UUIDSchema,
  enrollmentId: UUIDSchema,
  companyId: UUIDSchema,
  studentId: UUIDSchema,
  courseId: UUIDSchema,
  branchId: UUIDSchema,
  billingYear: z.number(),
  billingMonth: z.number(),
  amountDue: z.number(),
  amountPaid: z.number(),
  paymentStatus: MonthlyPaymentStatusSchema,
  dueDate: z.string(),
  paidDate: z.string().nullable(),
  notes: z.string().nullable(),
  refundedAmount: z.number().optional(),
  refundNote: z.string().nullable().optional(),
  refundedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const MonthlyPaymentWithDetailsSchema = MonthlySubscriptionPaymentSchema.extend({
  studentFirstName: z.string(),
  studentLastName: z.string(),
  courseName: z.string(),
  branchName: z.string(),
  className: z.string().nullable().optional(),
  studentPhone: z.string().nullable().optional(),
  parentPhone: z.string().nullable().optional(),
  parentName: z.string().nullable().optional(),
  enrollmentStatus: z.string().nullable().optional(),
});

const HeldSubscriptionSchema = z.object({
  enrollmentId: z.string(),
  studentId: z.string(),
  courseId: z.string(),
  branchId: z.string(),
  studentFirstName: z.string(),
  studentLastName: z.string(),
  courseName: z.string(),
  branchName: z.string(),
  className: z.string().nullable().optional(),
  holdStartMonth: z.number().nullable().optional(),
  holdStartYear: z.number().nullable().optional(),
});

const MonthlyPaymentSummarySchema = z.object({
  billingYear: z.number(),
  billingMonth: z.number(),
  totalStudents: z.number(),
  paidCount: z.number(),
  pendingCount: z.number(),
  overdueCount: z.number(),
  partialCount: z.number(),
  totalRevenue: z.number(),
  totalExpected: z.number(),
  totalRefunded: z.number(),
});

const RecordMonthlyPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string(),
  notes: z.string().optional(),
});

const GenerateMonthlyBillsSchema = z.object({
  courseId: OptionalUUIDSchema,
  branchId: OptionalUUIDSchema,
  billingYear: z.number().int().min(2020).max(2100),
  billingMonth: z.number().int().min(1).max(12),
});

const CourseMonthlyPriceOverrideSchema = z.object({
  id: UUIDSchema,
  courseId: UUIDSchema,
  companyId: UUIDSchema,
  billingYear: z.number(),
  billingMonth: z.number(),
  overridePrice: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const SetPriceOverrideSchema = z.object({
  courseId: UUIDSchema,
  billingYear: z.number().int().min(2020).max(2100),
  billingMonth: z.number().int().min(1).max(12),
  overridePrice: z.number().positive(),
});

// =============================================
// Session Payment Schemas  (PER_SESSION courses, migration 050)
// =============================================
const SessionPaymentStatusSchema = z.enum(['PENDING', 'PAID', 'COVERED', 'WAIVED', 'REFUNDED']);

const SessionPaymentSchema = z.object({
  id: UUIDSchema,
  enrollmentId: UUIDSchema,
  sessionId: UUIDSchema,
  companyId: UUIDSchema,
  studentId: UUIDSchema,
  courseId: UUIDSchema,
  branchId: UUIDSchema,
  packageId: UUIDSchema.nullable(),
  attendanceState: z.enum(['PRESENT', 'ABSENT']),
  amountDue: z.number(),
  amountPaid: z.number(),
  paymentStatus: SessionPaymentStatusSchema,
  paidDate: z.string().nullable(),
  notes: z.string().nullable(),
  refundedAmount: z.number().optional(),
  refundNote: z.string().nullable().optional(),
  refundedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const SessionPaymentWithDetailsSchema = SessionPaymentSchema.extend({
  studentFirstName: z.string(),
  studentLastName: z.string(),
  courseName: z.string(),
  branchName: z.string(),
  className: z.string().nullable().optional(),
  sessionNumber: z.number().nullable().optional(),
  sessionDate: z.string().nullable().optional(),
  studentPhone: z.string().nullable().optional(),
  parentPhone: z.string().nullable().optional(),
  parentName: z.string().nullable().optional(),
  coursePackageSize: z.number().nullable().optional(),
  coursePackagePrice: z.number().nullable().optional(),
});

const SessionPaymentSummarySchema = z.object({
  totalCharges: z.number(),
  paidCount: z.number(),
  coveredCount: z.number(),
  pendingCount: z.number(),
  refundedCount: z.number(),
  totalRevenue: z.number(),
  totalExpected: z.number(),
  /** Money actually received in the range (payment-dated); packages count in full on purchase day. */
  cashCollected: z.number().optional(),
  /** Of cashCollected, the portion from prepaid packages only (payment-dated). */
  packageCashCollected: z.number().optional(),
});

const SessionPackageSchema = z.object({
  id: UUIDSchema,
  enrollmentId: UUIDSchema,
  companyId: UUIDSchema,
  studentId: UUIDSchema,
  courseId: UUIDSchema,
  branchId: UUIDSchema,
  sessionsTotal: z.number(),
  sessionsUsed: z.number(),
  amountDue: z.number().optional(),
  amountPaid: z.number(),
  status: z.enum(['ACTIVE', 'EXHAUSTED', 'REFUNDED']),
  refundedAmount: z.number().optional(),
  refundNote: z.string().nullable().optional(),
  refundedAt: z.string().nullable().optional(),
  purchasedAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const SessionPackageWithDetailsSchema = SessionPackageSchema.extend({
  studentFirstName: z.string(),
  studentLastName: z.string(),
  courseName: z.string(),
  branchName: z.string(),
});

const RecordSessionPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string(),
  notes: z.string().optional(),
});

const RefundSessionPaymentSchema = z.object({
  // FULL refunds the whole remaining paid amount; PARTIAL requires `amount`.
  // Omitted type + amount present = legacy partial-by-amount (old clients).
  type: z.enum(['FULL', 'PARTIAL']).optional(),
  amount: z.number().positive().optional(),
  note: z.string().optional(),
});

const BuySessionPackageSchema = z.object({
  enrollmentId: UUIDSchema,
  sessionsTotal: z.number().int().positive().optional(),
  amount: z.number().nonnegative().optional(),
  amountDue: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

// =============================================
// Class Schemas
// =============================================
const ClassTypeSchema = z.enum(['ONLINE', 'OFFLINE']);

// Per-day start/end time for a class. `day` is an UPPER weekday name (e.g. MONDAY).
const ClassDayTimeSchema = z.object({
  day: z.string(),
  startTime: z.string(),
  endTime: z.string(),
});

const CreateClassSchema = z.object({
  courseId: UUIDSchema,
  // Class branch/company are derived from the linked course. Keep `branchId` optional
  // for backward compatibility with older clients; the server ignores it.
  branchId: OptionalUUIDSchema,
  instructorId: OptionalUUIDSchema,
  // The room this class is scheduled in. A session may still be opened elsewhere.
  roomId: OptionalUUIDSchema,
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  daysOfWeek: z.string().optional(),
  // Per-day times. When present, it is the source of truth and drives
  // daysOfWeek/startTime/endTime. Omit to keep the legacy one-time-for-all shape.
  dayTimes: z.array(ClassDayTimeSchema).optional(),
  maxStudents: z.number().optional(),
  notes: z.string().optional(),
  type: ClassTypeSchema.optional(),
});

const UpdateClassSchema = z.object({
  instructorId: OptionalUUIDSchema,
  roomId: OptionalUUIDSchema,
  name: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  daysOfWeek: z.string().optional(),
  dayTimes: z.array(ClassDayTimeSchema).optional(),
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
  roomId: UUIDSchema.nullable().optional(),
  roomCode: z.string().nullable().optional(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  daysOfWeek: z.string().nullable(),
  dayTimes: z.array(ClassDayTimeSchema).optional(),
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
  // Monthly-subscription enrollment fields (ignored for one-time courses):
  paymentType: z.enum(['ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION']).optional(),
  payFirstMonth: z.boolean().optional(),
  // Part of the first month, collected at enrollment. Mirrors the package's
  // PARTIAL down payment: the first bill is left PARTIAL with the rest owing.
  firstMonthDownPayment: z.number().optional(),
  // Per-session enrollment fields (ignored unless the course is PER_SESSION):
  sessionBillingMode: z.enum(['PER_SESSION', 'PACKAGE']).optional(),
  buyPackage: z.boolean().optional(),
  // How the prepaid package is paid: FULL (now), PARTIAL (down payment now), LATER.
  sessionPackagePayMode: z.enum(['FULL', 'PARTIAL', 'LATER']).optional(),
  sessionPackageDownPayment: z.number().optional(),
  // The package charge (after any discount) when prepaying a package. When
  // omitted the course's list session_package_price is used.
  sessionPackageFinalPrice: z.number().optional(),
  notes: z.string().optional(),
  // Educational Books: optional linked products bought together with the enrollment
  // (one atomic transaction). Each becomes an attributed product sale.
  products: z.array(z.object({
    productId: UUIDSchema,
    quantity: z.number().optional(),
    discountType: z.enum(['NONE', 'PERCENTAGE', 'FIXED_AMOUNT']).optional(),
    discountValue: z.number().optional(),
    paymentMethod: z.string().optional(),
  })).optional(),
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
  paymentType: z.enum(['ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION']).optional(),
  downPayment: z.number(),
  amountPaid: z.number(),
  paymentStatus: PaymentStatusSchema,
  completionDate: z.string().nullable(),
  notes: z.string().nullable(),
  holdStartMonth: z.number().nullable().optional(),
  holdStartYear: z.number().nullable().optional(),
  holdMonths: z.number().nullable().optional(),
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
  restockQuantity: z.number().optional(),
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
  // Product-sale refunds only: units the customer physically returned, added
  // back to inventory. Omit or 0 to refund without restocking.
  restockQuantity: z.number().int().nonnegative().optional(),
});

// =============================================
// Revenue Schemas (Read-only, calculated from enrollments and product sales)
// =============================================
const RevenueItemSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema.nullable(),
  branchName: z.string().nullable(),
  source: z.enum(['ENROLLMENT', 'PRODUCT_SALE', 'MASTER_ENROLLMENT', 'EVENT', 'SUBSCRIPTION', 'SESSION']),
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
  sessionRevenue: z.number(),
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
  // Number of sessions covered by this payment (session-based salary only).
  sessionCount: z.number().optional(),
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
  salary: z.number().nullable().optional(),
  salaryType: z.enum(['MONTHLY', 'SESSION_BASED', 'PERCENTAGE']).optional(),
  sessionRate: z.number().nullable().optional(),
  percentageRate: z.number().nullable().optional(),
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
  salaryType: z.string(),
  sessionRate: z.number().nullable(),
  percentageRate: z.number().nullable().optional(),
  hireDate: z.string().nullable(),
  branchId: UUIDSchema.nullable(),
  isGlobal: z.boolean(),
  isActive: z.boolean(),
  linkedUserId: UUIDSchema.nullable().optional(),
  hasSalaryHistory: z.boolean().optional(),
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
  // Educational Books: attribute the sale to a student/course/enrollment.
  studentId: OptionalUUIDSchema,
  courseId: OptionalUUIDSchema,
  enrollmentId: OptionalUUIDSchema,
});

const ProductSaleSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  productId: UUIDSchema,
  productName: z.string().nullable(),
  branchId: UUIDSchema,
  studentId: UUIDSchema.nullable().optional(),
  studentName: z.string().nullable().optional(),
  courseId: UUIDSchema.nullable().optional(),
  enrollmentId: UUIDSchema.nullable().optional(),
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
// Course Products + Educational Books Schemas
// =============================================
const CourseProductSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  courseId: UUIDSchema,
  productId: UUIDSchema,
  isRequired: z.boolean(),
  defaultDiscountType: z.string(),
  defaultDiscountValue: z.number(),
  addedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  productName: z.string().optional(),
  productCode: z.string().optional(),
  sellingPrice: z.number().optional(),
  stock: z.number().optional(),
});

const CreateCourseProductSchema = z.object({
  courseId: UUIDSchema,
  productId: UUIDSchema,
  isRequired: z.boolean().optional(),
  defaultDiscountType: DiscountTypeSchema.optional(),
  defaultDiscountValue: z.number().optional(),
});

const UpdateCourseProductSchema = z.object({
  isRequired: z.boolean().optional(),
  defaultDiscountType: DiscountTypeSchema.optional(),
  defaultDiscountValue: z.number().optional(),
});

const EducationalBooksCourseSummarySchema = z.object({
  courseId: UUIDSchema,
  courseName: z.string(),
  branchId: UUIDSchema.nullable(),
  branchName: z.string().nullable(),
  linkedProductCount: z.number(),
  enrolledCount: z.number(),
  boughtCount: z.number(),
  notBoughtCount: z.number(),
});

const EducationalBooksCourseDetailSchema = z.object({
  courseId: UUIDSchema,
  courseName: z.string(),
  branchId: UUIDSchema.nullable(),
  enrolledCount: z.number(),
  products: z.array(z.object({
    courseProductId: UUIDSchema,
    productId: UUIDSchema,
    productName: z.string(),
    productCode: z.string().nullable(),
    sellingPrice: z.number(),
    stock: z.number(),
    isRequired: z.boolean(),
    defaultDiscountType: z.string(),
    defaultDiscountValue: z.number(),
    buyers: z.array(z.object({
      studentId: UUIDSchema,
      studentName: z.string().nullable(),
      saleId: UUIDSchema,
      quantity: z.number(),
      totalAmount: z.number(),
      saleDate: z.string(),
    })),
    nonBuyers: z.array(z.object({
      studentId: UUIDSchema,
      studentName: z.string().nullable(),
      enrollmentId: UUIDSchema.nullable(),
    })),
  })),
});

// =============================================
// Lookups — permission-free {id, label} lists for dropdowns
// =============================================
const LookupOptionSchema = z.object({ id: z.string(), label: z.string() });
const LookupListSchema = z.array(LookupOptionSchema);

// Telegram
const TelegramSettingsSchema = z.object({
  enabled: z.boolean(),
  botConfigured: z.boolean(),
  botUsername: z.string().nullable(),
  notifyOnPresent: z.boolean(),
  notifyOnAbsent: z.boolean(),
  notifyTarget: z.enum(['STUDENT', 'PARENT', 'BOTH']),
});

// CRM lead (Phase 1)
const CrmLeadSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  branchId: UUIDSchema.nullable(),
  fullName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: z.string().nullable(),
  interestedCourseId: UUIDSchema.nullable(),
  interestedCourseName: z.string().nullable(),
  stage: z.string(),
  ownerUserId: UUIDSchema.nullable(),
  ownerName: z.string().nullable(),
  notes: z.string().nullable(),
  lostReason: z.string().nullable(),
  nextActionAt: z.string().nullable(),
  convertedStudentId: UUIDSchema.nullable(),
  lastActivityAt: z.string().nullable().optional(),
  openTaskCount: z.number().optional(),
  nextTaskDueAt: z.string().nullable().optional(),
  reachCount: z.number().optional(),
  lastCallAt: z.string().nullable().optional(),
  lastResponse: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CrmCallSchema = z.object({
  id: UUIDSchema,
  leadId: UUIDSchema,
  response: z.string(),
  obstacle: z.string().nullable(),
  notes: z.string().nullable(),
  calledBy: UUIDSchema.nullable(),
  calledByName: z.string().nullable(),
  calledAt: z.string(),
  createdAt: z.string(),
});

const CrmLeadWriteSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  interestedCourseId: OptionalUUIDSchema,
  branchId: OptionalUUIDSchema,
  stage: z.string().optional(),
  ownerUserId: OptionalUUIDSchema,
  notes: z.string().nullable().optional(),
  nextActionAt: z.string().nullable().optional(),
});

const CrmActivitySchema = z.object({
  id: UUIDSchema,
  leadId: UUIDSchema,
  leadName: z.string().nullable().optional(),
  type: z.string(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  dueAt: z.string().nullable(),
  doneAt: z.string().nullable(),
  ownerUserId: UUIDSchema.nullable(),
  ownerName: z.string().nullable(),
  assignedEmployeeId: UUIDSchema.nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  priority: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CrmTaskWriteSchema = z.object({
  subject: z.string().optional(),
  body: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  leadId: OptionalUUIDSchema,
  assignedEmployeeId: OptionalUUIDSchema,
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  done: z.boolean().optional(),
});

const CrmActivityWriteSchema = z.object({
  type: z.string().optional(),
  subject: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  ownerUserId: OptionalUUIDSchema,
  done: z.boolean().optional(),
});

// Pre-printed QR cards: a pool an academy prints blank and links to students later
const QrCardSchema = z.object({
  id: UUIDSchema,
  serial: z.number(),
  token: z.string(),
  // Which print run this card belongs to (1, 2 or 3). Stamped by the vendor when
  // minting; nothing branches on it yet.
  poolType: z.number(),
  studentId: UUIDSchema.nullable(),
  studentName: z.string().nullable(),
  studentCode: z.number().nullable(),
  assignedAt: z.string().nullable(),
  createdAt: z.string(),
});

/** The pool types a print run can be stamped with. Mirrors qr_cards_pool_type_check. */
const PoolTypeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

// CRM lists — named groups of leads (a lead can sit in many)
const CrmListSchema = z.object({
  id: UUIDSchema,
  companyId: UUIDSchema,
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CrmListWriteSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});

// WhatsApp Cloud API (foundation)
const WaSettingsSchema = z.object({
  autoSendOnCheckin: z.boolean(),
  autoSendOnAbsence: z.boolean(),
  absenceWarningThreshold: z.number(),
  autoSendAbsenceWarning: z.boolean(),
  crmAutoOutreach: z.boolean(),
  crmAutoDrip: z.boolean(),
  crmStopOnReply: z.boolean(),
});

const WaTemplateSchema = z.object({
  id: UUIDSchema,
  key: z.string(),
  metaTemplateName: z.string().nullable(),
  category: z.string(),
  language: z.string(),
  body: z.string(),
  isActive: z.boolean(),
});

const WaConversationSchema = z.object({
  id: UUIDSchema,
  contactPhone: z.string(),
  contactName: z.string().nullable(),
  studentId: UUIDSchema.nullable(),
  leadId: UUIDSchema.nullable(),
  lastMessageAt: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  unreadCount: z.number(),
});

const WaMessageSchema = z.object({
  id: UUIDSchema,
  direction: z.string(),
  type: z.string(),
  templateKey: z.string().nullable(),
  body: z.string().nullable(),
  status: z.string().nullable(),
  createdAt: z.string(),
});

// Offline desktop license (admin-console view of the offline_license table).
const LicenseSchema = z.object({
  id: UUIDSchema,
  licenseKey: z.string().nullable(),
  tier: z.enum(['TEACHER', 'ACADEMY']),
  label: z.string().nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  deviceId: z.string().nullable(),
  trialStartedAt: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  activated: z.boolean(),
  activationEndsAt: z.string().nullable(),
  revoked: z.boolean(),
  // Annual renewal fee — owner bookkeeping only, never sent to the client.
  price: z.number().nullable().optional(),
  // Usage telemetry reported on the app's heartbeat (aggregate counts, no PII).
  studentCount: z.number().nullable().optional(),
  courseCount: z.number().nullable().optional(),
  lastSeenAt: z.string().nullable().optional(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

// Signed license token returned by the public register/activate endpoints.
const SignedLicenseSchema = z.object({
  token: z.string(),
  signature: z.string(),
});

// validate() response: `registered:false` tells the app to show the sign-up
// form; otherwise the signed token fields are present.
const LicenseValidateSchema = z.object({
  registered: z.boolean(),
  token: z.string().optional(),
  signature: z.string().optional(),
});

// =============================================
// API Contract
// =============================================
/** A user account as the owner's admin console sees it — never a password. */
const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  role: z.string(),
  is_active: z.boolean(),
  email_verified: z.boolean(),
  company_id: z.string().nullable(),
  company_name: z.string().nullable(),
  created_at: z.string().nullable(),
});

export const contract = c.router({
  // Public, unauthenticated license validation for the offline desktop app.
  publicLicense: {
    // Per-launch status check, keyed by device id.
    validate: {
      method: 'POST' as const,
      path: '/api/public/license/validate',
      body: z.object({
        deviceId: z.string(),
        // Optional usage counts the app piggybacks on its heartbeat (no PII).
        stats: z
          .object({
            students: z.number().optional(),
            courses: z.number().optional(),
          })
          .optional(),
      }),
      responses: {
        200: LicenseValidateSchema,
        400: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
    // First run: self-register with name + phone to start the trial.
    register: {
      method: 'POST' as const,
      path: '/api/public/license/register',
      body: z.object({
        deviceId: z.string(),
        name: z.string(),
        phone: z.string(),
        tier: z.enum(['TEACHER', 'ACADEMY']).optional(),
      }),
      responses: {
        200: SignedLicenseSchema,
        400: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
    // Post-trial: enter the product license the owner issued to unlock.
    activate: {
      method: 'POST' as const,
      path: '/api/public/license/activate',
      body: z.object({ deviceId: z.string(), licenseKey: z.string() }),
      responses: {
        200: SignedLicenseSchema,
        400: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  },

  // Lookups (auth-only, no granular permission) — see routes/lookups.ts
  lookups: {
    branches: {
      method: 'GET', path: '/api/lookups/branches',
      responses: { 200: LookupListSchema },
    },
    employees: {
      method: 'GET', path: '/api/lookups/employees',
      responses: { 200: LookupListSchema },
    },
    courses: {
      method: 'GET', path: '/api/lookups/courses',
      query: z.object({ branchId: OptionalUUIDSchema }),
      responses: { 200: LookupListSchema },
    },
    classes: {
      method: 'GET', path: '/api/lookups/classes',
      query: z.object({ courseId: OptionalUUIDSchema, branchId: OptionalUUIDSchema }),
      responses: { 200: LookupListSchema },
    },
    levels: {
      method: 'GET', path: '/api/lookups/levels',
      responses: { 200: LookupListSchema },
    },
    subjects: {
      method: 'GET', path: '/api/lookups/subjects',
      responses: { 200: LookupListSchema },
    },
    rooms: {
      method: 'GET', path: '/api/lookups/rooms',
      query: z.object({ branchId: OptionalUUIDSchema }),
      responses: { 200: LookupListSchema },
    },
    masterCourses: {
      method: 'GET', path: '/api/lookups/master-courses',
      responses: { 200: LookupListSchema },
    },
    students: {
      method: 'GET', path: '/api/lookups/students',
      query: z.object({ branchId: OptionalUUIDSchema }),
      responses: { 200: LookupListSchema },
    },
    products: {
      method: 'GET', path: '/api/lookups/products',
      query: z.object({ branchId: OptionalUUIDSchema }),
      responses: { 200: LookupListSchema },
    },
  },
  // Auth routes
  auth: {
    login: {
      method: 'POST',
      path: '/api/auth/login',
      body: LoginRequestSchema,
      responses: {
        200: AuthResponseSchema,
        401: ApiErrorSchema,
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
        400: ApiErrorSchema,
      },
    },
    verifyEmail: {
      method: 'POST',
      path: '/api/auth/verify-email',
      body: VerifyEmailRequestSchema,
      responses: {
        200: AuthResponseSchema,
        400: ApiErrorSchema,
      },
    },
    resendEmailOtp: {
      method: 'POST',
      path: '/api/auth/resend-email-otp',
      body: ResendEmailOtpRequestSchema,
      responses: {
        200: ApiErrorSchema,
        400: ApiErrorSchema,
      },
    },
    forgotPassword: {
      method: 'POST',
      path: '/api/auth/forgot-password',
      body: ForgotPasswordRequestSchema,
      responses: {
        200: ApiErrorSchema,
        400: ApiErrorSchema,
      },
    },
    resetPassword: {
      method: 'POST',
      path: '/api/auth/reset-password',
      body: ResetPasswordRequestSchema,
      responses: {
        200: ApiErrorSchema,
        400: ApiErrorSchema,
      },
    },
    profile: {
      method: 'GET',
      path: '/api/auth/profile',
      responses: {
        200: SafeUserSchema,
        401: ApiErrorSchema,
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
        400: ApiErrorSchema,
      },
    },
    // Bulk-create students from a parsed spreadsheet. All rows land in the one
    // chosen branch. Returns counts + per-row errors (best-effort: valid rows
    // are inserted even if some rows fail).
    bulkImport: {
      method: 'POST',
      path: '/api/students/bulk-import',
      body: BulkImportStudentsSchema,
      responses: {
        200: BulkImportResultSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/students/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateStudentSchema,
      responses: {
        200: StudentSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/students/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    reactivate: {
      method: 'PATCH',
      path: '/api/students/:id/reactivate',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: StudentSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    hardDelete: {
      method: 'DELETE',
      path: '/api/students/:id/permanent',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    regenerateQr: {
      method: 'POST',
      path: '/api/students/:id/regenerate-qr',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: StudentSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    lookupByQr: {
      method: 'GET',
      path: '/api/students/lookup-by-qr/:qrToken',
      pathParams: z.object({ qrToken: z.string().min(1).max(64) }),
      responses: {
        200: z.object({ id: UUIDSchema }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    // Resolve a student by their short sequential code (QR-less fallback). Returns
    // the student's qrToken too so callers can reuse the existing QR check-in /
    // payment flows without a second round trip.
    lookupByCode: {
      method: 'GET',
      path: '/api/students/lookup-by-code/:code',
      // Digits, or the "A-100001" form printed on a pool card.
      pathParams: z.object({ code: z.string().regex(/^[Aa]?-?\d+$/) }),
      responses: {
        200: z.object({ id: UUIDSchema, qrToken: z.string() }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
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
        404: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/branches/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateBranchSchema,
      responses: {
        200: BranchSchema,
        404: ApiErrorSchema,
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
        404: ApiErrorSchema,
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
          code: z.string().optional(),
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
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
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
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    getById: {
      method: 'GET',
      path: '/api/courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: CourseSchema,
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateCourseSchema,
      responses: {
        200: CourseSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
    deactivate: {
      method: 'POST',
      path: '/api/courses/:id/deactivate',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: CourseSchema,
        404: ApiErrorSchema,
        409: z.object({
          message: z.string(),
          code: z.string().optional(),
          classes: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
        }),
      },
    },
    activate: {
      method: 'POST',
      path: '/api/courses/:id/activate',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: CourseSchema,
        404: ApiErrorSchema,
      },
    },
  },

  // Levels routes
  levels: {
    create: {
      method: 'POST',
      path: '/api/levels',
      body: CreateLevelSchema,
      responses: {
        201: LevelSchema,
        400: ApiErrorSchema,
      },
    },
    list: {
      method: 'GET',
      path: '/api/levels',
      responses: {
        200: z.array(LevelSchema),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/levels/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: LevelSchema,
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/levels/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateLevelSchema,
      responses: {
        200: LevelSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/levels/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  },

  // Subjects routes
  subjects: {
    create: {
      method: 'POST',
      path: '/api/subjects',
      body: CreateSubjectSchema,
      responses: {
        201: SubjectSchema,
        400: ApiErrorSchema,
      },
    },
    list: {
      method: 'GET',
      path: '/api/subjects',
      responses: {
        200: z.array(SubjectSchema),
      },
    },
    getById: {
      method: 'GET',
      path: '/api/subjects/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: SubjectSchema,
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/subjects/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateSubjectSchema,
      responses: {
        200: SubjectSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/subjects/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  },

  // Events routes
  events: {
    create: {
      method: 'POST',
      path: '/api/events',
      body: CreateEventSchema,
      responses: { 201: EventSchema, 400: ApiErrorSchema },
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
      responses: { 200: EventSchema, 404: ApiErrorSchema },
    },
    update: {
      method: 'PATCH',
      path: '/api/events/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateEventSchema,
      responses: { 200: EventSchema, 404: ApiErrorSchema },
    },
    delete: {
      method: 'DELETE',
      path: '/api/events/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: { 200: ApiErrorSchema, 404: ApiErrorSchema },
    },
    getPL: {
      method: 'GET',
      path: '/api/events/:id/pl',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: EventPLSchema, 404: ApiErrorSchema },
    },
    listSubscriptions: {
      method: 'GET',
      path: '/api/events/:eventId/subscriptions',
      pathParams: z.object({ eventId: UUIDSchema }),
      responses: { 200: z.array(z.any()), 404: ApiErrorSchema },
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
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    deleteSubscription: {
      method: 'DELETE',
      path: '/api/events/subscriptions/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    listExpenses: {
      method: 'GET',
      path: '/api/events/:eventId/expenses',
      pathParams: z.object({ eventId: UUIDSchema }),
      responses: { 200: z.array(z.any()), 404: ApiErrorSchema },
    },
    listRefunds: {
      method: 'GET',
      path: '/api/events/:eventId/refunds',
      pathParams: z.object({ eventId: UUIDSchema }),
      responses: { 200: z.array(z.any()), 404: ApiErrorSchema },
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
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  },

  // Exams routes. Order matters — static/specific paths before `/:id`
  // (itty-router matches in registration order; see sessions note in index.ts).
  exams: {
    create: {
      method: 'POST',
      path: '/api/exams',
      body: CreateExamSchema,
      responses: { 201: ExamSchema, 400: ApiErrorSchema, 403: ApiErrorSchema, 404: ApiErrorSchema },
    },
    list: {
      method: 'GET',
      path: '/api/exams',
      query: z.object({
        branchId: OptionalUUIDSchema,
        courseId: OptionalUUIDSchema,
        status: z.string().optional(),
        classId: OptionalUUIDSchema,
        // 'true' | 'false' — query params arrive as strings.
        isHomework: z.string().optional(),
      }),
      responses: { 200: z.array(ExamSchema), 403: ApiErrorSchema },
    },
    getByStudent: {
      method: 'GET',
      path: '/api/exams/student/:studentId',
      pathParams: z.object({ studentId: UUIDSchema }),
      responses: { 200: z.array(StudentExamResultSchema), 403: ApiErrorSchema },
    },
    results: {
      method: 'GET',
      path: '/api/exams/:id/results',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: z.array(ExamResultRowSchema), 403: ApiErrorSchema, 404: ApiErrorSchema },
    },
    recordByQr: {
      method: 'POST',
      path: '/api/exams/:id/record-by-qr',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ qrToken: z.string().min(1), grade: z.string().min(1) }),
      responses: {
        200: QrExamResultSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
    recordByCode: {
      method: 'POST',
      path: '/api/exams/:id/record-by-code',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ code: z.string().min(1), grade: z.string().min(1) }),
      responses: {
        200: QrExamResultSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
    saveResult: {
      method: 'POST',
      path: '/api/exams/:id/results',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ studentId: UUIDSchema, grade: z.string().min(1) }),
      responses: { 200: z.any(), 400: ApiErrorSchema, 403: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
    deleteResult: {
      method: 'DELETE',
      path: '/api/exams/:id/results/:studentId',
      pathParams: z.object({ id: UUIDSchema, studentId: UUIDSchema }),
      body: z.object({}).optional(),
      responses: { 200: z.any(), 403: ApiErrorSchema, 404: ApiErrorSchema },
    },
    markAbsent: {
      method: 'POST',
      path: '/api/exams/:id/absent',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ studentId: UUIDSchema, absent: z.boolean() }),
      responses: { 200: z.any(), 403: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
    sendTelegramResults: {
      method: 'POST',
      path: '/api/exams/:id/send-telegram',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), sent: z.number() }),
        400: ApiErrorSchema, 403: ApiErrorSchema, 404: ApiErrorSchema, 500: ApiErrorSchema,
      },
    },
    markRemainingAbsent: {
      method: 'POST',
      path: '/api/exams/:id/mark-remaining-absent',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), count: z.number() }),
        403: ApiErrorSchema, 404: ApiErrorSchema, 500: ApiErrorSchema,
      },
    },
    getById: {
      method: 'GET',
      path: '/api/exams/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: ExamSchema, 403: ApiErrorSchema, 404: ApiErrorSchema },
    },
    update: {
      method: 'PATCH',
      path: '/api/exams/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateExamSchema,
      responses: { 200: ExamSchema, 403: ApiErrorSchema, 404: ApiErrorSchema },
    },
    delete: {
      method: 'DELETE',
      path: '/api/exams/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: { 200: z.any(), 403: ApiErrorSchema, 404: ApiErrorSchema },
    },
  },

  // Pre-printed QR cards — a pool, printed blank, linked to a student by scanning
  qrCards: {
    generate: {
      method: 'POST',
      path: '/api/qr-cards/generate',
      body: z.object({ count: z.number().int().min(1).max(2000) }),
      responses: { 201: z.array(QrCardSchema), 400: ApiErrorSchema, 403: ApiErrorSchema },
    },
    list: {
      method: 'GET',
      path: '/api/qr-cards',
      query: z.object({ status: z.string().optional() }),
      responses: { 200: z.array(QrCardSchema), 403: ApiErrorSchema },
    },
    link: {
      method: 'POST',
      path: '/api/qr-cards/link',
      body: z.object({
        studentId: UUIDSchema,
        token: z.string().optional(),
        serial: z.number().int().optional(),
      }),
      responses: {
        200: QrCardSchema.extend({ alreadyLinked: z.boolean() }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
    unlink: {
      method: 'POST',
      path: '/api/qr-cards/:id/unlink',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}),
      responses: { 200: QrCardSchema, 403: ApiErrorSchema, 404: ApiErrorSchema },
    },
    byStudent: {
      method: 'GET',
      path: '/api/qr-cards/student/:studentId',
      pathParams: z.object({ studentId: UUIDSchema }),
      responses: { 200: z.array(QrCardSchema), 403: ApiErrorSchema },
    },
  },

  // CRM (Phase 1) — lead pipeline for ADVANCED-plan academies
  crm: {
    listLeads: {
      method: 'GET',
      path: '/api/crm/leads',
      query: z.object({
        stage: z.string().optional(),
        ownerId: UUIDSchema.optional(),
        branchId: UUIDSchema.optional(),
        search: z.string().optional(),
        toCall: z.string().optional(),
      }),
      responses: {
        200: z.array(CrmLeadSchema),
        403: ApiErrorSchema,
      },
    },
    createLead: {
      method: 'POST',
      path: '/api/crm/leads',
      body: CrmLeadWriteSchema,
      responses: {
        201: CrmLeadSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
      },
    },
    updateLead: {
      method: 'PATCH',
      path: '/api/crm/leads/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: CrmLeadWriteSchema.partial().extend({ lostReason: z.string().nullable().optional() }),
      responses: {
        200: CrmLeadSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    deleteLead: {
      method: 'DELETE',
      path: '/api/crm/leads/:id',
      responses: {
        200: z.object({ message: z.string(), code: z.string() }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    convertLead: {
      method: 'POST',
      path: '/api/crm/leads/:id/convert',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ branchId: UUIDSchema.optional() }),
      responses: {
        200: z.object({ studentId: UUIDSchema, leadId: UUIDSchema }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
    listActivities: {
      method: 'GET',
      path: '/api/crm/leads/:leadId/activities',
      pathParams: z.object({ leadId: UUIDSchema }),
      responses: {
        200: z.array(CrmActivitySchema),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    createActivity: {
      method: 'POST',
      path: '/api/crm/leads/:leadId/activities',
      pathParams: z.object({ leadId: UUIDSchema }),
      body: CrmActivityWriteSchema,
      responses: {
        201: CrmActivitySchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    updateActivity: {
      method: 'PATCH',
      path: '/api/crm/activities/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: CrmActivityWriteSchema,
      responses: {
        200: CrmActivitySchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    deleteActivity: {
      method: 'DELETE',
      path: '/api/crm/activities/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.object({ message: z.string(), code: z.string() }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    listTasks: {
      method: 'GET',
      path: '/api/crm/tasks',
      query: z.object({
        assigneeId: UUIDSchema.optional(),
        status: z.string().optional(),
        leadId: UUIDSchema.optional(),
        search: z.string().optional(),
      }),
      responses: {
        200: z.array(CrmActivitySchema),
        403: ApiErrorSchema,
      },
    },
    createTask: {
      method: 'POST',
      path: '/api/crm/tasks',
      body: CrmTaskWriteSchema,
      responses: {
        201: CrmActivitySchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
      },
    },
    updateTask: {
      method: 'PATCH',
      path: '/api/crm/tasks/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: CrmTaskWriteSchema,
      responses: {
        200: CrmActivitySchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    listCalls: {
      method: 'GET',
      path: '/api/crm/leads/:leadId/calls',
      pathParams: z.object({ leadId: UUIDSchema }),
      responses: {
        200: z.array(CrmCallSchema),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    logCall: {
      method: 'POST',
      path: '/api/crm/leads/:leadId/calls',
      pathParams: z.object({ leadId: UUIDSchema }),
      body: z.object({
        response: z.string(),
        obstacle: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        calledAt: z.string().optional(),
      }),
      responses: {
        201: CrmCallSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    deleteCall: {
      method: 'DELETE',
      path: '/api/crm/calls/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.object({ message: z.string(), code: z.string() }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    getAnalytics: {
      method: 'GET',
      path: '/api/crm/analytics',
      responses: {
        200: z.object({
          totalLeads: z.number(),
          won: z.number(),
          lost: z.number(),
          open: z.number(),
          conversionRate: z.number(),
          funnel: z.array(z.object({ stage: z.string(), count: z.number() })),
          sources: z.array(z.object({ source: z.string(), total: z.number(), won: z.number() })),
          leaderboard: z.array(z.object({
            ownerUserId: UUIDSchema.nullable(),
            ownerName: z.string().nullable(),
            total: z.number(),
            won: z.number(),
            openTasks: z.number(),
            overdueTasks: z.number(),
          })),
          tasks: z.object({ open: z.number(), overdue: z.number() }),
          obstacles: z.array(z.object({ obstacle: z.string(), count: z.number() })).optional(),
        }),
        403: ApiErrorSchema,
      },
    },
    getAtRisk: {
      method: 'GET',
      path: '/api/crm/at-risk',
      responses: {
        200: z.array(z.object({
          studentId: UUIDSchema,
          fullName: z.string(),
          phone: z.string().nullable(),
          parentName: z.string().nullable(),
          parentPhone: z.string().nullable(),
          branchId: UUIDSchema.nullable(),
          outstanding: z.number(),
          reasons: z.array(z.string()),
        })),
        403: ApiErrorSchema,
      },
    },

    // Lists — named groups of leads, like a WhatsApp broadcast list
    listLists: {
      method: 'GET',
      path: '/api/crm/lists',
      responses: { 200: z.array(CrmListSchema), 403: ApiErrorSchema },
    },
    createList: {
      method: 'POST',
      path: '/api/crm/lists',
      body: CrmListWriteSchema,
      responses: { 201: CrmListSchema, 400: ApiErrorSchema, 403: ApiErrorSchema, 409: ApiErrorSchema },
    },
    updateList: {
      method: 'PATCH',
      path: '/api/crm/lists/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: CrmListWriteSchema,
      responses: { 200: CrmListSchema, 400: ApiErrorSchema, 403: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
    deleteList: {
      method: 'DELETE',
      path: '/api/crm/lists/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.object({ success: z.boolean(), code: z.string(), message: z.string() }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    listMembers: {
      method: 'GET',
      path: '/api/crm/lists/:id/leads',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: z.array(CrmLeadSchema), 403: ApiErrorSchema, 404: ApiErrorSchema },
    },
    addMembers: {
      method: 'POST',
      path: '/api/crm/lists/:id/leads',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ leadIds: z.array(UUIDSchema).min(1) }),
      responses: {
        200: z.object({ success: z.boolean(), added: z.number(), memberCount: z.number() }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    removeMember: {
      method: 'DELETE',
      path: '/api/crm/lists/:id/leads/:leadId',
      pathParams: z.object({ id: UUIDSchema, leadId: UUIDSchema }),
      responses: {
        200: z.object({ success: z.boolean(), code: z.string(), message: z.string() }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  },

  // WhatsApp Cloud API (foundation) — per-tenant number, settings, templates, inbox
  waCloud: {
    getAccount: {
      method: 'GET',
      path: '/api/wa/account',
      responses: {
        200: z.object({
          status: z.string(),
          wabaId: z.string().nullable(),
          phoneNumberId: z.string().nullable(),
          displayPhoneNumber: z.string().nullable(),
          verifiedName: z.string().nullable(),
          qualityRating: z.string().nullable(),
          connectedAt: z.string().nullable(),
        }),
        403: ApiErrorSchema,
      },
    },
    disconnect: {
      method: 'POST',
      path: '/api/wa/account/disconnect',
      body: z.object({}).optional(),
      responses: { 200: z.object({ message: z.string(), code: z.string() }), 400: ApiErrorSchema, 403: ApiErrorSchema },
    },
    // Embedded Signup, step 1: hand the browser the public ids it needs to open
    // Meta's dialog. Server-side so the app id and config id are not baked into
    // the bundle, and so a tenant gets a clear error when Meta is not set up yet
    // rather than a dialog that fails on Meta's side.
    connectStart: {
      method: 'POST',
      path: '/api/wa/connect/start',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ appId: z.string(), configId: z.string(), graphVersion: z.string() }),
        403: ApiErrorSchema,
        501: ApiErrorSchema,
      },
    },
    // Embedded Signup, step 2: trade the code for a token, verify the WABA the
    // browser claims really belongs to it, subscribe our webhook, store the token.
    connectComplete: {
      method: 'POST',
      path: '/api/wa/connect/complete',
      body: z.object({
        code: z.string().min(1),
        wabaId: z.string().optional(),
        phoneNumberId: z.string().optional(),
      }),
      responses: {
        200: z.object({
          status: z.string(),
          wabaId: z.string().nullable(),
          phoneNumberId: z.string().nullable(),
          displayPhoneNumber: z.string().nullable(),
          verifiedName: z.string().nullable(),
          qualityRating: z.string().nullable(),
          connectedAt: z.string().nullable(),
        }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        501: ApiErrorSchema,
      },
    },
    getSettings: {
      method: 'GET',
      path: '/api/wa/settings',
      responses: { 200: WaSettingsSchema, 403: ApiErrorSchema },
    },
    updateSettings: {
      method: 'PUT',
      path: '/api/wa/settings',
      body: WaSettingsSchema.partial(),
      responses: { 200: WaSettingsSchema, 400: ApiErrorSchema, 403: ApiErrorSchema },
    },
    listTemplates: {
      method: 'GET',
      path: '/api/wa/templates',
      responses: { 200: z.array(WaTemplateSchema), 403: ApiErrorSchema },
    },
    upsertTemplate: {
      method: 'PUT',
      path: '/api/wa/templates/:key',
      pathParams: z.object({ key: z.string() }),
      body: z.object({
        metaTemplateName: z.string().nullable().optional(),
        category: z.string().optional(),
        language: z.string().optional(),
        body: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
      responses: { 200: WaTemplateSchema, 400: ApiErrorSchema, 403: ApiErrorSchema },
    },
    send: {
      method: 'POST',
      path: '/api/wa/send',
      body: z.object({
        to: z.string().optional(),
        templateKey: z.string().optional(),
        text: z.string().optional(),
        // Positional {{1}}, {{2}}… values, template sends only.
        templateParams: z.array(z.string()).optional(),
        studentId: UUIDSchema.optional(),
        leadId: UUIDSchema.optional(),
      }),
      responses: { 200: WaMessageSchema, 400: ApiErrorSchema, 403: ApiErrorSchema, 501: ApiErrorSchema },
    },
    listConversations: {
      method: 'GET',
      path: '/api/wa/conversations',
      responses: { 200: z.array(WaConversationSchema), 403: ApiErrorSchema },
    },
    getMessages: {
      method: 'GET',
      path: '/api/wa/conversations/:id/messages',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: z.array(WaMessageSchema), 403: ApiErrorSchema, 404: ApiErrorSchema },
    },
    webhookVerify: {
      method: 'GET',
      path: '/api/public/wa/webhook',
      query: z.object({
        'hub.mode': z.string().optional(),
        'hub.verify_token': z.string().optional(),
        'hub.challenge': z.string().optional(),
      }),
      responses: { 200: z.string(), 403: z.string() },
    },
    webhookReceive: {
      method: 'POST',
      path: '/api/public/wa/webhook',
      body: z.any(),
      responses: { 200: z.object({ received: z.boolean() }) },
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
        400: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
    list: {
      method: 'GET',
      path: '/api/demo-leads',
      responses: {
        200: z.array(z.any()),
        401: ApiErrorSchema,
      },
    },
  },

  // Public, unauthenticated student profile (resolved by QR token). No
  // `authorization` header → auth is NOT required. See routes/public-students.ts.
  publicStudents: {
    profile: {
      method: 'GET',
      path: '/api/public/students/:qrToken',
      pathParams: z.object({ qrToken: z.string().min(16).max(64) }),
      responses: {
        200: z.object({
          student: z.object({
            firstName: z.string(),
            lastName: z.string(),
            branchName: z.string(),
            academyName: z.string(),
          }),
          courses: z.array(z.object({
            courseName: z.string(),
            className: z.string().nullable(),
            status: z.string(),
            paymentStatus: z.string(),
            enrollmentDate: z.string().nullable(),
          })),
          attendance: z.object({
            totalSessions: z.number(),
            presentCount: z.number(),
            absentCount: z.number(),
            attendanceRate: z.number(),
            recent: z.array(z.object({
              sessionStartDate: z.string(),
              sessionNumber: z.number().nullable().optional(),
              className: z.string(),
              roomCode: z.string().nullable(),
              isPresent: z.boolean(),
              status: z.enum(['PRESENT', 'ABSENT', 'SUBSTITUTED']).optional(),
              /** When the student was marked in; null for an absence. */
              checkedInAt: z.string().nullable().optional(),
              substitutedInClassName: z.string().nullable().optional(),
            })),
          }),
          exams: z.array(z.object({
            examName: z.string(),
            courseName: z.string(),
            examDate: z.string(),
            grade: z.string(),
            maxGrade: z.number().nullable().optional(),
          })).optional(),
          /**
           * Every payment the student carries, across all three billing models.
           * This page has no login, so this is the family's full financial picture
           * behind nothing but the QR token — see the PRIVACY note on the route.
           */
          payments: z.object({
            monthly: z.array(z.object({
              courseName: z.string(),
              className: z.string().nullable(),
              billingYear: z.number(),
              billingMonth: z.number(),
              amountDue: z.number(),
              amountPaid: z.number(),
              status: z.string(),
              dueDate: z.string().nullable(),
              paidDate: z.string().nullable(),
              enrollmentId: z.string().nullable().optional(),
            })),
            sessions: z.array(z.object({
              courseName: z.string(),
              className: z.string().nullable(),
              sessionNumber: z.number().nullable(),
              sessionStartDate: z.string().nullable(),
              attendanceState: z.string().nullable(),
              amountDue: z.number(),
              amountPaid: z.number(),
              status: z.string(),
              paidDate: z.string().nullable(),
              enrollmentId: z.string().nullable().optional(),
            })),
            packages: z.array(z.object({
              courseName: z.string(),
              sessionsTotal: z.number(),
              sessionsUsed: z.number(),
              amountDue: z.number(),
              amountPaid: z.number(),
              status: z.string(),
              purchasedAt: z.string().nullable(),
              enrollmentId: z.string().nullable().optional(),
            })),
            oneTime: z.array(z.object({
              courseName: z.string(),
              className: z.string().nullable(),
              paymentMode: z.string(),
              originalPrice: z.number(),
              discountAmount: z.number(),
              finalPrice: z.number(),
              downPayment: z.number(),
              amountPaid: z.number(),
              totalRefunded: z.number(),
              remaining: z.number(),
              status: z.string(),
              enrollmentDate: z.string().nullable(),
              instalments: z.array(z.object({
                amount: z.number(),
                paymentDate: z.string().nullable(),
              })),
            })),
            refunds: z.array(z.object({
              courseName: z.string().nullable(),
              amount: z.number(),
              refundDate: z.string().nullable(),
              type: z.string().nullable(),
            })),
            totalPaid: z.number(),
            totalOutstanding: z.number(),
            totalRefunded: z.number(),
          }).optional(),
        }),
        404: ApiErrorSchema,
        429: ApiErrorSchema,
        500: ApiErrorSchema,
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
        400: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    getLinkedCourses: {
      method: 'GET',
      path: '/api/master-courses/:id/linked-courses',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(LinkedCourseSummarySchema),
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/master-courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateMasterCourseSchema,
      responses: {
        200: MasterCourseSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/master-courses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
      },
    },
    deactivate: {
      method: 'POST',
      path: '/api/master-courses/:id/deactivate',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: MasterCourseSchema,
        404: ApiErrorSchema,
        409: z.object({
          message: z.string(),
          code: z.string().optional(),
          courses: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
        }),
      },
    },
    activate: {
      method: 'POST',
      path: '/api/master-courses/:id/activate',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: MasterCourseSchema,
        404: ApiErrorSchema,
      },
    },
    addCourse: {
      method: 'POST',
      path: '/api/master-courses/:id/courses',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ courseId: UUIDSchema }),
      responses: {
        200: ApiErrorSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    removeCourse: {
      method: 'DELETE',
      path: '/api/master-courses/:id/courses/:courseId',
      pathParams: z.object({ id: UUIDSchema, courseId: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    availableCourses: {
      method: 'GET',
      path: '/api/master-courses/:id/available-courses',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(z.any()),
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    cancel: {
      method: 'POST',
      path: '/api/master-enrollments/:id/cancel',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    getPayments: {
      method: 'GET',
      path: '/api/master-enrollments/:id/payments',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: z.array(z.any()), 404: ApiErrorSchema },
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
        400: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    listRefunds: {
      method: 'GET',
      path: '/api/master-enrollments/:id/refunds',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: z.array(z.any()), 404: ApiErrorSchema },
    },
    getById: {
      method: 'GET',
      path: '/api/master-enrollments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: { 200: z.any(), 404: ApiErrorSchema },
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
        400: ApiErrorSchema,
      },
    },
    // Put many classes in one room in a single call — assigning rooms to an
    // existing timetable one PATCH at a time is dozens of round trips.
    assignRoom: {
      method: 'POST',
      path: '/api/classes/assign-room',
      body: z.object({
        classIds: z.array(UUIDSchema).min(1).max(500),
        // null clears the room on every selected class.
        roomId: UUIDSchema.nullable(),
      }),
      responses: {
        200: z.object({ updated: z.number() }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
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
        // Optional: TEACHER-type companies have no instructor on classes — the
        // check then runs against all of the company's classes.
        instructorId: OptionalUUIDSchema,
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
        400: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    getById: {
      method: 'GET',
      path: '/api/classes/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: ClassSchema,
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/classes/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateClassSchema,
      responses: {
        200: ClassSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/classes/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    finish: {
      method: 'POST',
      path: '/api/classes/:id/finish',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ClassSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    listByMasterEnrollment: {
      method: 'GET' as const,
      path: '/api/master-class-enrollments',
      query: z.object({ masterEnrollmentId: UUIDSchema }),
      responses: {
        200: z.array(z.any()),
        403: ApiErrorSchema,
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
        400: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    createRefund: {
      method: 'POST',
      path: '/api/enrollments/:id/refunds',
      pathParams: z.object({ id: UUIDSchema }),
      body: CreateRefundSchema,
      responses: {
        201: RefundSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    getPayments: {
      method: 'GET',
      path: '/api/enrollments/:id/payments',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(EnrollmentPaymentSchema),
        404: ApiErrorSchema,
      },
    },
    addPayment: {
      method: 'POST',
      path: '/api/enrollments/:id/payments',
      pathParams: z.object({ id: UUIDSchema }),
      body: CreateEnrollmentPaymentSchema,
      responses: {
        201: EnrollmentPaymentSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    getById: {
      method: 'GET',
      path: '/api/enrollments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: EnrollmentSchema,
        404: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/enrollments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    holdSubscription: {
      method: 'POST',
      path: '/api/enrollments/:id/hold',
      pathParams: z.object({ id: UUIDSchema }),
      // Hold is indefinite ("until resumed"). `months` is optional/legacy and unused for billing.
      body: z.object({ months: z.number().int().min(1).max(12).optional() }).optional(),
      responses: {
        200: EnrollmentSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    resumeSubscription: {
      method: 'POST',
      path: '/api/enrollments/:id/resume',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: EnrollmentSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    changeClass: {
      method: 'POST',
      path: '/api/enrollments/:id/change-class',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ classId: UUIDSchema }),
      responses: {
        200: EnrollmentSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
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
        source: z.enum(['ENROLLMENT', 'PRODUCT_SALE', 'MASTER_ENROLLMENT', 'EVENT', 'SUBSCRIPTION', 'SESSION', 'ALL']).optional(),
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
        400: ApiErrorSchema,
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
            salaryType: z.string().optional(),
            sessionCount: z.number().optional(),
            sessionRate: z.number().optional(),
            percentageRate: z.number().optional(),
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
        400: ApiErrorSchema,
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
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    getEmployeeSalaryHistory: {
      method: 'GET',
      path: '/api/expenses/employee/:employeeId/salary-history',
      pathParams: z.object({ employeeId: UUIDSchema }),
      responses: {
        200: z.array(ExpensePaymentSchema),
        404: ApiErrorSchema,
      },
    },
    getEmployeePercentageSummary: {
      method: 'GET',
      path: '/api/expenses/employee/:employeeId/percentage-summary',
      pathParams: z.object({ employeeId: UUIDSchema }),
      responses: {
        200: z.object({
          salaryType: z.string(),
          percentageRate: z.number(),
          totalPaid: z.number(),   // net amount students have paid across the teacher's classes
          accrued: z.number(),     // percentageRate% of totalPaid
          withdrawn: z.number(),   // base salary already withdrawn
          owed: z.number(),        // accrued - withdrawn (>= 0), available to withdraw now
        }),
        404: ApiErrorSchema,
      },
    },
    previewEmployeeBackPay: {
      method: 'GET',
      path: '/api/expenses/employee/:employeeId/back-pay-preview',
      pathParams: z.object({ employeeId: UUIDSchema }),
      query: z.object({ upTo: z.string().optional() }),
      responses: {
        200: z.object({
          employee: z.object({
            id: UUIDSchema,
            firstName: z.string(),
            lastName: z.string(),
            hireDate: z.string(),
            salary: z.number(),
            branchId: UUIDSchema.nullable(),
          }),
          upTo: z.string(),
          periods: z.array(z.object({
            monthKey: z.string(),
            monthLabel: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            daysInMonth: z.number(),
            daysWorked: z.number(),
            proRated: z.boolean(),
            amount: z.number(),
            alreadyPaid: z.boolean(),
          })),
          totalToCreate: z.number(),
          totalAlreadyPaid: z.number(),
        }),
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    createEmployeeBackPay: {
      method: 'POST',
      path: '/api/expenses/employee/:employeeId/back-pay',
      pathParams: z.object({ employeeId: UUIDSchema }),
      body: z.object({ upTo: z.string().optional() }),
      responses: {
        200: z.object({
          created: z.number(),
          skipped: z.number(),
          totalAmount: z.number(),
          payments: z.array(ExpensePaymentSchema),
          message: z.string(),
          code: z.string(),
        }),
        201: z.object({
          created: z.number(),
          skipped: z.number(),
          totalAmount: z.number(),
          payments: z.array(ExpensePaymentSchema),
          message: z.string(),
          code: z.string(),
        }),
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    getById: {
      method: 'GET',
      path: '/api/expenses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: ExpenseSchema,
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/expenses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateExpenseSchema,
      responses: {
        200: ExpenseSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/expenses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    payRecurring: {
      method: 'POST',
      path: '/api/expenses/:id/pay',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ date: z.string().optional() }),
      responses: {
        201: ExpensePaymentSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    getPayments: {
      method: 'GET',
      path: '/api/expenses/:id/payments',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(ExpensePaymentSchema),
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
        403: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/installments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    unpay: {
      method: 'DELETE',
      path: '/api/installments/:id/schedule/:scheduleId/pay',
      pathParams: z.object({ id: UUIDSchema, scheduleId: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/expense-payments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
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
    getProfile: {
      method: 'GET' as const,
      path: '/api/companies/profile',
      responses: {
        200: z.object({
          company: z.object({
            id: UUIDSchema,
            name: z.string(),
            code: z.string().nullable(),
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
            plan: z.string().optional(),
            timezone: z.string().nullable(),
            currency: z.string().nullable(),
            locale: z.string().nullable(),
            isActive: z.boolean(),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
          subscription: z.object({
            status: z.string(),
            price: z.number(),
            trialStartDate: z.string().nullable(),
            trialEndDate: z.string().nullable(),
            subscriptionStartDate: z.string().nullable(),
            subscriptionEndDate: z.string().nullable(),
          }).nullable(),
        }),
        401: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    getSettings: {
      method: 'GET' as const,
      path: '/api/companies/settings',
      responses: {
        200: z.object({
          id: UUIDSchema,
          name: z.string(),
          globalExpenseAllocation: GlobalExpenseAllocationSchema,
          autoManageSessions: z.boolean(),
        }),
        401: ApiErrorSchema,
      },
    },
    getCardDesign: {
      method: 'GET' as const,
      path: '/api/companies/card-design',
      responses: {
        200: CardDesignSchema,
        401: ApiErrorSchema,
      },
    },
    updateCardDesign: {
      method: 'PUT' as const,
      path: '/api/companies/card-design',
      body: CardDesignSchema,
      responses: {
        200: CardDesignSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
      },
    },
    updateSettings: {
      method: 'PATCH' as const,
      path: '/api/companies/settings',
      body: z.object({
        globalExpenseAllocation: GlobalExpenseAllocationSchema.optional(),
        autoManageSessions: z.boolean().optional(),
      }),
      responses: {
        200: z.object({
          id: UUIDSchema,
          name: z.string(),
          globalExpenseAllocation: GlobalExpenseAllocationSchema,
          autoManageSessions: z.boolean(),
        }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
      },
    },
    upgradePlan: {
      method: 'POST' as const,
      path: '/api/companies/upgrade-plan',
      body: z.object({ plan: z.enum(['SIMPLE', 'ADVANCED']) }),
      responses: {
        200: z.object({ plan: z.string() }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/employees/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateEmployeeSchema,
      responses: {
        200: EmployeeSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/employees/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        400: z.object({
          message: z.string(),
          assignedClasses: z.array(z.object({
            id: UUIDSchema,
            name: z.string(),
          })).optional(),
        }),
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/withdrawals/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateWithdrawalSchema,
      responses: {
        200: WithdrawalSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/withdrawals/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
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
        404: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    restock: {
      method: 'POST',
      path: '/api/products/:id/restock',
      pathParams: z.object({ id: UUIDSchema }),
      body: RestockProductSchema,
      responses: {
        200: ProductSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/products/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateProductSchema,
      responses: {
        200: ProductSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/products/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
      },
    },
    list: {
      method: 'GET',
      path: '/api/product-sales',
      query: z.object({
        branchId: OptionalUUIDSchema,
        productId: OptionalUUIDSchema,
        studentId: OptionalUUIDSchema,
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
          totalCost: z.number(),
          totalProfit: z.number(),
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
        404: ApiErrorSchema,
      },
    },
    listRefunds: {
      method: 'GET',
      path: '/api/product-sales/:id/refunds',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.array(RefundSchema),
        404: ApiErrorSchema,
      },
    },
    createRefund: {
      method: 'POST',
      path: '/api/product-sales/:id/refunds',
      pathParams: z.object({ id: UUIDSchema }),
      body: CreateRefundSchema,
      responses: {
        201: RefundSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  },

  // Course ↔ product links (Educational Books admin)
  courseProducts: {
    list: {
      method: 'GET',
      path: '/api/course-products',
      query: z.object({ courseId: OptionalUUIDSchema }),
      responses: {
        200: z.array(CourseProductSchema),
        403: ApiErrorSchema,
      },
    },
    link: {
      method: 'POST',
      path: '/api/course-products',
      body: CreateCourseProductSchema,
      responses: {
        201: CourseProductSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/course-products/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateCourseProductSchema,
      responses: {
        200: CourseProductSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    unlink: {
      method: 'DELETE',
      path: '/api/course-products/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string(), code: z.string() }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  },

  // Educational Books aggregate views (who bought / who didn't)
  educationalBooks: {
    courses: {
      method: 'GET',
      path: '/api/educational-books/courses',
      responses: {
        200: z.array(EducationalBooksCourseSummarySchema),
        403: ApiErrorSchema,
      },
    },
    courseDetail: {
      method: 'GET',
      path: '/api/educational-books/course/:courseId',
      pathParams: z.object({ courseId: UUIDSchema }),
      responses: {
        200: EducationalBooksCourseDetailSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
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
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/debts/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.any(),
      responses: {
        200: z.any(),
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/debts/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.any(),
        404: ApiErrorSchema,
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
          unattributedRefunds: z.number().optional(),
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
        400: ApiErrorSchema,
      },
    },
    deleteAdjustment: {
      method: 'DELETE',
      path: '/api/cash/adjustments/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ message: z.string(), id: UUIDSchema }),
        404: ApiErrorSchema,
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
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        branchId: OptionalUUIDSchema,
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
        401: ApiErrorSchema,
        404: ApiErrorSchema,
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
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  },

  // Obscure, unauthenticated read-only endpoint for the owner's local admin
  // console (cross-tenant company/subscription numbers). The path is the secret.
  adminSecret: {
    getSubscriptions: {
      method: 'GET',
      path: '/api/karim-admin-secret',
      responses: {
        200: z.array(
          z.object({
            company_id: z.string(),
            company_name: z.string(),
            company_active: z.boolean().nullable(),
            currency: z.string().nullable(),
            company_created_at: z.string().nullable(),
            company_type: z.string().nullable(),
            mobile: z.string().nullable(),
            subscription_type: z.string().nullable(),
            price: z.number().nullable(),
            start_date: z.string().nullable(),
            end_date: z.string().nullable(),
            employee_count: z.number(),
            branch_count: z.number(),
            student_count: z.number(),
          })
        ),
        500: z.object({ message: z.string() }),
      },
    },
    // Extend a company's subscription by a preset number of months (added onto
    // the current end date, or from today if already expired).
    extendSubscription: {
      method: 'POST',
      path: '/api/karim-admin-secret/companies/:companyId/extend',
      pathParams: z.object({ companyId: UUIDSchema }),
      body: z.object({ months: z.number().int().positive() }),
      responses: {
        200: z.object({ success: z.boolean(), end_date: z.string().nullable() }),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    // Promote a TRIAL (or any status) subscription to ACTIVE.
    // Park a tenant who stopped paying: EXPIRED, ended today. Activate reverses it.
    deactivateSubscription: {
      method: 'POST',
      path: '/api/karim-admin-secret/companies/:companyId/deactivate',
      pathParams: z.object({ companyId: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), subscription_type: z.string().nullable() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    // User accounts, per tenant. Passwords are never returned.
    listUsers: {
      method: 'GET',
      path: '/api/karim-admin-secret/users',
      query: z.object({ companyId: z.string().optional() }),
      responses: {
        200: z.array(AdminUserSchema),
        500: z.object({ message: z.string() }),
      },
    },
    createUser: {
      method: 'POST',
      path: '/api/karim-admin-secret/users',
      body: z.object({
        companyId: UUIDSchema,
        email: z.string().email(),
        password: z.string().min(6),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        role: z.string().min(1),
      }),
      responses: {
        201: AdminUserSchema,
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        409: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    deleteUser: {
      method: 'DELETE',
      path: '/api/karim-admin-secret/users/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.object({ success: z.boolean() }),
        404: z.object({ message: z.string() }),
        409: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    // Move an account to another tenant, for a debugging login that needs to see
    // a customer's data. The user's old branch/employee/permission links point at
    // rows the new tenant doesn't own, so the move clears them rather than
    // carrying them across.
    moveUserCompany: {
      method: 'PATCH',
      path: '/api/karim-admin-secret/users/:id/company',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ companyId: UUIDSchema }),
      responses: {
        200: AdminUserSchema,
        400: z.object({ message: z.string() }),
        // Anything but the debug account.
        403: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        409: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    activateSubscription: {
      method: 'POST',
      path: '/api/karim-admin-secret/companies/:companyId/activate',
      pathParams: z.object({ companyId: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), subscription_type: z.string().nullable() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    // Switch a company's registration type between ACADEMY and TEACHER.
    setQrCardsEnabled: {
      method: 'POST',
      path: '/api/karim-admin-secret/companies/:companyId/qr-cards/enabled',
      pathParams: z.object({ companyId: UUIDSchema }),
      body: z.object({ enabled: z.boolean() }),
      responses: {
        200: z.object({ success: z.boolean(), qr_cards_enabled: z.boolean() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    generateQrCards: {
      method: 'POST',
      path: '/api/karim-admin-secret/companies/:companyId/qr-cards',
      pathParams: z.object({ companyId: UUIDSchema }),
      body: z.object({
        count: z.number().int().min(1).max(2000),
        // Optional so an older caller still mints a run; omitted means type 1,
        // matching the column default and the cards minted before types existed.
        poolType: PoolTypeSchema.optional(),
      }),
      responses: {
        200: z.object({
          success: z.boolean(), created: z.number(), from: z.number(), to: z.number(),
          poolType: z.number(),
        }),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    qrCardStats: {
      method: 'GET',
      path: '/api/karim-admin-secret/companies/:companyId/qr-cards',
      pathParams: z.object({ companyId: UUIDSchema }),
      responses: {
        200: z.object({ qr_cards_enabled: z.boolean(), total: z.number(), linked: z.number() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    // Throw away a client's pool. Linked cards are kept unless includeLinked is
    // asked for explicitly — they are in a student's pocket.
    deleteQrCards: {
      method: 'DELETE',
      path: '/api/karim-admin-secret/companies/:companyId/qr-cards',
      pathParams: z.object({ companyId: UUIDSchema }),
      query: z.object({ includeLinked: z.enum(['true', 'false']).optional() }),
      responses: {
        200: z.object({
          success: z.boolean(),
          deleted: z.number(),
          /** How many of the deleted cards had a student on them. */
          unlinkedStudents: z.number(),
          /** Linked cards left behind because includeLinked was not asked for. */
          keptLinked: z.number(),
          remaining: z.number(),
        }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    setCompanyType: {
      method: 'POST',
      path: '/api/karim-admin-secret/companies/:companyId/type',
      pathParams: z.object({ companyId: UUIDSchema }),
      body: z.object({ type: z.enum(['ACADEMY', 'TEACHER']) }),
      responses: {
        200: z.object({ success: z.boolean(), company_type: z.string() }),
        400: z.object({ message: z.string() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    // Permanently delete a company and ALL its data (FK cascade). Irreversible.
    deleteCompany: {
      method: 'DELETE',
      path: '/api/karim-admin-secret/companies/:companyId',
      pathParams: z.object({ companyId: UUIDSchema }),
      responses: {
        200: z.object({ success: z.boolean(), company_name: z.string() }),
        404: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
    // Platform-owned Telegram bot pool — list bots and which company claimed each.
    listTelegramBots: {
      method: 'GET',
      path: '/api/karim-admin-secret/telegram-bots',
      responses: {
        200: z.object({
          bots: z.array(z.object({
            id: z.string(),
            bot_username: z.string(),
            assigned_company_id: z.string().nullable(),
            company_name: z.string().nullable(),
            assigned_at: z.string().nullable(),
          })),
          total: z.number(),
          available: z.number(),
        }),
        500: z.object({ message: z.string() }),
      },
    },
    // Add a bot (created in @BotFather) to the pool.
    addTelegramBot: {
      method: 'POST',
      path: '/api/karim-admin-secret/telegram-bots',
      body: z.object({ botToken: z.string() }),
      responses: {
        200: z.object({ success: z.boolean(), bot_username: z.string(), total: z.number(), available: z.number() }),
        400: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },

    // ─── Offline desktop licenses ─────────────────────────────────────────
    // Static /licenses paths are registered before the /:id ones (itty-router
    // matches in registration order).
    listLicenses: {
      method: 'GET',
      path: '/api/karim-admin-secret/licenses',
      responses: { 200: z.array(LicenseSchema), 500: z.object({ message: z.string() }) },
    },
    createLicense: {
      method: 'POST',
      path: '/api/karim-admin-secret/licenses',
      body: z.object({
        tier: z.enum(['TEACHER', 'ACADEMY']).optional(),
        label: z.string().optional(),
        phone: z.string().optional(),
        notes: z.string().optional(),
      }),
      responses: { 201: LicenseSchema, 500: z.object({ message: z.string() }) },
    },
    activateLicense: {
      method: 'POST',
      path: '/api/karim-admin-secret/licenses/:id/activate',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({
        activationEndsAt: z.string().nullable().optional(),
        price: z.number().nullable().optional(),
      }),
      responses: { 200: LicenseSchema, 404: z.object({ message: z.string() }), 500: z.object({ message: z.string() }) },
    },
    setLicensePrice: {
      method: 'POST',
      path: '/api/karim-admin-secret/licenses/:id/price',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ price: z.number().nullable() }),
      responses: { 200: LicenseSchema, 404: z.object({ message: z.string() }), 500: z.object({ message: z.string() }) },
    },
    extendTrial: {
      method: 'POST',
      path: '/api/karim-admin-secret/licenses/:id/extend-trial',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ days: z.number().int().positive() }),
      responses: { 200: LicenseSchema, 404: z.object({ message: z.string() }), 500: z.object({ message: z.string() }) },
    },
    resetDevice: {
      method: 'POST',
      path: '/api/karim-admin-secret/licenses/:id/reset-device',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: { 200: LicenseSchema, 404: z.object({ message: z.string() }), 500: z.object({ message: z.string() }) },
    },
    setLicenseTier: {
      method: 'POST',
      path: '/api/karim-admin-secret/licenses/:id/tier',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ tier: z.enum(['TEACHER', 'ACADEMY']) }),
      responses: { 200: LicenseSchema, 404: z.object({ message: z.string() }), 500: z.object({ message: z.string() }) },
    },
    issueLicense: {
      method: 'POST',
      path: '/api/karim-admin-secret/licenses/:id/issue',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: { 200: LicenseSchema, 404: z.object({ message: z.string() }), 500: z.object({ message: z.string() }) },
    },
    setTrialEndDate: {
      method: 'POST',
      path: '/api/karim-admin-secret/licenses/:id/trial-end',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ trialEndsAt: z.string() }),
      responses: { 200: LicenseSchema, 404: z.object({ message: z.string() }), 500: z.object({ message: z.string() }) },
    },
    setLicensePhone: {
      method: 'POST',
      path: '/api/karim-admin-secret/licenses/:id/phone',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ phone: z.string().nullable() }),
      responses: { 200: LicenseSchema, 404: z.object({ message: z.string() }), 500: z.object({ message: z.string() }) },
    },
    setLicenseRevoked: {
      method: 'POST',
      path: '/api/karim-admin-secret/licenses/:id/revoke',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ revoked: z.boolean() }),
      responses: { 200: LicenseSchema, 404: z.object({ message: z.string() }), 500: z.object({ message: z.string() }) },
    },
    deleteLicense: {
      method: 'DELETE',
      path: '/api/karim-admin-secret/licenses/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: { 200: z.object({ deleted: z.boolean() }), 500: z.object({ message: z.string() }) },
    },
  },

  // Migration routes (one-time use)
  migrations: {
    addMonthlySubscriptionRefunds: {
      method: 'POST',
      path: '/api/migrations/add-monthly-subscription-refunds',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    addCourseMonthlyPriceOverrides: {
      method: 'POST',
      path: '/api/migrations/add-course-monthly-price-overrides',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    addQrActivationToStudents: {
      method: 'POST',
      path: '/api/migrations/add-qr-activation-to-students',
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
    addCompanyType: {
      method: 'POST',
      path: '/api/migrations/add-company-type',
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
    addGenderToStudents: {
      method: 'POST',
      path: '/api/migrations/add-gender-to-students',
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
    createSubjectsFeature: {
      method: 'POST',
      path: '/api/migrations/create-subjects',
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
    createLevelsFeature: {
      method: 'POST',
      path: '/api/migrations/create-levels',
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
    addAcquisitionChannelToStudents: {
      method: 'POST',
      path: '/api/migrations/add-acquisition-channel-to-students',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    renameChurnToInactive: {
      method: 'POST',
      path: '/api/migrations/rename-churn-to-inactive',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    addStudentInactiveDateTrigger: {
      method: 'POST',
      path: '/api/migrations/add-student-inactive-date-trigger',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    addSubscriptionHold: {
      method: 'POST',
      path: '/api/migrations/add-subscription-hold',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    setupWhatsappTemplates: {
      method: 'POST',
      path: '/api/migrations/setup-whatsapp-templates',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    addStudentCodeToStudents: {
      method: 'POST',
      path: '/api/migrations/add-student-code',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    setupTelegram: {
      method: 'POST',
      path: '/api/migrations/setup-telegram',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    setupTelegramBotPool: {
      method: 'POST',
      path: '/api/migrations/setup-telegram-bot-pool',
      body: z.object({}).optional(),
      responses: {
        200: z.object({ success: z.boolean(), message: z.string() }),
        500: z.object({ success: z.boolean(), message: z.string(), error: z.string().optional() }),
      },
    },
    setupExamAbsenceAndTelegramTemplates: {
      method: 'POST',
      path: '/api/migrations/setup-exam-absence',
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
        403: ApiErrorSchema,
      },
    },
    get: {
      method: 'GET',
      path: '/api/users/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: SafeUserSchema,
        404: ApiErrorSchema,
        403: ApiErrorSchema,
      },
    },
    create: {
      method: 'POST',
      path: '/api/users',
      body: CreateUserSchema,
      responses: {
        201: SafeUserSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH',
      path: '/api/users/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: UpdateUserSchema,
      responses: {
        200: SafeUserSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    updatePermissions: {
      method: 'PATCH',
      path: '/api/users/:id/permissions',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ permissions: UserPermissionsSchema }),
      responses: {
        200: z.object({ message: z.string(), permissions: UserPermissionsSchema }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    resetPassword: {
      method: 'POST',
      path: '/api/users/:id/reset-password',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ password: z.string().min(6) }),
      responses: {
        200: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    deactivate: {
      method: 'POST',
      path: '/api/users/:id/deactivate',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    activate: {
      method: 'POST',
      path: '/api/users/:id/activate',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    convertEmployee: {
      method: 'POST',
      path: '/api/users/convert-employee',
      body: ConvertEmployeeToUserSchema,
      responses: {
        201: SafeUserSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE',
      path: '/api/users/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
        403: ApiErrorSchema,
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
        403: ApiErrorSchema,
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
        403: ApiErrorSchema,
      },
    },
    getById: {
      method: 'GET' as const,
      path: '/api/rooms/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.any(),
        404: ApiErrorSchema,
        403: ApiErrorSchema,
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
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/rooms/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({}).optional(),
      responses: {
        200: ApiErrorSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  },

  // ============================================================
  // Attendance Management
  // ============================================================
  attendance: {
    removeAttendee: {
      method: 'DELETE' as const,
      path: '/api/attendance/session/:sessionId/student/:studentId',
      pathParams: z.object({ sessionId: UUIDSchema, studentId: UUIDSchema }),
      responses: {
        200: z.object({ message: z.string(), code: z.string() }),
        401: ApiErrorSchema, 403: ApiErrorSchema, 404: ApiErrorSchema, 500: ApiErrorSchema,
      },
    },
    getBySession: {
      method: 'GET' as const,
      path: '/api/attendance/session/:sessionId',
      pathParams: z.object({ sessionId: UUIDSchema }),
      responses: {
        200: z.array(z.object({
          studentId: UUIDSchema,
          studentFirstName: z.string(),
          studentLastName: z.string(),
          studentCode: z.number().nullable().optional(),
          parentName: z.string().nullable().optional(),
          parentPhone: z.string().nullable().optional(),
          studentPhone: z.string().nullable().optional(),
          isPresent: z.boolean(),
          attendanceId: UUIDSchema.nullable().optional(),
          attendanceType: z.enum(['NORMAL', 'SUBSTITUTION']).nullable().optional(),
          homeClassName: z.string().nullable().optional(),
          isEnrolled: z.boolean().optional(),
          charge: z.object({
            status: z.string(),
            amountDue: z.number(),
            amountPaid: z.number(),
          }).nullable().optional(),
        })),
        401: ApiErrorSchema,
        402: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
    saveForSession: {
      method: 'POST' as const,
      path: '/api/attendance/session/:sessionId',
      pathParams: z.object({ sessionId: UUIDSchema }),
      body: z.object({ presentStudentIds: z.array(UUIDSchema) }),
      responses: {
        200: z.object({
          message: z.string(),
          presentCount: z.number(),
          // For PER_SESSION courses: the session charges created/updated by this
          // save that still need collection (payment_status PENDING). Empty/absent
          // for other course types.
          sessionCharges: z.array(SessionPaymentWithDetailsSchema).optional(),
        }),
        401: ApiErrorSchema,
        402: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
    checkinByQr: {
      method: 'POST' as const,
      path: '/api/attendance/session/:sessionId/checkin',
      pathParams: z.object({ sessionId: UUIDSchema }),
      body: z.object({ qrToken: z.string().min(1) }),
      responses: {
        200: z.object({
          studentId: UUIDSchema,
          studentFirstName: z.string(),
          studentLastName: z.string(),
          alreadyPresent: z.boolean(),
          attendanceType: z.enum(['NORMAL', 'SUBSTITUTION']).optional(),
          homeClassName: z.string().nullable().optional(),
          sessionNumber: z.number().nullable().optional(),
          code: z.string(),
          message: z.string(),
          // For PER_SESSION courses: the session charge created by this check-in.
          // paymentStatus PENDING → prompt to collect; COVERED → paid by package.
          sessionCharge: SessionPaymentWithDetailsSchema.nullable().optional(),
        }),
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        402: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        409: ApiErrorSchema,
        500: ApiErrorSchema,
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
          sessionNumber: z.number().nullable().optional(),
          classId: UUIDSchema,
          className: z.string(),
          roomCode: z.string().nullable(),
          isPresent: z.boolean(),
          status: z.enum(['PRESENT', 'ABSENT', 'SUBSTITUTED']).optional(),
          substitutedInClassName: z.string().nullable().optional(),
        })),
        401: ApiErrorSchema,
        402: ApiErrorSchema,
        403: ApiErrorSchema,
        500: ApiErrorSchema,
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
          sessionNumber: z.number().nullable().optional(),
          roomCode: z.string().nullable(),
          totalStudents: z.number(),
          presentCount: z.number(),
          absentCount: z.number(),
        })),
        401: ApiErrorSchema,
        402: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
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
        401: ApiErrorSchema,
        402: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
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
        401: ApiErrorSchema,
        402: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
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
          courseName: z.string().nullable(),
          roomCode: z.string().nullable(),
          paid: z.boolean().optional(),
        })),
        401: ApiErrorSchema,
        402: ApiErrorSchema,
        403: ApiErrorSchema,
        500: ApiErrorSchema,
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
        sessionNumber: z.number().int().positive().optional(),
        teachers: z.array(z.object({
          employeeId: UUIDSchema,
          role: z.enum(['PRIMARY', 'SUBSTITUTE', 'ASSISTANT']).optional(),
          status: z.enum(['PRESENT', 'ABSENT']).optional(),
          notes: z.string().nullish(),
        })).optional(),
      }),
      responses: {
        201: z.any(),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    prepare: {
      method: 'POST' as const,
      path: '/api/sessions/prepare',
      body: z.object({
        classId: UUIDSchema,
        branchId: UUIDSchema,
      }),
      responses: {
        200: z.any(),
        201: z.any(),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    autoSchedule: {
      method: 'POST' as const,
      path: '/api/sessions/auto-schedule',
      body: z.object({
        localDate: z.string().optional(),
        localTime: z.string().optional(),
      }),
      responses: {
        200: z.object({
          enabled: z.boolean(),
          started: z.number(),
          ended: z.number(),
        }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
      },
    },
    nextNumber: {
      method: 'GET' as const,
      path: '/api/sessions/next-number',
      query: z.object({ classId: z.string() }),
      responses: {
        200: z.object({ sessionNumber: z.number() }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/sessions/:id',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({
        sessionNumber: z.number().int().positive().optional(),
        notes: z.string().optional(),
      }),
      responses: {
        200: z.any(),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
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
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/sessions',
      query: z.object({
        branchId: z.string().optional(),
        classId: z.string().optional(),
        roomId: z.string().optional(),
        courseId: z.string().optional(),
        studentId: z.string().optional(),
        attendance: z.enum(['PRESENT', 'ABSENT']).optional(),
      }),
      responses: {
        200: z.array(z.any()),
        403: ApiErrorSchema,
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
        403: ApiErrorSchema,
      },
    },
    // The student's currently-running session (started, not yet ended), if any —
    // used to offer "mark present" when collecting a monthly payment by scan.
    // Returns the session info object, or null when none is in progress.
    activeForStudent: {
      method: 'GET' as const,
      path: '/api/sessions/active-for-student/:studentId',
      pathParams: z.object({ studentId: UUIDSchema }),
      responses: {
        200: z.any(),
        403: ApiErrorSchema,
      },
    },
    // The session a scanned student should be checked into: their running
    // session, or an active/imminent scheduled one (preparing it if needed).
    // localDate/localTime are the client's local clock. Returns info or null.
    checkinTarget: {
      method: 'GET' as const,
      path: '/api/sessions/checkin-target/:studentId',
      pathParams: z.object({ studentId: UUIDSchema }),
      query: z.object({
        localDate: z.string().optional(),
        localTime: z.string().optional(),
        branchId: z.string().optional(),
      }),
      responses: {
        200: z.any(),
        403: ApiErrorSchema,
      },
    },
    getById: {
      method: 'GET' as const,
      path: '/api/sessions/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.any(),
        404: ApiErrorSchema,
        403: ApiErrorSchema,
      },
    },
  },

  // ============================================================
  // Monthly Subscriptions  (NEW)
  // ============================================================
  monthlySubscriptions: {
    generate: {
      method: 'POST' as const,
      path: '/api/monthly-subscriptions/generate',
      body: GenerateMonthlyBillsSchema,
      responses: {
        201: z.object({ generated: z.number(), month: z.string() }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/monthly-subscriptions',
      // Inclusive (fromYear,fromMonth)..(toYear,toMonth) range so a single month,
      // a whole year, or a rolling "last N months" window (which can cross a year
      // boundary) are all expressible.
      query: z.object({
        fromYear: z.string(),
        fromMonth: z.string(),
        toYear: z.string(),
        toMonth: z.string(),
        branchId: z.string().optional(),
        courseId: z.string().optional(),
        status: z.string().optional(),
      }),
      responses: {
        200: z.array(MonthlyPaymentWithDetailsSchema),
        403: ApiErrorSchema,
      },
    },
    listHeld: {
      method: 'GET' as const,
      path: '/api/monthly-subscriptions/held',
      query: z.object({
        branchId: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(HeldSubscriptionSchema),
        403: ApiErrorSchema,
      },
    },
    summary: {
      method: 'GET' as const,
      path: '/api/monthly-subscriptions/summary',
      query: z.object({
        fromYear: z.string(),
        fromMonth: z.string(),
        toYear: z.string(),
        toMonth: z.string(),
        branchId: z.string().optional(),
      }),
      responses: {
        200: MonthlyPaymentSummarySchema,
        403: ApiErrorSchema,
      },
    },
    recordPayment: {
      method: 'POST' as const,
      path: '/api/monthly-subscriptions/:id/pay',
      pathParams: z.object({ id: UUIDSchema }),
      body: RecordMonthlyPaymentSchema,
      responses: {
        200: MonthlySubscriptionPaymentSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    voidPayment: {
      method: 'POST' as const,
      path: '/api/monthly-subscriptions/:id/void',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ reason: z.string().optional() }),
      responses: {
        200: MonthlySubscriptionPaymentSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    refund: {
      method: 'POST' as const,
      path: '/api/monthly-subscriptions/:id/refund',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({
        type: z.enum(['FULL', 'PARTIAL']),
        // Required (and validated) for PARTIAL; ignored for FULL.
        amount: z.number().positive().optional(),
        note: z.string().optional(),
        // What to do with the underlying subscription after refunding.
        subscriptionAction: z.enum(['KEEP', 'HOLD', 'CANCEL']).optional(),
      }),
      responses: {
        200: MonthlySubscriptionPaymentSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    listByCourse: {
      method: 'GET' as const,
      path: '/api/monthly-subscriptions/course/:courseId',
      pathParams: z.object({ courseId: UUIDSchema }),
      query: z.object({
        billingYear: z.string().optional(),
        billingMonth: z.string().optional(),
      }),
      responses: {
        200: z.array(MonthlyPaymentWithDetailsSchema),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    listByStudent: {
      method: 'GET' as const,
      path: '/api/monthly-subscriptions/student/:studentId',
      pathParams: z.object({ studentId: UUIDSchema }),
      responses: {
        200: z.array(MonthlyPaymentWithDetailsSchema),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    // Resolve a scanned student barcode (QR token) to that student and their
    // still-due monthly bills, so staff can collect a payment by scanning.
    byToken: {
      method: 'GET' as const,
      path: '/api/monthly-subscriptions/by-token/:qrToken',
      pathParams: z.object({ qrToken: z.string().min(1).max(64) }),
      responses: {
        200: z.object({
          studentId: z.string(),
          studentFirstName: z.string(),
          studentLastName: z.string(),
          dueMonths: z.array(MonthlyPaymentWithDetailsSchema),
        }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    // Monthly price overrides: let teachers change the course price for a
    // specific month. All student bills scale proportionally.
    setPriceOverride: {
      method: 'POST' as const,
      path: '/api/monthly-subscriptions/price-override',
      body: SetPriceOverrideSchema,
      responses: {
        200: z.object({
          override: CourseMonthlyPriceOverrideSchema,
          updatedBills: z.number(),
        }),
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    getPriceOverride: {
      method: 'GET' as const,
      path: '/api/monthly-subscriptions/price-override',
      query: z.object({
        courseId: z.string(),
        billingYear: z.string(),
        billingMonth: z.string(),
      }),
      responses: {
        200: CourseMonthlyPriceOverrideSchema.nullable(),
        403: ApiErrorSchema,
      },
    },
    deletePriceOverride: {
      method: 'DELETE' as const,
      path: '/api/monthly-subscriptions/price-override/:id',
      pathParams: z.object({ id: UUIDSchema }),
      responses: {
        200: z.object({ deleted: z.boolean(), updatedBills: z.number() }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    listPriceOverrides: {
      method: 'GET' as const,
      path: '/api/monthly-subscriptions/price-overrides/:courseId',
      pathParams: z.object({ courseId: UUIDSchema }),
      responses: {
        200: z.array(CourseMonthlyPriceOverrideSchema),
        403: ApiErrorSchema,
      },
    },
  },

  // ============================================================
  // Session Payments (PER_SESSION courses)
  // ============================================================
  sessionPayments: {
    list: {
      method: 'GET' as const,
      path: '/api/session-payments',
      // Inclusive date range (from..to, ISO yyyy-mm-dd) over the session date.
      query: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        branchId: z.string().optional(),
        courseId: z.string().optional(),
        sessionId: z.string().optional(),
        studentId: z.string().optional(),
        status: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(SessionPaymentWithDetailsSchema),
        403: ApiErrorSchema,
      },
    },
    summary: {
      method: 'GET' as const,
      path: '/api/session-payments/summary',
      query: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        branchId: z.string().optional(),
        courseId: z.string().optional(),
      }).optional(),
      responses: {
        200: SessionPaymentSummarySchema,
        403: ApiErrorSchema,
      },
    },
    overdue: {
      method: 'GET' as const,
      path: '/api/session-payments/overdue',
      query: z.object({ branchId: z.string().optional() }).optional(),
      responses: {
        200: z.array(SessionPaymentWithDetailsSchema),
        403: ApiErrorSchema,
      },
    },
    recordPayment: {
      method: 'POST' as const,
      path: '/api/session-payments/:id/pay',
      pathParams: z.object({ id: UUIDSchema }),
      body: RecordSessionPaymentSchema,
      responses: {
        200: SessionPaymentSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    voidPayment: {
      method: 'POST' as const,
      path: '/api/session-payments/:id/void',
      pathParams: z.object({ id: UUIDSchema }),
      body: z.object({ reason: z.string().optional() }),
      responses: {
        200: SessionPaymentSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    refund: {
      method: 'POST' as const,
      path: '/api/session-payments/:id/refund',
      pathParams: z.object({ id: UUIDSchema }),
      body: RefundSessionPaymentSchema,
      responses: {
        200: SessionPaymentSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    buyPackage: {
      method: 'POST' as const,
      path: '/api/session-payments/packages',
      body: BuySessionPackageSchema,
      responses: {
        201: SessionPackageSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    payPackage: {
      method: 'POST' as const,
      path: '/api/session-payments/packages/:id/pay',
      pathParams: z.object({ id: UUIDSchema }),
      body: RecordSessionPaymentSchema,
      responses: {
        200: SessionPackageSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    refundPackage: {
      method: 'POST' as const,
      path: '/api/session-payments/packages/:id/refund',
      pathParams: z.object({ id: UUIDSchema }),
      body: RefundSessionPaymentSchema,
      responses: {
        200: SessionPackageSchema,
        400: ApiErrorSchema,
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    renewalsDue: {
      method: 'GET' as const,
      path: '/api/session-payments/renewals-due',
      query: z.object({
        branchId: z.string().optional(),
        courseId: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.any()),
        403: ApiErrorSchema,
      },
    },
    listPackages: {
      method: 'GET' as const,
      path: '/api/session-payments/packages',
      query: z.object({
        branchId: z.string().optional(),
        courseId: z.string().optional(),
        studentId: z.string().optional(),
        status: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(SessionPackageWithDetailsSchema),
        403: ApiErrorSchema,
      },
    },
    listByCourse: {
      method: 'GET' as const,
      path: '/api/session-payments/course/:courseId',
      pathParams: z.object({ courseId: UUIDSchema }),
      responses: {
        200: z.array(SessionPaymentWithDetailsSchema),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    listByStudent: {
      method: 'GET' as const,
      path: '/api/session-payments/student/:studentId',
      pathParams: z.object({ studentId: UUIDSchema }),
      responses: {
        200: z.array(SessionPaymentWithDetailsSchema),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
    // Resolve a scanned student barcode (QR token) to that student and their
    // still-due session charges, so staff can collect a payment by scanning.
    byToken: {
      method: 'GET' as const,
      path: '/api/session-payments/by-token/:qrToken',
      pathParams: z.object({ qrToken: z.string().min(1).max(64) }),
      responses: {
        200: z.object({
          studentId: z.string(),
          studentFirstName: z.string(),
          studentLastName: z.string(),
          dueSessions: z.array(SessionPaymentWithDetailsSchema),
        }),
        403: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  },

  // ============================================================
  // Timetable
  // ============================================================
  // WHATSAPP TEMPLATES (click-to-chat)
  // ============================================================
  whatsappTemplates: {
    getTemplates: {
      method: 'GET' as const,
      path: '/api/whatsapp/templates',
      responses: {
        200: z.object({ templates: z.record(z.string()) }),
        401: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
    updateTemplates: {
      method: 'PUT' as const,
      path: '/api/whatsapp/templates',
      body: z.object({ templates: z.record(z.string()) }),
      responses: {
        200: z.object({ templates: z.record(z.string()) }),
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  },

  // ============================================================
  // Telegram attendance bot + auto-notifications. The webhook is PUBLIC
  // (no authorization header) — see routes/telegram.ts.
  telegram: {
    getSettings: {
      method: 'GET' as const,
      path: '/api/telegram/settings',
      responses: {
        200: TelegramSettingsSchema.extend({ templates: z.record(z.string()) }),
        401: ApiErrorSchema,
        403: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
    updateSettings: {
      method: 'PATCH' as const,
      path: '/api/telegram/settings',
      body: z.object({
        enabled: z.boolean().optional(),
        notifyOnPresent: z.boolean().optional(),
        notifyOnAbsent: z.boolean().optional(),
        notifyTarget: z.enum(['STUDENT', 'PARENT', 'BOTH']).optional(),
      }),
      responses: { 200: TelegramSettingsSchema, 401: ApiErrorSchema, 403: ApiErrorSchema, 500: ApiErrorSchema },
    },
    updateTemplates: {
      method: 'PUT' as const,
      path: '/api/telegram/templates',
      body: z.object({ templates: z.record(z.string()) }),
      responses: {
        200: z.object({ templates: z.record(z.string()) }),
        400: ApiErrorSchema, 401: ApiErrorSchema, 403: ApiErrorSchema, 500: ApiErrorSchema,
      },
    },
    setBot: {
      method: 'POST' as const,
      path: '/api/telegram/bot',
      body: z.object({ botToken: z.string() }),
      responses: { 200: TelegramSettingsSchema, 400: ApiErrorSchema, 401: ApiErrorSchema, 403: ApiErrorSchema, 500: ApiErrorSchema },
    },
    enableWithPooledBot: {
      method: 'POST' as const,
      path: '/api/telegram/enable',
      body: z.object({}).optional(),
      responses: { 200: TelegramSettingsSchema, 400: ApiErrorSchema, 401: ApiErrorSchema, 403: ApiErrorSchema, 409: ApiErrorSchema, 500: ApiErrorSchema },
    },
    disconnectBot: {
      method: 'POST' as const,
      path: '/api/telegram/disconnect',
      body: z.object({}).optional(),
      responses: { 200: TelegramSettingsSchema, 401: ApiErrorSchema, 403: ApiErrorSchema, 500: ApiErrorSchema },
    },
    getStudentLink: {
      method: 'GET' as const,
      path: '/api/telegram/link/student/:studentId',
      pathParams: z.object({ studentId: UUIDSchema }),
      responses: {
        200: z.object({
          botConfigured: z.boolean(),
          studentUrl: z.string().nullable(),
          parentUrl: z.string().nullable(),
          studentLinked: z.boolean(),
          parentLinked: z.boolean(),
        }),
        401: ApiErrorSchema, 403: ApiErrorSchema, 404: ApiErrorSchema, 500: ApiErrorSchema,
      },
    },
    getStaffLink: {
      method: 'GET' as const,
      path: '/api/telegram/link/staff/:employeeId',
      pathParams: z.object({ employeeId: UUIDSchema }),
      responses: {
        200: z.object({ botConfigured: z.boolean(), url: z.string().nullable(), linked: z.boolean() }),
        401: ApiErrorSchema, 403: ApiErrorSchema, 404: ApiErrorSchema, 500: ApiErrorSchema,
      },
    },
    webhook: {
      method: 'POST' as const,
      path: '/api/telegram/webhook/:companyKey',
      pathParams: z.object({ companyKey: z.string() }),
      body: z.any(),
      responses: { 200: z.object({ ok: z.boolean() }) },
    },
  },

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
        roomId: z.string().optional(),
      }),
      responses: {
        200: z.object({
          date: z.string(),
          dayOfWeek: z.string(),
          entries: z.array(z.any()),
        }),
        400: ApiErrorSchema,
        401: ApiErrorSchema,
        402: ApiErrorSchema,
        403: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  },
});

export type Contract = typeof contract;
