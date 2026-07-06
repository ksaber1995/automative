# Monthly Subscription Courses — Implementation Plan

## Overview

Currently, all courses use a **one-time payment** model (full or installments). This plan introduces a new **monthly subscription** payment type for courses. Students enrolled in a monthly course pay a fixed fee every calendar month. The system must:

1. Allow a course to be flagged as `MONTHLY_SUBSCRIPTION`.
2. Track each student's monthly payment status per month.
3. Provide a dedicated **Monthly Payments Dashboard** page where staff can see, for any given month, who has paid and who hasn't — and collect overdue payments inline.
4. Automatically carry forward unpaid months so no payment is ever silently lost.

---

## Decision: Same UI Shell, New Payment Behaviour

The course **list**, **form**, and **detail** pages are reused. The only additions are:

- A new `paymentType` field on the course form (`ONE_TIME` | `MONTHLY_SUBSCRIPTION`).
- A new tab/section inside the course detail page for monthly payment tracking.
- A brand-new standalone page: **Monthly Payments Dashboard** (`/monthly-payments`).

This keeps the UX consistent and avoids duplicating the entire course management UI.

---

## Architecture Diagram

```
courses table
  └── payment_type: 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION'  ← NEW column
  └── monthly_fee: DECIMAL(10,2)                          ← NEW column

enrollments table (unchanged — still used for monthly courses)
  └── payment_type mirrors course (denormalised for fast queries) ← NEW column

monthly_subscription_payments table  ← NEW table
  ├── id
  ├── enrollment_id  → enrollments.id
  ├── company_id
  ├── student_id
  ├── course_id
  ├── branch_id
  ├── billing_year    (e.g. 2026)
  ├── billing_month   (1–12)
  ├── amount_due
  ├── amount_paid
  ├── payment_status  ('PENDING' | 'PAID' | 'PARTIAL' | 'OVERDUE')
  ├── due_date        (first day of billing month)
  ├── paid_date
  ├── notes
  ├── created_at
  └── updated_at
```

---

## Files to Create / Modify

### 1. Database Schema Changes

| File | Action |
|------|--------|
| `aws/sql/schema.sql` | **MODIFY** — already updated with all new columns and table |

The following changes have been applied directly to `aws/sql/schema.sql`:

**`courses` table** — two new columns added inline:
```sql
-- Payment model: ONE_TIME (default, existing behaviour) or MONTHLY_SUBSCRIPTION
payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME'
    CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION')),
-- Recurring fee charged each calendar month (used when payment_type = MONTHLY_SUBSCRIPTION)
monthly_fee DECIMAL(10, 2),
```

**`enrollments` table** — one new column added inline:
```sql
-- Denormalised from courses.payment_type for fast monthly-subscription queries
payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME'
    CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION')),
```

**New `monthly_subscription_payments` table** — appended at the end of `schema.sql` (after the analytics views):
```sql
CREATE TABLE monthly_subscription_payments (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id    UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_id        UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    branch_id        UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    billing_year     INTEGER NOT NULL,
    billing_month    INTEGER NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
    amount_due       DECIMAL(10, 2) NOT NULL DEFAULT 0,
    amount_paid      DECIMAL(10, 2) NOT NULL DEFAULT 0,
    payment_status   VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                         CHECK (payment_status IN ('PENDING', 'PAID', 'PARTIAL', 'OVERDUE')),
    due_date         DATE NOT NULL,
    paid_date        DATE,
    notes            TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (enrollment_id, billing_year, billing_month)
);
-- + 8 indexes + updated_at trigger (see schema.sql)
```

> **For live databases:** run the equivalent `ALTER TABLE` statements as migration `027`:
> ```sql
> ALTER TABLE courses
>   ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME'
>     CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION')),
>   ADD COLUMN IF NOT EXISTS monthly_fee DECIMAL(10,2);
>
> ALTER TABLE enrollments
>   ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME'
>     CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION'));
>
> CREATE TABLE IF NOT EXISTS monthly_subscription_payments ( ... ); -- see schema.sql
> ```

---

### 2. Shared Interfaces

| File | Action |
|------|--------|
| `shared/interfaces/course.interface.ts` | **MODIFY** — add `paymentType`, `monthlyFee` to `Course`, `CourseCreateDto`, `CourseUpdateDto` |
| `shared/interfaces/monthly-subscription.interface.ts` | **CREATE** |

**Changes to `course.interface.ts`:**
```typescript
export interface Course {
  // ... existing fields ...
  paymentType: 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION';  // NEW
  monthlyFee: number | null;                           // NEW
}

export interface CourseCreateDto {
  // ... existing fields ...
  paymentType?: 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION';  // NEW
  monthlyFee?: number;                                  // NEW
}

export interface CourseUpdateDto {
  // ... existing fields ...
  paymentType?: 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION';  // NEW
  monthlyFee?: number | null;                           // NEW
}
```

**New `monthly-subscription.interface.ts`:**
```typescript
export type MonthlyPaymentStatus = 'PENDING' | 'PAID' | 'PARTIAL' | 'OVERDUE';

export interface MonthlySubscriptionPayment {
  id: string;
  enrollmentId: string;
  companyId: string;
  studentId: string;
  courseId: string;
  branchId: string;
  billingYear: number;
  billingMonth: number;
  amountDue: number;
  amountPaid: number;
  paymentStatus: MonthlyPaymentStatus;
  dueDate: string;
  paidDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyPaymentWithDetails extends MonthlySubscriptionPayment {
  studentFirstName: string;
  studentLastName: string;
  courseName: string;
  branchName: string;
  className?: string;
}

export interface MonthlyPaymentSummary {
  billingYear: number;
  billingMonth: number;
  totalStudents: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  partialCount: number;
  totalRevenue: number;
  totalExpected: number;
}

export interface RecordMonthlyPaymentDto {
  amount: number;
  paymentDate: string;
  notes?: string;
}

export interface GenerateMonthlyBillsDto {
  courseId?: string;
  branchId?: string;
  billingYear: number;
  billingMonth: number;
}
```

---

### 3. Shared Enums

| File | Action |
|------|--------|
| `shared/enums/enrollment-status.enum.ts` | **MODIFY** — add `MONTHLY_SUBSCRIPTION` to `PaymentMode` enum |

**Change:**
```typescript
export enum PaymentMode {
  FULL = 'FULL',
  INSTALLMENTS = 'INSTALLMENTS',
  MONTHLY_SUBSCRIPTION = 'MONTHLY_SUBSCRIPTION',  // NEW
}
```

---

### 4. Backend — Contract (`contract.ts`)

| File | Action |
|------|--------|
| `aws/lambda/api/src/contract.ts` | **MODIFY** — add new schemas and route definitions |

**Changes needed:**

1. **Extend `CreateCourseSchema` and `UpdateCourseSchema`** to include `paymentType` and `monthlyFee`:
```typescript
const CoursePaymentTypeSchema = z.enum(['ONE_TIME', 'MONTHLY_SUBSCRIPTION']);

const CreateCourseSchema = z.object({
  // ... existing fields ...
  paymentType: CoursePaymentTypeSchema.optional().default('ONE_TIME'),
  monthlyFee: z.number().optional(),
});
```

2. **Extend `CourseSchema`** response to include new fields:
```typescript
const CourseSchema = z.object({
  // ... existing fields ...
  paymentType: CoursePaymentTypeSchema.default('ONE_TIME'),
  monthlyFee: z.number().nullable(),
});
```

3. **Add new Zod schemas** for monthly subscriptions:
```typescript
const MonthlyPaymentStatusSchema = z.enum(['PENDING', 'PAID', 'PARTIAL', 'OVERDUE']);

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
  createdAt: z.string(),
  updatedAt: z.string(),
});

const MonthlyPaymentWithDetailsSchema = MonthlySubscriptionPaymentSchema.extend({
  studentFirstName: z.string(),
  studentLastName: z.string(),
  courseName: z.string(),
  branchName: z.string(),
  className: z.string().nullable().optional(),
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
```

4. **Add `monthlySubscriptions` contract section:**
```typescript
monthlySubscriptions: {
  list: {
    method: 'GET',
    path: '/monthly-subscriptions',
    query: z.object({
      year: z.coerce.number().int(),
      month: z.coerce.number().int().min(1).max(12),
      courseId: z.string().optional(),
      branchId: z.string().optional(),
      status: MonthlyPaymentStatusSchema.optional(),
    }),
    responses: { 200: z.array(MonthlyPaymentWithDetailsSchema), 403: ApiErrorSchema },
  },
  summary: {
    method: 'GET',
    path: '/monthly-subscriptions/summary',
    query: z.object({
      year: z.coerce.number().int(),
      month: z.coerce.number().int().min(1).max(12),
      branchId: z.string().optional(),
    }),
    responses: { 200: MonthlyPaymentSummarySchema, 403: ApiErrorSchema },
  },
  generate: {
    method: 'POST',
    path: '/monthly-subscriptions/generate',
    body: GenerateMonthlyBillsSchema,
    responses: { 200: z.object({ created: z.number(), message: z.string() }), 403: ApiErrorSchema },
  },
  pay: {
    method: 'POST',
    path: '/monthly-subscriptions/:id/pay',
    pathParams: z.object({ id: UUIDSchema }),
    body: RecordMonthlyPaymentSchema,
    responses: { 200: MonthlySubscriptionPaymentSchema, 403: ApiErrorSchema, 404: ApiErrorSchema },
  },
  overdue: {
    method: 'GET',
    path: '/monthly-subscriptions/overdue',
    query: z.object({ branchId: z.string().optional() }),
    responses: { 200: z.array(MonthlyPaymentWithDetailsSchema), 403: ApiErrorSchema },
  },
}
```

---

### 5. Backend Routes

| File | Action |
|------|--------|
| `aws/lambda/api/src/routes/courses.ts` | **MODIFY** — handle `payment_type` & `monthly_fee` in `mapCourseFromDB`, `create`, `update` |
| `aws/lambda/api/src/routes/enrollments.ts` | **MODIFY** — copy `payment_type` from course on enrollment creation |
| `aws/lambda/api/src/routes/monthly-subscriptions.ts` | **CREATE** — all 5 endpoints |

#### 5a. `courses.ts` changes

**`mapCourseFromDB`** — add two new fields:
```typescript
function mapCourseFromDB(row: any) {
  return {
    // ... existing fields ...
    paymentType: row.payment_type || 'ONE_TIME',   // NEW
    monthlyFee: row.monthly_fee ? parseFloat(row.monthly_fee) : null,  // NEW
  };
}
```

**`create`** — pass new fields to `insert`:
```typescript
const course = await insert('courses', {
  // ... existing fields ...
  payment_type: body.paymentType || 'ONE_TIME',   // NEW
  monthly_fee: body.monthlyFee || null,            // NEW
});
```

**`update`** — handle new fields in `updateData`:
```typescript
if (body.paymentType !== undefined) updateData.payment_type = body.paymentType;
if (body.monthlyFee !== undefined) updateData.monthly_fee = body.monthlyFee || null;
```

#### 5b. `enrollments.ts` changes

In the `create` handler, after fetching the course, copy `payment_type`:
```typescript
// Fetch course to get payment_type
const course = await queryOne(
  'SELECT payment_type FROM courses WHERE id = $1',
  [body.courseId]
);

const enrollment = await insert('enrollments', {
  // ... existing fields ...
  payment_type: course?.payment_type || 'ONE_TIME',  // NEW
});
```

Also update `mapEnrollmentFromDB` to include:
```typescript
paymentType: row.payment_type || 'ONE_TIME',  // NEW
```

#### 5c. New `monthly-subscriptions.ts`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/monthly-subscriptions` | List payments filtered by `year`, `month`, `courseId`, `branchId`, `status` |
| `GET` | `/monthly-subscriptions/summary` | Aggregated counts & revenue for a given month |
| `POST` | `/monthly-subscriptions/generate` | Generate bill rows for all active monthly-course enrollments |
| `POST` | `/monthly-subscriptions/:id/pay` | Record a payment against a specific bill row |
| `GET` | `/monthly-subscriptions/overdue` | List all overdue rows across all months |

**Key logic in `generate`:**
```typescript
// For each active enrollment where payment_type = 'MONTHLY_SUBSCRIPTION':
// INSERT INTO monthly_subscription_payments (...) ON CONFLICT DO NOTHING
// amount_due = course.monthly_fee
// due_date = first day of billing month
// payment_status = 'PENDING' (or 'OVERDUE' if due_date < TODAY)
```

**Key logic in `pay`:**
```typescript
// 1. Update amount_paid on the row
// 2. Recalculate payment_status:
//    - amount_paid >= amount_due  → 'PAID', set paid_date = today
//    - amount_paid > 0            → 'PARTIAL'
//    - amount_paid = 0            → 'PENDING' / 'OVERDUE'
// 3. Insert a row into revenues table (same as existing enrollment payment flow)
```

**Full route structure:**
```typescript
export const monthlySubscriptionsRoutes = {
  list:     async ({ query, headers }) => { ... },
  summary:  async ({ query, headers }) => { ... },
  generate: async ({ body, headers }) => { ... },
  pay:      async ({ params, body, headers }) => { ... },
  overdue:  async ({ query, headers }) => { ... },
};
```

---

### 6. Backend Router Registration

| File | Action |
|------|--------|
| `aws/lambda/api/src/index.ts` | **MODIFY** — import and register `monthlySubscriptionsRoutes` |

**Add import:**
```typescript
import { monthlySubscriptionsRoutes } from './routes/monthly-subscriptions';
```

**Add to router object:**
```typescript
monthlySubscriptions: {
  list:     monthlySubscriptionsRoutes.list,
  summary:  monthlySubscriptionsRoutes.summary,
  generate: monthlySubscriptionsRoutes.generate,
  pay:      monthlySubscriptionsRoutes.pay,
  overdue:  monthlySubscriptionsRoutes.overdue,
},
```

---

### 7. Frontend — Service

| File | Action |
|------|--------|
| `frontend/src/app/features/monthly-subscriptions/services/monthly-subscription.service.ts` | **CREATE** |

```typescript
@Injectable({ providedIn: 'root' })
export class MonthlySubscriptionService {
  private http = inject(HttpClient);

  getPayments(filters: {
    year: number; month: number;
    courseId?: string; branchId?: string; status?: string;
  }): Observable<MonthlyPaymentWithDetails[]>

  getSummary(year: number, month: number, branchId?: string): Observable<MonthlyPaymentSummary>

  generateBills(dto: GenerateMonthlyBillsDto): Observable<{ created: number; message: string }>

  recordPayment(id: string, dto: RecordMonthlyPaymentDto): Observable<MonthlySubscriptionPayment>

  getOverdue(branchId?: string): Observable<MonthlyPaymentWithDetails[]>
}
```

The service uses the same `ts-rest` Angular client pattern as existing services (e.g. `DuesService`, `EnrollmentService`).

---

### 8. Frontend — Feature Module Files

```
frontend/src/app/features/monthly-subscriptions/
├── monthly-subscriptions.routes.ts                        ← CREATE
├── services/
│   └── monthly-subscription.service.ts                    ← CREATE (see above)
└── monthly-payments-dashboard/
    ├── monthly-payments-dashboard.component.ts            ← CREATE
    └── monthly-payments-dashboard.component.html          ← CREATE
```

**`monthly-subscriptions.routes.ts`:**
```typescript
import { Routes } from '@angular/router';

export const MONTHLY_SUBSCRIPTIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./monthly-payments-dashboard/monthly-payments-dashboard.component')
        .then(m => m.MonthlyPaymentsDashboardComponent),
  },
];
```

---

### 9. Frontend — Monthly Payments Dashboard Page

**Route:** `/monthly-payments`

**UI Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Monthly Payments Dashboard                    [Generate Bills]  │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ Month    │  │ Branch   │  │ Course   │  │ Status Filter│   │
│  │ Picker   │  │ Dropdown │  │ Dropdown │  │ (tabs/select)│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
│                                                                  │
│  ┌─── Summary Cards ──────────────────────────────────────────┐ │
│  │  ✅ Paid: 24   ⏳ Pending: 8   ⚠️ Overdue: 3   💰 Revenue │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─── Payments Table ─────────────────────────────────────────┐ │
│  │ Student | Course | Class | Due | Amount | Status | Actions │ │
│  │ ─────────────────────────────────────────────────────────  │ │
│  │ Ahmed M │ Robotics│ A1   │ 1 Jun│ 500 EGP│ PAID   │  👁    │ │
│  │ Sara K  │ Robotics│ A1   │ 1 Jun│ 500 EGP│ OVERDUE│ 💳 Pay │ │
│  │ Omar T  │ AI Intro│ B2   │ 1 Jun│ 400 EGP│ PENDING│ 💳 Pay │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- **Month/Year picker** — defaults to current month (`p-datepicker view="month"`).
- **Summary cards** — Paid / Pending / Overdue / Partial counts + total revenue vs expected.
- **Status tabs** — All | Paid | Pending | Overdue | Partial.
- **Branch & Course filters** — same dropdown pattern as existing course list.
- **"Generate Bills" button** — calls `POST /monthly-subscriptions/generate`. Shows count of newly created rows. Idempotent (safe to run multiple times).
- **Pay button** — opens inline dialog (same style as existing `openPaymentDialog` in course-detail) to record a payment.
- **Color-coded status badges** — green=PAID, yellow=PENDING, red=OVERDUE, blue=PARTIAL.
- **Overdue row highlight** — rows where `due_date < today` and status ≠ PAID are highlighted in red (`[class.bg-red-50]`).

---

### 10. Frontend — Monthly Payments Dashboard Component Spec

#### `monthly-payments-dashboard.component.ts`

**Signals / State:**
```typescript
selectedYear    = signal(new Date().getFullYear())
selectedMonth   = signal(new Date().getMonth() + 1)
selectedDate    = signal(new Date())          // bound to p-datepicker
selectedBranchId = signal<string | null>(null)
selectedCourseId = signal<string | null>(null)
selectedTab     = signal<'ALL' | 'PAID' | 'PENDING' | 'OVERDUE' | 'PARTIAL'>('ALL')
payments        = signal<MonthlyPaymentWithDetails[]>([])
summary         = signal<MonthlyPaymentSummary | null>(null)
branches        = signal<Branch[]>([])
courses         = signal<Course[]>([])        // only MONTHLY_SUBSCRIPTION courses
loading         = signal(false)
generating      = signal(false)
showPayDialog   = signal(false)
selectedPayment = signal<MonthlyPaymentWithDetails | null>(null)
payAmount       = signal<number | null>(null)
payDate         = signal<Date>(new Date())
payNotes        = signal('')
submittingPay   = signal(false)
```

**Computed:**
```typescript
filteredPayments = computed(() =>
  payments().filter(p => selectedTab() === 'ALL' || p.paymentStatus === selectedTab())
)
monthLabel = computed(() => {
  const d = new Date(selectedYear(), selectedMonth() - 1, 1);
  return d.toLocaleDateString('en', { month: 'long', year: 'numeric' });
})
```

**Methods:**
```typescript
loadData()          // calls getPayments() + getSummary() in parallel (forkJoin)
onMonthChange(date) // extracts year/month from p-datepicker, then calls loadData()
generateBills()     // calls generateBills({ billingYear, billingMonth, branchId?, courseId? })
openPayDialog(payment: MonthlyPaymentWithDetails)
submitPayment()     // calls recordPayment(id, { amount, paymentDate, notes })
closePayDialog()
getStatusSeverity(status: MonthlyPaymentStatus): string
  // 'PAID' → 'success', 'PENDING' → 'warn', 'OVERDUE' → 'danger', 'PARTIAL' → 'info'
```

#### `monthly-payments-dashboard.component.html`

```html
<div class="container-custom py-8">
  <!-- Header -->
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold">{{ 'MONTHLY_PAYMENTS.TITLE' | translate }}</h1>
    <p-button
      [label]="'MONTHLY_PAYMENTS.GENERATE_BILLS' | translate"
      icon="pi pi-refresh"
      (onClick)="generateBills()"
      [loading]="generating()"
    ></p-button>
  </div>

  <p-card>
    <!-- Filters Row -->
    <div class="flex flex-wrap gap-3 mb-4">
      <p-datepicker
        [(ngModel)]="selectedDate"
        view="month"
        dateFormat="mm/yy"
        (onSelect)="onMonthChange($event)"
      ></p-datepicker>

      <p-select
        [options]="branches()"
        [(ngModel)]="selectedBranchId"
        optionLabel="name"
        optionValue="id"
        [placeholder]="'MONTHLY_PAYMENTS.FILTER_BRANCH' | translate"
        [showClear]="true"
        (onChange)="loadData()"
      ></p-select>

      <p-select
        [options]="courses()"
        [(ngModel)]="selectedCourseId"
        optionLabel="name"
        optionValue="id"
        [placeholder]="'MONTHLY_PAYMENTS.FILTER_COURSE' | translate"
        [showClear]="true"
        (onChange)="loadData()"
      ></p-select>
    </div>

    <!-- Summary Cards -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      <div class="summary-card bg-green-50 border border-green-200 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-green-600">{{ summary()?.paidCount ?? 0 }}</div>
        <div class="text-sm text-green-700">{{ 'MONTHLY_PAYMENTS.SUMMARY_PAID' | translate }}</div>
      </div>
      <div class="summary-card bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-yellow-600">{{ summary()?.pendingCount ?? 0 }}</div>
        <div class="text-sm text-yellow-700">{{ 'MONTHLY_PAYMENTS.SUMMARY_PENDING' | translate }}</div>
      </div>
      <div class="summary-card bg-red-50 border border-red-200 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-red-600">{{ summary()?.overdueCount ?? 0 }}</div>
        <div class="text-sm text-red-700">{{ 'MONTHLY_PAYMENTS.SUMMARY_OVERDUE' | translate }}</div>
      </div>
      <div class="summary-card bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-blue-600">{{ summary()?.partialCount ?? 0 }}</div>
        <div class="text-sm text-blue-700">{{ 'MONTHLY_PAYMENTS.SUMMARY_PARTIAL' | translate }}</div>
      </div>
      <div class="summary-card bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
        <div class="text-2xl font-bold text-purple-600">{{ summary()?.totalRevenue ?? 0 | number }}</div>
        <div class="text-sm text-purple-700">{{ 'MONTHLY_PAYMENTS.SUMMARY_REVENUE' | translate }}</div>
      </div>
    </div>

    <!-- Status Tabs -->
    <p-tabs [value]="selectedTab()" (valueChange)="selectedTab.set($event)">
      <p-tablist>
        <p-tab value="ALL">{{ 'MONTHLY_PAYMENTS.TAB_ALL' | translate }} ({{ payments().length }})</p-tab>
        <p-tab value="PAID">{{ 'MONTHLY_PAYMENTS.TAB_PAID' | translate }} ({{ summary()?.paidCount ?? 0 }})</p-tab>
        <p-tab value="PENDING">{{ 'MONTHLY_PAYMENTS.TAB_PENDING' | translate }} ({{ summary()?.pendingCount ?? 0 }})</p-tab>
        <p-tab value="OVERDUE">{{ 'MONTHLY_PAYMENTS.TAB_OVERDUE' | translate }} ({{ summary()?.overdueCount ?? 0 }})</p-tab>
        <p-tab value="PARTIAL">{{ 'MONTHLY_PAYMENTS.TAB_PARTIAL' | translate }} ({{ summary()?.partialCount ?? 0 }})</p-tab>
      </p-tablist>
    </p-tabs>

    <!-- Payments Table -->
    <p-table
      [value]="filteredPayments()"
      [loading]="loading()"
      [paginator]="true"
      [rows]="20"
      [rowsPerPageOptions]="[10, 20, 50]"
      styleClass="mt-4"
    >
      <ng-template pTemplate="header">
        <tr>
          <th>{{ 'MONTHLY_PAYMENTS.COL_STUDENT' | translate }}</th>
          <th>{{ 'MONTHLY_PAYMENTS.COL_COURSE' | translate }}</th>
          <th>{{ 'MONTHLY_PAYMENTS.COL_CLASS' | translate }}</th>
          <th>{{ 'MONTHLY_PAYMENTS.COL_DUE_DATE' | translate }}</th>
          <th>{{ 'MONTHLY_PAYMENTS.COL_AMOUNT' | translate }}</th>
          <th>{{ 'MONTHLY_PAYMENTS.COL_STATUS' | translate }}</th>
          <th>{{ 'MONTHLY_PAYMENTS.COL_ACTIONS' | translate }}</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-row>
        <tr [class.bg-red-50]="row.paymentStatus === 'OVERDUE'">
          <td>{{ row.studentFirstName }} {{ row.studentLastName }}</td>
          <td>{{ row.courseName }}</td>
          <td>{{ row.className || '—' }}</td>
          <td>{{ row.dueDate | date:'mediumDate' }}</td>
          <td>
            {{ row.amountPaid | number }} / {{ row.amountDue | number }}
          </td>
          <td>
            <p-tag
              [value]="'MONTHLY_PAYMENTS.STATUS_' + row.paymentStatus | translate"
              [severity]="getStatusSeverity(row.paymentStatus)"
            ></p-tag>
          </td>
          <td>
            @if (row.paymentStatus !== 'PAID') {
              <p-button
                icon="pi pi-wallet"
                severity="success"
                size="small"
                [pTooltip]="'MONTHLY_PAYMENTS.PAY_BTN' | translate"
                (onClick)="openPayDialog(row)"
              ></p-button>
            }
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="7" class="text-center py-8 text-gray-500">
            {{ 'MONTHLY_PAYMENTS.NO_RECORDS' | translate }}
          </td>
        </tr>
      </ng-template>
    </p-table>
  </p-card>
</div>

<!-- Pay Dialog -->
<p-dialog
  [(visible)]="showPayDialog"
  [header]="'MONTHLY_PAYMENTS.PAY_DIALOG_TITLE' | translate: { name: selectedPayment()?.studentFirstName + ' ' + selectedPayment()?.studentLastName }"
  [modal]="true"
  [style]="{ width: '420px' }"
  [draggable]="false"
>
  <div class="flex flex-col gap-4 pt-2">
    <div class="flex flex-col gap-1">
      <label class="font-medium">{{ 'MONTHLY_PAYMENTS.PAY_AMOUNT' | translate }}</label>
      <p-inputnumber
        [(ngModel)]="payAmount"
        [min]="0"
        [max]="selectedPayment()?.amountDue"
        mode="decimal"
        [minFractionDigits]="0"
        [maxFractionDigits]="2"
      ></p-inputnumber>
    </div>
    <div class="flex flex-col gap-1">
      <label class="font-medium">{{ 'MONTHLY_PAYMENTS.PAY_DATE' | translate }}</label>
      <p-datepicker [(ngModel)]="payDate" dateFormat="yy-mm-dd"></p-datepicker>
    </div>
    <div class="flex flex-col gap-1">
      <label class="font-medium">{{ 'MONTHLY_PAYMENTS.PAY_NOTES' | translate }}</label>
      <textarea pTextarea [(ngModel)]="payNotes" rows="2"></textarea>
    </div>
  </div>
  <ng-template pTemplate="footer">
    <p-button
      [label]="'MONTHLY_PAYMENTS.PAY_CANCEL' | translate"
      severity="secondary"
      (onClick)="closePayDialog()"
    ></p-button>
    <p-button
      [label]="'MONTHLY_PAYMENTS.PAY_SUBMIT' | translate"
      icon="pi pi-check"
      (onClick)="submitPayment()"
      [loading]="submittingPay()"
    ></p-button>
  </ng-template>
</p-dialog>
```

---

### 11. Frontend — Course Form Changes

| File | Action |
|------|--------|
| `frontend/src/app/features/courses/course-form/course-form.component.ts` | **MODIFY** |
| `frontend/src/app/features/courses/course-form/course-form.component.html` | **MODIFY** |

**`course-form.component.ts` changes:**

1. Add `SelectButtonModule` to imports array.
2. Add `paymentType` and `monthlyFee` to the `FormGroup`:
```typescript
this.courseForm = this.fb.group({
  // ... existing controls ...
  paymentType: ['ONE_TIME'],
  monthlyFee: [null],
});
```
3. Add conditional validator — when `paymentType` changes to `MONTHLY_SUBSCRIPTION`, make `monthlyFee` required:
```typescript
this.courseForm.get('paymentType')?.valueChanges.subscribe(type => {
  const monthlyFeeCtrl = this.courseForm.get('monthlyFee');
  if (type === 'MONTHLY_SUBSCRIPTION') {
    monthlyFeeCtrl?.setValidators([Validators.required, Validators.min(0)]);
  } else {
    monthlyFeeCtrl?.clearValidators();
    monthlyFeeCtrl?.setValue(null);
  }
  monthlyFeeCtrl?.updateValueAndValidity();
});
```
4. In `loadCourse`, patch `paymentType` and `monthlyFee` from the loaded course.
5. Add getter: `get paymentType() { return this.courseForm.get('paymentType'); }`

**`course-form.component.html` changes** — add after the `price` field:

```html
<!-- Payment Type -->
<div class="field">
  <label>{{ 'COURSES.FORM.PAYMENT_TYPE_LABEL' | translate }}</label>
  <p-selectbutton
    formControlName="paymentType"
    [options]="[
      { label: ('COURSES.FORM.PAYMENT_TYPE_ONE_TIME' | translate), value: 'ONE_TIME' },
      { label: ('COURSES.FORM.PAYMENT_TYPE_MONTHLY' | translate), value: 'MONTHLY_SUBSCRIPTION' }
    ]"
    optionLabel="label"
    optionValue="value"
  ></p-selectbutton>
</div>

<!-- Monthly Fee (shown only when paymentType = MONTHLY_SUBSCRIPTION) -->
@if (paymentType?.value === 'MONTHLY_SUBSCRIPTION') {
  <div class="field">
    <label>{{ 'COURSES.FORM.MONTHLY_FEE_LABEL' | translate }}</label>
    <p-inputnumber
      formControlName="monthlyFee"
      [placeholder]="'COURSES.FORM.MONTHLY_FEE_PLACEHOLDER' | translate"
      [min]="0"
      mode="decimal"
    ></p-inputnumber>
    @if (courseForm.get('monthlyFee')?.invalid && courseForm.get('monthlyFee')?.touched) {
      <small class="p-error">{{ 'COURSES.FORM.MONTHLY_FEE_REQUIRED' | translate }}</small>
    }
  </div>
}
```

---

### 12. Frontend — Course List Changes

| File | Action |
|------|--------|
| `frontend/src/app/features/courses/course-list/course-list.component.ts` | **MODIFY** |
| `frontend/src/app/features/courses/course-list/course-list.component.html` | **MODIFY** |

**`course-list.component.ts` changes:**
- Add `paymentTypeFilter = signal<'ALL' | 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION'>('ALL')`.
- Add computed `filteredCourses` that applies the payment type filter on top of existing filters.

**`course-list.component.html` changes:**
- Add filter tabs: **All | One-Time | Monthly** (using `p-tabs` or `p-selectbutton`).
- In the price column: show `{{ course.monthlyFee }}/mo` for monthly courses, `{{ course.price }}` for one-time.
- Add a `p-tag` badge on each row:
```html
<p-tag
  [value]="course.paymentType === 'MONTHLY_SUBSCRIPTION'
    ? ('COURSES.LIST.BADGE_MONTHLY' | translate)
    : ('COURSES.LIST.BADGE_ONE_TIME' | translate)"
  [severity]="course.paymentType === 'MONTHLY_SUBSCRIPTION' ? 'info' : 'secondary'"
></p-tag>
```

---

### 13. Frontend — Course Detail Changes

| File | Action |
|------|--------|
| `frontend/src/app/features/courses/course-detail/course-detail.component.ts` | **MODIFY** |
| `frontend/src/app/features/courses/course-detail/course-detail.component.html` | **MODIFY** |

**Changes:**
- Show `paymentType` badge in the course info card header.
- For `MONTHLY_SUBSCRIPTION` courses: add a **"Monthly Payments"** tab that shows a mini version of the monthly payments dashboard filtered to this course (reuses `MonthlySubscriptionService.getPayments({ courseId })`).
- The existing enrollment table still shows all enrolled students; for monthly courses, the payment progress bar is replaced with "Monthly subscription active" label.
- Add a quick-link button: **"View in Monthly Dashboard"** → navigates to `/monthly-payments?courseId=...`.

---

### 14. Frontend — Navigation (Sidebar)

| File | Action |
|------|--------|
| `frontend/src/app/core/layout/layout.component.ts` | **MODIFY** |

**Add to the `financial` array** (after `NAV.DUES`):
```typescript
{
  labelKey: 'NAV.MONTHLY_PAYMENTS',
  icon: 'pi pi-calendar-clock',
  routerLink: ['/monthly-payments'],
  visible: auth.canRead('enrollments')
},
```

---

### 15. Frontend — App Routes

| File | Action |
|------|--------|
| `frontend/src/app/app.routes.ts` | **MODIFY** |

**Add inside the `LayoutComponent` children array** (after the `dues` route):
```typescript
{
  path: 'monthly-payments',
  canActivate: [permissionGuard('enrollments')],
  data: { breadcrumb: 'BREADCRUMBS.MONTHLY_PAYMENTS' },
  loadChildren: () =>
    import('./features/monthly-subscriptions/monthly-subscriptions.routes')
      .then(m => m.MONTHLY_SUBSCRIPTIONS_ROUTES)
},
```

---

### 16. i18n Translation Files

| File | Action |
|------|--------|
| `frontend/src/assets/i18n/en.json` | **MODIFY** |
| `frontend/src/assets/i18n/ar.json` | **MODIFY** |

**New keys to add (English `en.json`):**

```json
"NAV": {
  "MONTHLY_PAYMENTS": "Monthly Payments"
},
"BREADCRUMBS": {
  "MONTHLY_PAYMENTS": "Monthly Payments"
},
"MONTHLY_PAYMENTS": {
  "TITLE": "Monthly Payments Dashboard",
  "GENERATE_BILLS": "Generate Bills",
  "GENERATE_SUCCESS": "{{count}} bill(s) generated for {{month}}",
  "FILTER_MONTH": "Month",
  "FILTER_BRANCH": "All Branches",
  "FILTER_COURSE": "All Courses",
  "FILTER_STATUS": "All Statuses",
  "SUMMARY_PAID": "Paid",
  "SUMMARY_PENDING": "Pending",
  "SUMMARY_OVERDUE": "Overdue",
  "SUMMARY_PARTIAL": "Partial",
  "SUMMARY_REVENUE": "Revenue Collected",
  "SUMMARY_EXPECTED": "Expected",
  "TAB_ALL": "All",
  "TAB_PAID": "Paid",
  "TAB_PENDING": "Pending",
  "TAB_OVERDUE": "Overdue",
  "TAB_PARTIAL": "Partial",
  "COL_STUDENT": "Student",
  "COL_COURSE": "Course",
  "COL_CLASS": "Class",
  "COL_DUE_DATE": "Due Date",
  "COL_AMOUNT": "Amount",
  "COL_STATUS": "Status",
  "COL_ACTIONS": "Actions",
  "PAY_BTN": "Record Payment",
  "PAY_DIALOG_TITLE": "Record Payment — {{name}}",
  "PAY_AMOUNT": "Amount",
  "PAY_DATE": "Payment Date",
  "PAY_NOTES": "Notes",
  "PAY_SUBMIT": "Confirm Payment",
  "PAY_CANCEL": "Cancel",
  "NO_RECORDS": "No payment records for this month. Click 'Generate Bills' to create them.",
  "STATUS_PAID": "Paid",
  "STATUS_PENDING": "Pending",
  "STATUS_OVERDUE": "Overdue",
  "STATUS_PARTIAL": "Partial"
},
"COURSES": {
  "FORM": {
    "PAYMENT_TYPE_LABEL": "Payment Type",
    "PAYMENT_TYPE_ONE_TIME": "One-Time Payment",
    "PAYMENT_TYPE_MONTHLY": "Monthly Subscription",
    "MONTHLY_FEE_LABEL": "Monthly Fee",
    "MONTHLY_FEE_PLACEHOLDER": "Enter monthly fee amount",
    "MONTHLY_FEE_REQUIRED": "Monthly fee is required for subscription courses"
  },
  "LIST": {
    "TAB_ALL_TYPES": "All",
    "TAB_ONE_TIME": "One-Time",
    "TAB_MONTHLY": "Monthly",
    "BADGE_MONTHLY": "Monthly",
    "BADGE_ONE_TIME": "One-Time"
  }
}
```

**New keys to add (Arabic `ar.json`):**

```json
"NAV": {
  "MONTHLY_PAYMENTS": "المدفوعات الشهرية"
},
"BREADCRUMBS": {
  "MONTHLY_PAYMENTS": "المدفوعات الشهرية"
},
"MONTHLY_PAYMENTS": {
  "TITLE": "لوحة المدفوعات الشهرية",
  "GENERATE_BILLS": "إنشاء الفواتير",
  "GENERATE_SUCCESS": "تم إنشاء {{count}} فاتورة لشهر {{month}}",
  "FILTER_MONTH": "الشهر",
  "FILTER_BRANCH": "جميع الفروع",
  "FILTER_COURSE": "جميع الكورسات",
  "FILTER_STATUS": "جميع الحالات",
  "SUMMARY_PAID": "مدفوع",
  "SUMMARY_PENDING": "لم يدفع",
  "SUMMARY_OVERDUE": "متأخر",
  "SUMMARY_PARTIAL": "جزئي",
  "SUMMARY_REVENUE": "الإيرادات المحصلة",
  "SUMMARY_EXPECTED": "المتوقع",
  "TAB_ALL": "الكل",
  "TAB_PAID": "مدفوع",
  "TAB_PENDING": "لم يدفع",
  "TAB_OVERDUE": "متأخر",
  "TAB_PARTIAL": "جزئي",
  "COL_STUDENT": "الطالب",
  "COL_COURSE": "الكورس",
  "COL_CLASS": "المجموعة",
  "COL_DUE_DATE": "تاريخ الاستحقاق",
  "COL_AMOUNT": "المبلغ",
  "COL_STATUS": "الحالة",
  "COL_ACTIONS": "الإجراءات",
  "PAY_BTN": "تسجيل دفعة",
  "PAY_DIALOG_TITLE": "تسجيل دفعة — {{name}}",
  "PAY_AMOUNT": "المبلغ",
  "PAY_DATE": "تاريخ الدفع",
  "PAY_NOTES": "ملاحظات",
  "PAY_SUBMIT": "تأكيد الدفع",
  "PAY_CANCEL": "إلغاء",
  "NO_RECORDS": "لا توجد سجلات دفع لهذا الشهر. اضغط 'إنشاء الفواتير' لإنشائها.",
  "STATUS_PAID": "مدفوع",
  "STATUS_PENDING": "لم يدفع",
  "STATUS_OVERDUE": "متأخر",
  "STATUS_PARTIAL": "جزئي"
},
"COURSES": {
  "FORM": {
    "PAYMENT_TYPE_LABEL": "نوع الدفع",
    "PAYMENT_TYPE_ONE_TIME": "دفعة واحدة",
    "PAYMENT_TYPE_MONTHLY": "اشتراك شهري",
    "MONTHLY_FEE_LABEL": "الرسوم الشهرية",
    "MONTHLY_FEE_PLACEHOLDER": "أدخل مبلغ الرسوم الشهرية",
    "MONTHLY_FEE_REQUIRED": "الرسوم الشهرية مطلوبة للكورسات الاشتراكية"
  },
  "LIST": {
    "TAB_ALL_TYPES": "الكل",
    "TAB_ONE_TIME": "دفعة واحدة",
    "TAB_MONTHLY": "شهري",
    "BADGE_MONTHLY": "شهري",
    "BADGE_ONE_TIME": "دفعة واحدة"
  }
}
```

---

## Complete File Change Summary

| # | File Path | Action | Priority |
|---|-----------|--------|----------|
| 1 | `aws/sql/schema.sql` | MODIFY ✅ Done | 🔴 Critical |
| 2 | `shared/interfaces/course.interface.ts` | MODIFY | 🔴 Critical |
| 3 | `shared/interfaces/monthly-subscription.interface.ts` | CREATE | 🔴 Critical |
| 4 | `shared/enums/enrollment-status.enum.ts` | MODIFY | 🔴 Critical |
| 5 | `aws/lambda/api/src/contract.ts` | MODIFY | 🔴 Critical |
| 6 | `aws/lambda/api/src/routes/courses.ts` | MODIFY | 🔴 Critical |
| 7 | `aws/lambda/api/src/routes/enrollments.ts` | MODIFY | 🔴 Critical |
| 8 | `aws/lambda/api/src/routes/monthly-subscriptions.ts` | CREATE | 🔴 Critical |
| 9 | `aws/lambda/api/src/index.ts` | MODIFY | 🔴 Critical |
| 10 | `frontend/src/app/features/monthly-subscriptions/monthly-subscriptions.routes.ts` | CREATE | 🔴 Critical |
| 11 | `frontend/src/app/features/monthly-subscriptions/services/monthly-subscription.service.ts` | CREATE | 🔴 Critical |
| 12 | `frontend/src/app/features/monthly-subscriptions/monthly-payments-dashboard/monthly-payments-dashboard.component.ts` | CREATE | 🔴 Critical |
| 13 | `frontend/src/app/features/monthly-subscriptions/monthly-payments-dashboard/monthly-payments-dashboard.component.html` | CREATE | 🔴 Critical |
| 14 | `frontend/src/app/app.routes.ts` | MODIFY | 🔴 Critical |
| 15 | `frontend/src/app/core/layout/layout.component.ts` | MODIFY | 🟡 Important |
| 16 | `frontend/src/app/features/courses/course-form/course-form.component.ts` | MODIFY | 🟡 Important |
| 17 | `frontend/src/app/features/courses/course-form/course-form.component.html` | MODIFY | 🟡 Important |
| 18 | `frontend/src/app/features/courses/course-list/course-list.component.ts` | MODIFY | 🟡 Important |
| 19 | `frontend/src/app/features/courses/course-list/course-list.component.html` | MODIFY | 🟡 Important |
| 20 | `frontend/src/app/features/courses/course-detail/course-detail.component.ts` | MODIFY | 🟡 Important |
| 21 | `frontend/src/app/features/courses/course-detail/course-detail.component.html` | MODIFY | 🟡 Important |
| 22 | `frontend/src/assets/i18n/en.json` | MODIFY | 🟡 Important |
| 23 | `frontend/src/assets/i18n/ar.json` | MODIFY | 🟡 Important |

---

## Implementation Order (Recommended)

```
Phase 1 — Data Layer
  1. ✅ Update schema.sql (payment_type + monthly_fee on courses; payment_type on enrollments; new monthly_subscription_payments table)
  2. Update shared/interfaces/course.interface.ts (add paymentType, monthlyFee)
  3. Create shared/interfaces/monthly-subscription.interface.ts
  4. Update shared/enums/enrollment-status.enum.ts (add MONTHLY_SUBSCRIPTION to PaymentMode)

Phase 2 — Backend Contract & API
  5. Modify contract.ts (extend CourseSchema, add MonthlySubscription schemas + route definitions)
  6. Modify routes/courses.ts (mapCourseFromDB, create, update)
  7. Modify routes/enrollments.ts (copy payment_type from course on create)
  8. Create routes/monthly-subscriptions.ts (all 5 endpoints)
  9. Register routes in index.ts

Phase 3 — Frontend Core
  10. Create monthly-subscription.service.ts
  11. Create monthly-payments-dashboard component (TS + HTML)
  12. Create monthly-subscriptions.routes.ts
  13. Register route in app.routes.ts
  14. Add nav entry in layout.component.ts

Phase 4 — Course UI Updates
  15. Modify course-form (add paymentType SelectButton + monthlyFee InputNumber)
  16. Modify course-list (add type badge + filter tabs)
  17. Modify course-detail (show type badge + monthly payments mini-view tab)

Phase 5 — i18n
  18. Add all new keys to en.json
  19. Add all new keys to ar.json
```

---

## Key Business Rules

| Rule | Detail |
|------|--------|
| **Bill generation** | Staff clicks "Generate Bills" for a month. The system creates one `monthly_subscription_payments` row per active enrollment in a monthly course. Idempotent — running twice is safe (`ON CONFLICT DO NOTHING`). |
| **Overdue detection** | Any row where `due_date < CURRENT_DATE` and `payment_status != 'PAID'` is automatically marked `OVERDUE` (either at generation time or on-read). |
| **Carry-forward** | Unpaid months are NOT deleted when a new month starts. They remain as `OVERDUE` rows and are visible in the dashboard. Staff can pay them at any time. |
| **Partial payment** | If `amount_paid > 0` but `< amount_due`, status = `PARTIAL`. |
| **Full payment** | If `amount_paid >= amount_due`, status = `PAID`, `paid_date` = today. |
| **Enrollment** | Enrolling a student in a monthly course works exactly the same as today (same enrollment form). The `payment_type` is copied from the course automatically. |
| **Course price field** | For monthly courses, the existing `price` field represents a one-time registration/enrollment fee (optional). `monthly_fee` is the recurring charge. |
| **Deactivation** | Deactivating a monthly course stops new bill generation but does NOT delete existing unpaid rows. |
| **Revenue tracking** | Each monthly payment recorded inserts a row into the `revenues` table (same as existing enrollment payments) so financial reports stay accurate. |
| **Permissions** | The monthly payments dashboard uses the existing `enrollments` permission scope (read to view, write to record payments). |
| **RTL support** | All new components follow the existing `languageService.isRtl()` pattern. |
| **Backward compatibility** | All existing courses default to `ONE_TIME`. No existing data is affected. |
