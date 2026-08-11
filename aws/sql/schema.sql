-- Automative / Netrofit Database Schema
-- PostgreSQL — reflects the live schema (all migrations 001–020 applied).

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- COMPANIES TABLE  (migration 001)
-- Top-level tenant row. Every other business table references companies(id).
-- =============================================
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'Egypt',
    tax_id VARCHAR(100),
    registration_number VARCHAR(100),
    industry VARCHAR(100),
    type VARCHAR(20) NOT NULL DEFAULT 'ACADEMY',
    -- Feature plan (migration 053): SIMPLE (core) or ADVANCED (unlocks CRM, etc.).
    plan VARCHAR(20) NOT NULL DEFAULT 'SIMPLE' CHECK (plan IN ('SIMPLE', 'ADVANCED')),
    subscription_tier VARCHAR(50) DEFAULT 'BASIC' CHECK (subscription_tier IN ('BASIC', 'PROFESSIONAL', 'ENTERPRISE')),
    subscription_status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (subscription_status IN ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED')),
    subscription_start_date DATE DEFAULT CURRENT_DATE,
    subscription_end_date DATE,
    max_branches INTEGER DEFAULT 1,
    max_users INTEGER DEFAULT 5,
    timezone VARCHAR(50) DEFAULT 'Africa/Cairo',
    currency VARCHAR(10) DEFAULT 'EGP',
    locale VARCHAR(10) DEFAULT 'en-US',
    -- How global (branch_id IS NULL) expenses are allocated to branches for P&L.
    global_expense_allocation VARCHAR(20) DEFAULT 'OVERHEAD' CHECK (global_expense_allocation IN ('PROPORTIONAL', 'EQUAL', 'OVERHEAD')),
    is_active BOOLEAN DEFAULT true,
    onboarding_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    CONSTRAINT companies_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

CREATE INDEX idx_companies_subscription_status ON companies(subscription_status);

-- =============================================
-- SUBSCRIPTIONS TABLE
-- One row per company tracking their billing state (distinct from the legacy
-- subscription fields on companies, which are retained for backward compat).
-- =============================================
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'TRIAL' CHECK (status IN ('TRIAL', 'ACTIVE', 'MONTHLY', 'ANNUAL', 'EXPIRED')),
    price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    trial_start_date DATE,
    trial_end_date DATE,
    subscription_start_date DATE,
    subscription_end_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_subscriptions_company_id ON subscriptions(company_id);

-- =============================================
-- USERS TABLE
-- =============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    -- RBAC roles added by migration 006.
    role VARCHAR(50) NOT NULL CHECK (role IN (
        'GLOBAL_ADMIN', 'ADMIN', 'ACADEMIC_MANAGER', 'SALES_MANAGER',
        'BRANCH_ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'VIEWER'
    )),
    -- Granular per-resource permissions JSON (migration 006 / runtime).
    permissions JSONB,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID,
    -- Optional link from a user account to an employee record (runtime).
    linked_employee_id UUID,
    -- Email verification — 6-digit OTP delivered via SES at registration.
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    email_otp VARCHAR(6),
    email_otp_expires_at TIMESTAMPTZ,
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    -- Phone is captured at registration (no verification step).
    country_code VARCHAR(8),
    phone VARCHAR(32),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_branch_id ON users(branch_id);
CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_linked_employee_id ON users(linked_employee_id);
CREATE UNIQUE INDEX idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_phone_lookup ON users(phone);

-- =============================================
-- USER_BRANCHES TABLE  (migration 006)
-- Many-to-many: which branches each non-global-admin user can access.
-- =============================================
CREATE TABLE user_branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, branch_id)
);

CREATE INDEX idx_user_branches_user_id ON user_branches(user_id);
CREATE INDEX idx_user_branches_branch_id ON user_branches(branch_id);
CREATE INDEX idx_user_branches_company_id ON user_branches(company_id);

-- =============================================
-- BRANCHES TABLE
-- =============================================
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    phone VARCHAR(50),
    email VARCHAR(255),
    manager_id UUID,
    is_active BOOLEAN DEFAULT true,
    opening_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_branches_company_id ON branches(company_id);
CREATE UNIQUE INDEX branches_company_id_code_key ON branches(company_id, code);
CREATE INDEX idx_branches_manager_id ON branches(manager_id);

-- Add foreign key constraint to users table
ALTER TABLE users ADD CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

-- =============================================
-- LEVELS TABLE  (migration 026)
-- Company-wide catalog of skill/age levels. Courses and master courses may
-- optionally be tagged with one level (courses.level_id / master_courses.level_id).
-- =============================================
CREATE TABLE levels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    age INTEGER,                 -- legacy single age (kept for back-compat)
    from_age INTEGER,            -- optional age range start
    to_age INTEGER,              -- optional age range end (must be > from_age)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_levels_company_id ON levels(company_id);

-- =============================================
-- COURSES TABLE
-- =============================================
-- =============================================
-- MASTER COURSES TABLE
-- Company-wide course templates. A branch-level `courses` row can be linked
-- to a master via `courses.master_course_id`; updates to the master can then
-- be applied in bulk to every linked course.
-- =============================================
CREATE TABLE master_courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    -- The one-off bundle price when ONE_TIME, the monthly fee when
    -- MONTHLY_SUBSCRIPTION — the same double meaning courses.price carries.
    default_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    default_duration INTEGER NOT NULL DEFAULT 8,
    default_max_students INTEGER,
    level_id UUID REFERENCES levels(id) ON DELETE SET NULL,
    -- How the master itself is sold (migration 087). ONE_TIME groups ONE_TIME
    -- members and sells them as one bundle. MONTHLY_SUBSCRIPTION charges a fee
    -- each month and covers its members whatever they cost on their own, so it
    -- is the only kind that can hold monthly and per-session courses.
    payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME'
        CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_master_courses_company ON master_courses(company_id);
CREATE INDEX idx_master_courses_branch ON master_courses(branch_id);
CREATE INDEX idx_master_courses_level_id ON master_courses(level_id);

-- =============================================
-- MASTER ENROLLMENTS TABLE
-- A bundle purchase: student pays the master course price once, then enrolls
-- in any linked course without additional charge. Child enrollments reference
-- back via enrollments.master_enrollment_id.
-- =============================================
CREATE TABLE master_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    master_course_id UUID NOT NULL REFERENCES master_courses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    enrollment_date DATE NOT NULL,
    original_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    final_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    payment_mode VARCHAR(20) NOT NULL DEFAULT 'FULL' CHECK (payment_mode IN ('FULL', 'INSTALLMENTS')),
    down_payment DECIMAL(10, 2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_refunded DECIMAL(10, 2) NOT NULL DEFAULT 0,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PARTIAL', 'PAID')),
    payment_method VARCHAR(50),
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_master_enrollments_student ON master_enrollments(student_id);
CREATE INDEX idx_master_enrollments_master ON master_enrollments(master_course_id);
CREATE INDEX idx_master_enrollments_company ON master_enrollments(company_id);
CREATE UNIQUE INDEX uq_master_enrollments_active
    ON master_enrollments(student_id, master_course_id)
    WHERE status = 'ACTIVE';

-- =============================================
-- MASTER CLASS ENROLLMENTS TABLE
-- Tracks which specific class a student is attending within a master enrollment bundle.
-- =============================================
CREATE TABLE master_class_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    master_enrollment_id UUID NOT NULL REFERENCES master_enrollments(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    enrolled_at DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'DROPPED')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mce_master_enrollment ON master_class_enrollments(master_enrollment_id);
CREATE INDEX idx_mce_student ON master_class_enrollments(student_id);
CREATE INDEX idx_mce_class ON master_class_enrollments(class_id);
CREATE INDEX idx_mce_company ON master_class_enrollments(company_id);

-- =============================================
-- MASTER ENROLLMENT PAYMENTS TABLE
-- Installment / partial payments against a master_enrollment's final_price.
-- =============================================
CREATE TABLE master_enrollment_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    master_enrollment_id UUID NOT NULL REFERENCES master_enrollments(id) ON DELETE CASCADE,
    company_id UUID NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    payment_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mep_me_id ON master_enrollment_payments(master_enrollment_id);

CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID NOT NULL,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    -- duration/max_students live on classes, not courses (migration 051).
    instructor_id UUID,
    level_id UUID REFERENCES levels(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    -- Payment model: ONE_TIME (default), MONTHLY_SUBSCRIPTION, or PER_SESSION.
    -- When MONTHLY_SUBSCRIPTION, the existing `price` column holds the monthly fee.
    -- When PER_SESSION, the existing `price` column holds the per-session fee.
    payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME'
        CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION')),
    -- PER_SESSION settings (only meaningful when payment_type = PER_SESSION):
    session_package_size INTEGER,                                      -- e.g. 8 (null = no advance package offered)
    session_package_price DECIMAL(10, 2),                             -- e.g. 700 (block price, paid upfront)
    charge_absent_sessions BOOLEAN NOT NULL DEFAULT FALSE,            -- bill absent sessions too?
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE INDEX idx_courses_branch_id ON courses(branch_id);
CREATE INDEX idx_courses_company_id ON courses(company_id);
CREATE INDEX idx_courses_level_id ON courses(level_id);

-- A course can be tagged with several levels. This join table is the source of
-- truth; courses.level_id is kept in sync as the first level for old readers.
CREATE TABLE course_levels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    level_id UUID NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, level_id)
);

CREATE INDEX idx_course_levels_course ON course_levels(course_id);
CREATE INDEX idx_course_levels_level ON course_levels(level_id);

CREATE TABLE master_course_courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    master_course_id UUID NOT NULL REFERENCES master_courses(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (master_course_id, course_id)
);

CREATE INDEX idx_mcc_master_course ON master_course_courses(master_course_id);
CREATE INDEX idx_mcc_course ON master_course_courses(course_id);

-- =============================================
-- CLASSES TABLE
-- =============================================
CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL,
    -- branch_id / company_id were removed: both are derivable from courses.
    instructor_id UUID,
    -- TEXT, not VARCHAR(n): a class name has no meaningful length limit
    -- (migration 069).
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    days_of_week VARCHAR(50),
    max_students INTEGER,
    current_enrollment INTEGER DEFAULT 0,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    -- Lifecycle: marks a class as finished (runtime: ensureClassStatusColumns).
    is_finished BOOLEAN NOT NULL DEFAULT false,
    finished_at TIMESTAMP WITH TIME ZONE,
    -- Class delivery mode: OFFLINE (default, in-person) or ONLINE (no room required).
    type VARCHAR(16) NOT NULL DEFAULT 'OFFLINE',
    -- Soft-delete marker: set when a class with payments is "deleted" — the row is
    -- hidden from the tenant but kept for financial integrity. NULL = visible.
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE INDEX idx_classes_course_id ON classes(course_id);
CREATE INDEX idx_classes_instructor_id ON classes(instructor_id);

-- =============================================
-- STUDENTS TABLE
-- =============================================
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- One field, not a first/last pair: a student has one name, and nothing
    -- sorted, searched or addressed anybody by surname alone. See migrations 070
    -- (add + backfill) and 074 (drop first_name/last_name).
    name TEXT NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(10) CHECK (gender IN ('MALE', 'FEMALE')),
    email VARCHAR(255),
    phone VARCHAR(50),
    parent_name VARCHAR(200),
    parent_phone VARCHAR(50),
    address TEXT,
    -- The school the student attends. Optional: a teacher tenant coaching adults
    -- has none to record, and NULL means "not recorded". See migration 081.
    school_name VARCHAR(200),
    branch_id UUID NOT NULL,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    inactive_date DATE,
    inactive_reason TEXT,
    notes TEXT,
    acquisition_channel VARCHAR(50),
    -- Random, unguessable token encoded into the student's QR code. Drives the
    -- public read-only profile page and QR-based attendance check-in. See
    -- migration 029. Not the UUID, so the public page can't be enumerated.
    qr_token VARCHAR(32),
    -- Paid QR activation (TEACHER-type companies only). For academies the QR is
    -- free and these stay at their defaults. qr_expiration NULL + qr_activated
    -- true = lifelong. qr_paid is toggled by the owner once the teacher settles
    -- the activation bill. See migration 041.
    qr_activated BOOLEAN DEFAULT false,
    qr_expiration DATE,
    qr_price DECIMAL(10, 2),
    qr_paid BOOLEAN DEFAULT false,
    -- Short, human-friendly sequential number (1, 2, 3, …) assigned per company.
    -- Lets staff record attendance / payments by typing the number when a
    -- student forgets their QR. Sequential *within* a company, so each academy
    -- starts at 1; see migration 045 and the UNIQUE(company_id, student_code) index.
    student_code INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE INDEX idx_students_branch_id ON students(branch_id);
CREATE UNIQUE INDEX idx_students_qr_token ON students(qr_token);
-- One sequential code per company (codes repeat across companies).
CREATE UNIQUE INDEX idx_students_company_code ON students(company_id, student_code);
CREATE INDEX idx_students_company_id ON students(company_id);
CREATE INDEX idx_students_inactive_date ON students(inactive_date);
CREATE INDEX idx_students_email ON students(email);

-- =============================================
-- ENROLLMENTS TABLE
-- =============================================
CREATE TABLE enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL,
    class_id UUID NOT NULL,
    course_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    enrollment_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'DROPPED', 'PENDING', 'ON_HOLD')),
    hold_start_month INTEGER,
    hold_start_year INTEGER,
    hold_months INTEGER,
    original_price DECIMAL(10, 2) NOT NULL,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    discount_amount DECIMAL(10, 2) DEFAULT 0,
    final_price DECIMAL(10, 2) NOT NULL,
    payment_mode VARCHAR(20) NOT NULL DEFAULT 'FULL' CHECK (payment_mode IN ('FULL', 'INSTALLMENTS')),
    down_payment DECIMAL(10, 2) DEFAULT 0,
    amount_paid DECIMAL(10, 2) DEFAULT 0,
    payment_status VARCHAR(50) NOT NULL CHECK (payment_status IN ('PENDING', 'PARTIAL', 'PAID', 'REFUNDED')),
    total_refunded DECIMAL(10, 2) NOT NULL DEFAULT 0,
    completion_date DATE,
    notes TEXT,
    company_id UUID NOT NULL,
    master_enrollment_id UUID,
    -- Denormalised from courses.payment_type for fast subscription/session queries
    payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME'
        CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (master_enrollment_id) REFERENCES master_enrollments(id) ON DELETE SET NULL
);

CREATE INDEX idx_enrollments_student_id ON enrollments(student_id);
CREATE INDEX idx_enrollments_class_id ON enrollments(class_id);
CREATE INDEX idx_enrollments_course_id ON enrollments(course_id);
CREATE INDEX idx_enrollments_branch_id ON enrollments(branch_id);
CREATE INDEX idx_enrollments_status ON enrollments(status);
CREATE INDEX idx_enrollments_payment_status ON enrollments(payment_status);
CREATE INDEX idx_enrollments_master_enrollment ON enrollments(master_enrollment_id);
CREATE INDEX idx_enrollments_company_id ON enrollments(company_id);

-- =============================================
-- ENROLLMENT PAYMENTS TABLE
-- =============================================
CREATE TABLE enrollment_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL,
    company_id UUID NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    payment_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE
);

CREATE INDEX idx_enrollment_payments_enrollment_id ON enrollment_payments(enrollment_id);
CREATE INDEX idx_enrollment_payments_company_id ON enrollment_payments(company_id);

-- =============================================
-- EVENTS TABLE
-- Company-level occasions (trip, competition, workshop, etc.) with their
-- own mini P&L. Rows in expenses, revenues, refunds, products, and
-- product_sales may be optionally linked to an event via event_id.
-- =============================================
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID,
    name VARCHAR(255) NOT NULL,
    event_type VARCHAR(32) NOT NULL DEFAULT 'OTHER',
    description TEXT,
    location VARCHAR(255),
    start_date DATE,
    end_date DATE,
    status VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
    -- Optional default subscription fee. When set, new event_subscriptions
    -- prefill the amount field with this value.
    subscription_price DECIMAL(10, 2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

CREATE INDEX idx_events_company ON events(company_id);
CREATE INDEX idx_events_branch ON events(branch_id);

-- =============================================
-- EVENT SUBSCRIPTIONS TABLE
-- Records who paid to attend an event. The subscriber is either an existing
-- student (student_id) or a one-off external person (external_* columns).
-- A linked revenue row is created on subscription create and tracked in
-- revenue_id for cleanup on subscription delete.
-- =============================================
CREATE TABLE event_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    -- CASCADE (not SET NULL) because the CHECK constraint below requires
    -- student_id OR an external_first_name/last_name pair. SET NULL would
    -- leave both empty for student-attached rows when the student is deleted
    -- (e.g. as a side-effect of deleting their branch), violating the CHECK.
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    external_first_name VARCHAR(100),
    external_last_name VARCHAR(100),
    external_age INTEGER,
    external_mobile VARCHAR(50),
    amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    payment_date DATE NOT NULL,
    payment_method VARCHAR(50),
    notes TEXT,
    revenue_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (student_id IS NOT NULL) OR
        (external_first_name IS NOT NULL AND external_last_name IS NOT NULL)
    )
);

CREATE INDEX idx_event_subs_company ON event_subscriptions(company_id);
CREATE INDEX idx_event_subs_event ON event_subscriptions(event_id);
CREATE INDEX idx_event_subs_branch ON event_subscriptions(branch_id);
CREATE INDEX idx_event_subs_student ON event_subscriptions(student_id);

-- =============================================
-- REFUNDS TABLE
-- =============================================
-- Refunds may attach to: an enrollment, a master_enrollment, OR an event (event-only).
-- student_id is optional (event refunds may have no specific student or be external).
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID,
    master_enrollment_id UUID,
    company_id UUID NOT NULL,
    branch_id UUID,
    student_id UUID,
    event_id UUID,
    subscription_id UUID,
    product_sale_id UUID,
    amount DECIMAL(10, 2) NOT NULL,
    refund_date DATE NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('FULL', 'PARTIAL')),
    reason TEXT,
    -- Units returned to inventory by this refund (product sales only). 0 = the
    -- customer was refunded without returning the physical product.
    restock_quantity INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE,
    FOREIGN KEY (master_enrollment_id) REFERENCES master_enrollments(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
    FOREIGN KEY (subscription_id) REFERENCES event_subscriptions(id) ON DELETE CASCADE,
    FOREIGN KEY (product_sale_id) REFERENCES product_sales(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

CREATE INDEX idx_refunds_enrollment_id ON refunds(enrollment_id);
CREATE INDEX idx_refunds_master_enrollment_id ON refunds(master_enrollment_id);
CREATE INDEX idx_refunds_company_id ON refunds(company_id);
CREATE INDEX idx_refunds_branch_id ON refunds(branch_id);
CREATE INDEX idx_refunds_student_id ON refunds(student_id);
CREATE INDEX idx_refunds_event ON refunds(event_id);
CREATE INDEX idx_refunds_subscription ON refunds(subscription_id);
CREATE INDEX idx_refunds_product_sale ON refunds(product_sale_id);

-- =============================================
-- EMPLOYEES TABLE
-- =============================================
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    position VARCHAR(100),
    department VARCHAR(100),
    salary DECIMAL(10, 2),
    salary_type VARCHAR(20) NOT NULL DEFAULT 'MONTHLY'
        CHECK (salary_type IN ('MONTHLY', 'SESSION_BASED', 'PERCENTAGE')),
    session_rate DECIMAL(10, 2),
    -- PERCENTAGE salary (migration 051): teacher earns this % of what students
    -- have PAID for the classes they teach (classes.instructor_id). Withdrawable
    -- any time, like SESSION_BASED.
    percentage_rate DECIMAL(5, 2),
    hire_date DATE,
    notes TEXT,
    branch_id UUID,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    is_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    -- Unguessable token for the staff Telegram attendance-bot deep link (migration 046).
    telegram_link_token VARCHAR(32),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

CREATE INDEX idx_employees_branch_id ON employees(branch_id);
CREATE INDEX idx_employees_company_id ON employees(company_id);
CREATE INDEX idx_employees_is_global ON employees(is_global);

-- =============================================
-- REVENUES TABLE
-- =============================================
CREATE TABLE revenues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID NOT NULL,
    course_id UUID,
    enrollment_id UUID,
    student_id UUID,
    event_id UUID,
    amount DECIMAL(10, 2) NOT NULL,
    description TEXT,
    date DATE NOT NULL,
    payment_method VARCHAR(50) CHECK (payment_method IN ('BANK_TRANSFER', 'CASH', 'CREDIT_CARD', 'CHECK')),
    receipt_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
    FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE SET NULL,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE INDEX idx_revenues_branch_id ON revenues(branch_id);
CREATE INDEX idx_revenues_date ON revenues(date);
CREATE INDEX idx_revenues_course_id ON revenues(course_id);
CREATE INDEX idx_revenues_enrollment_id ON revenues(enrollment_id);
CREATE INDEX idx_revenues_student_id ON revenues(student_id);
CREATE INDEX idx_revenues_event ON revenues(event_id);

-- =============================================
-- EXPENSES TABLE
-- =============================================
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('FIXED', 'VARIABLE', 'SHARED', 'CAPITAL')),
    category VARCHAR(50) NOT NULL CHECK (category IN ('SALARIES', 'RENT', 'UTILITIES', 'ELECTRICITY', 'INTERNET', 'WATER', 'MARKETING', 'SUPPLIES', 'EQUIPMENT', 'MAINTENANCE', 'INSURANCE', 'SOFTWARE', 'ADMINISTRATION', 'COGS', 'INVENTORY', 'OTHER')),
    amount DECIMAL(10, 2) NOT NULL,
    description TEXT,
    date DATE NOT NULL,
    is_recurring BOOLEAN DEFAULT false,
    recurring_day INTEGER,
    recurring_template_id UUID,
    employee_id UUID,
    distribution_method VARCHAR(50),
    vendor VARCHAR(255),
    invoice_number VARCHAR(100),
    asset_name VARCHAR(255),
    amortization_months INTEGER,
    product_id UUID,
    product_sale_id UUID,
    event_id UUID,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (recurring_template_id) REFERENCES expenses(id) ON DELETE SET NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    FOREIGN KEY (product_sale_id) REFERENCES product_sales(id) ON DELETE SET NULL,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE INDEX idx_expenses_branch_id ON expenses(branch_id);
CREATE INDEX idx_expenses_company_id ON expenses(company_id);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_type ON expenses(type);
CREATE INDEX idx_expenses_category ON expenses(category);
CREATE INDEX idx_expenses_event ON expenses(event_id);

-- =============================================
-- EXPENSE PAYMENTS TABLE
-- Records actual payments made against expense definitions.
-- expenses = obligation/definition; expense_payments = money actually paid.
-- =============================================
CREATE TABLE expense_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL,
    expense_id UUID,
    branch_id UUID,
    employee_id UUID,
    event_id UUID,
    type VARCHAR(50) NOT NULL DEFAULT 'VARIABLE' CHECK (type IN ('FIXED', 'VARIABLE', 'SHARED', 'CAPITAL')),
    category VARCHAR(50) NOT NULL CHECK (category IN ('SALARIES', 'RENT', 'UTILITIES', 'ELECTRICITY', 'INTERNET', 'WATER', 'MARKETING', 'SUPPLIES', 'EQUIPMENT', 'MAINTENANCE', 'INSURANCE', 'SOFTWARE', 'ADMINISTRATION', 'COGS', 'INVENTORY', 'OTHER')),
    amount DECIMAL(10, 2) NOT NULL,
    date DATE NOT NULL,
    notes TEXT,
    vendor VARCHAR(255),
    invoice_number VARCHAR(100),
    bonus_amount DECIMAL(10, 2) DEFAULT 0,
    discount_amount DECIMAL(10, 2) DEFAULT 0,
    adjustment_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE INDEX idx_expense_payments_company_id ON expense_payments(company_id);
CREATE INDEX idx_expense_payments_expense_id ON expense_payments(expense_id);
CREATE INDEX idx_expense_payments_date ON expense_payments(date);
CREATE INDEX idx_expense_payments_employee_id ON expense_payments(employee_id);
CREATE INDEX idx_expense_payments_category ON expense_payments(category);
CREATE INDEX idx_expense_payments_branch_id ON expense_payments(branch_id);

-- =============================================
-- INSTALLMENT PLANS TABLE
-- An installment_plan represents a financed purchase paid over N months with
-- an optional downpayment. Downpayment hits expense_payments immediately.
-- Each scheduled month is an installment_schedule row; paying it creates an
-- expense_payments row and links it back via payment_id.
-- =============================================
CREATE TABLE installment_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL DEFAULT 'CAPITAL' CHECK (type IN ('FIXED', 'VARIABLE', 'SHARED', 'CAPITAL')),
    category VARCHAR(50) NOT NULL CHECK (category IN ('SALARIES', 'RENT', 'UTILITIES', 'ELECTRICITY', 'INTERNET', 'WATER', 'MARKETING', 'SUPPLIES', 'EQUIPMENT', 'MAINTENANCE', 'INSURANCE', 'SOFTWARE', 'ADMINISTRATION', 'COGS', 'INVENTORY', 'OTHER')),
    total_amount DECIMAL(12, 2) NOT NULL,
    downpayment_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    financed_amount DECIMAL(12, 2) NOT NULL,
    months_count INTEGER NOT NULL CHECK (months_count > 0),
    monthly_amount DECIMAL(12, 2) NOT NULL,
    start_date DATE NOT NULL,
    vendor VARCHAR(255),
    invoice_number VARCHAR(100),
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELED')),
    downpayment_payment_id UUID REFERENCES expense_payments(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_installment_plans_company_id ON installment_plans(company_id);
CREATE INDEX idx_installment_plans_branch_id ON installment_plans(branch_id);
CREATE INDEX idx_installment_plans_status ON installment_plans(status);
CREATE INDEX idx_installment_plans_start_date ON installment_plans(start_date);

-- =============================================
-- INSTALLMENT SCHEDULE TABLE
-- One row per scheduled monthly installment. Paying creates an expense_payments
-- row and links it via payment_id; status flips to PAID.
-- =============================================
CREATE TABLE installment_schedule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    installment_number INTEGER NOT NULL,
    due_date DATE NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'SKIPPED')),
    payment_id UUID REFERENCES expense_payments(id) ON DELETE SET NULL,
    paid_date DATE,
    paid_amount DECIMAL(12, 2),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plan_id, installment_number)
);

CREATE INDEX idx_installment_schedule_plan_id ON installment_schedule(plan_id);
CREATE INDEX idx_installment_schedule_company_id ON installment_schedule(company_id);
CREATE INDEX idx_installment_schedule_status ON installment_schedule(status);
CREATE INDEX idx_installment_schedule_due_date ON installment_schedule(due_date);

-- =============================================
-- CASH STATE TABLE
-- =============================================
CREATE TABLE cash_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    current_balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID,
    notes TEXT,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_cash_state_company_id ON cash_state(company_id);

-- =============================================
-- CASH ADJUSTMENTS TABLE
-- Manual deposits, withdrawals, and discrepancy fixes that sit on top of the
-- derived cash balance (revenue − expenses − stakeholder withdrawals).
-- DEPOSIT/WITHDRAWAL store a signed amount; ADJUSTMENT also records what the
-- user observed vs. what the system thought the balance was at adjustment time.
-- =============================================
CREATE TABLE cash_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT')),
    amount DECIMAL(15, 2) NOT NULL,
    observed_amount DECIMAL(15, 2),
    system_amount DECIMAL(15, 2),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_by_user_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cash_adj_company_date ON cash_adjustments(company_id, date DESC);
CREATE INDEX idx_cash_adj_branch ON cash_adjustments(branch_id);

-- =============================================
-- WITHDRAWALS TABLE
-- =============================================
CREATE TABLE withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    withdrawal_date DATE NOT NULL,
    reason TEXT,
    category VARCHAR(50) DEFAULT 'OTHER',
    payment_method VARCHAR(50) DEFAULT 'CASH',
    stakeholders JSONB DEFAULT '[]',
    receipt_url TEXT,
    approved_by UUID,
    status VARCHAR(50) NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_withdrawals_branch_id ON withdrawals(branch_id);
CREATE INDEX idx_withdrawals_company_id ON withdrawals(company_id);
CREATE INDEX idx_withdrawals_date ON withdrawals(withdrawal_date);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);


-- =============================================
-- DEBTS TABLE
-- Debts owed to external creditors. Routes are stubbed (see routes/debts.ts)
-- but the table is kept in the schema to match the dev database.
-- =============================================
CREATE TABLE debts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID,
    creditor_name VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    remaining_amount DECIMAL(10, 2) NOT NULL,
    description TEXT,
    date DATE NOT NULL,
    due_date DATE,
    status VARCHAR(50) NOT NULL,
    notes TEXT,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

CREATE INDEX idx_debts_company_id ON debts(company_id);
CREATE INDEX idx_debts_branch_id ON debts(branch_id);
CREATE INDEX idx_debts_status ON debts(status);
CREATE INDEX idx_debts_due_date ON debts(due_date);

-- =============================================
-- DEBT PAYMENTS TABLE
-- =============================================
CREATE TABLE debt_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    debt_id UUID NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE CASCADE
);

CREATE INDEX idx_debt_payments_debt_id ON debt_payments(debt_id);
CREATE INDEX idx_debt_payments_payment_date ON debt_payments(payment_date);

-- =============================================
-- PRODUCTS TABLE
-- =============================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    cost_price DECIMAL(10, 2) NOT NULL,
    selling_price DECIMAL(10, 2) NOT NULL,
    stock INTEGER DEFAULT 0 NOT NULL,
    min_stock INTEGER DEFAULT 0 NOT NULL,
    unit VARCHAR(50) NOT NULL,
    branch_id UUID NOT NULL,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    event_id UUID,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
    CONSTRAINT products_company_id_code_key UNIQUE(company_id, code)
);

CREATE INDEX idx_products_branch_id ON products(branch_id);
CREATE INDEX idx_products_company_id ON products(company_id);
CREATE INDEX idx_products_code ON products(code);
CREATE INDEX idx_products_event ON products(event_id);

-- =============================================
-- PRODUCT SALES TABLE
-- =============================================
CREATE TABLE product_sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    branch_id UUID,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    discount_type VARCHAR(50) DEFAULT 'NONE',
    discount_value DECIMAL(10, 2) DEFAULT 0,
    discount_amount DECIMAL(10, 2) DEFAULT 0,
    subtotal DECIMAL(10, 2),
    total_amount DECIMAL(10, 2) NOT NULL,
    sale_date DATE NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'CASH',
    receipt_number VARCHAR(100),
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    notes TEXT,
    event_id UUID,
    -- Educational Books (migration 031): attribute a sale to a student/course/enrollment.
    -- All nullable so plain walk-in product sales are unaffected.
    student_id UUID,
    course_id UUID,
    enrollment_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
    FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE SET NULL
);

CREATE INDEX idx_product_sales_product_id ON product_sales(product_id);
CREATE INDEX idx_product_sales_branch_id ON product_sales(branch_id);
CREATE INDEX idx_product_sales_sale_date ON product_sales(sale_date);
CREATE INDEX idx_product_sales_event ON product_sales(event_id);
CREATE INDEX idx_product_sales_student ON product_sales(student_id);
CREATE INDEX idx_product_sales_course ON product_sales(course_id);
CREATE INDEX idx_product_sales_enrollment ON product_sales(enrollment_id);

-- =============================================
-- COURSE_PRODUCTS TABLE  (migration 031)
-- Links a course to one or more products (usually books). Powers the
-- Educational Books page and buy-with-enrollment. UNIQUE(course, product).
-- =============================================
CREATE TABLE course_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    course_id  UUID NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    is_required BOOLEAN NOT NULL DEFAULT true,
    default_discount_type  VARCHAR(20) NOT NULL DEFAULT 'NONE' CHECK (default_discount_type IN ('NONE', 'PERCENTAGE', 'FIXED_AMOUNT')),
    default_discount_value DECIMAL(10, 2) NOT NULL DEFAULT 0,
    added_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT course_products_course_product_key UNIQUE (course_id, product_id)
);

CREATE INDEX idx_course_products_course  ON course_products(course_id);
CREATE INDEX idx_course_products_product ON course_products(product_id);
CREATE INDEX idx_course_products_company ON course_products(company_id);

-- =============================================
-- STOCK PURCHASES TABLE  (migration 025)
-- Tracks every inventory restock event with the cost paid per unit.
-- Each row also links to the corresponding INVENTORY expense record.
-- =============================================
CREATE TABLE stock_purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    cost_per_unit DECIMAL(10, 2) NOT NULL,
    total_cost DECIMAL(10, 2) NOT NULL,
    date DATE NOT NULL,
    notes TEXT,
    expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stock_purchases_product ON stock_purchases(product_id);
CREATE INDEX idx_stock_purchases_company ON stock_purchases(company_id);
CREATE INDEX idx_stock_purchases_date ON stock_purchases(date);

-- =============================================
-- ROOMS TABLE  (migration 023)
-- Physical rooms within a branch where sessions take place.
-- =============================================
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (branch_id, code)
);

CREATE INDEX idx_rooms_company_id ON rooms(company_id);
CREATE INDEX idx_rooms_branch_id ON rooms(branch_id);
CREATE INDEX idx_rooms_is_active ON rooms(is_active);

-- Add default_room_id to courses (migration 023)
ALTER TABLE courses
    ADD COLUMN default_room_id UUID REFERENCES rooms(id) ON DELETE SET NULL;

CREATE INDEX idx_courses_default_room_id ON courses(default_room_id);

-- =============================================
-- SESSIONS TABLE  (migration 023)
-- A live session: a class running in a room at a specific time.
-- =============================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    -- Per-Course sequence number (1, 2, 3 …). Session number N is conceptually
    -- "the same session" across every class of a course (migration 030).
    session_number INTEGER,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_company_id ON sessions(company_id);
CREATE INDEX idx_sessions_branch_id ON sessions(branch_id);
CREATE INDEX idx_sessions_room_id ON sessions(room_id);
CREATE INDEX idx_sessions_class_id ON sessions(class_id);
CREATE INDEX idx_sessions_start_date ON sessions(start_date);
CREATE INDEX idx_sessions_end_date ON sessions(end_date);
CREATE INDEX idx_sessions_session_number ON sessions(session_number);

-- =============================================
-- SESSION ATTENDANCE TABLE  (migration 024; substitution: migration 030)
-- Records which students were present at a given session.
-- One row per present student; absence = no row.
--
-- attendance_type:
--   NORMAL       — an enrolled student attended their own class (default).
--   SUBSTITUTION — a student attended a sibling class of the SAME course they
--                  are NOT enrolled in (they were/are absent from their own
--                  class's session). home_class_id points at the enrolled class
--                  the attendance substitutes for, and substitute_for_session_id
--                  at the exact lesson of that class it makes up for.
-- "Absent-with-substitution" on the home class is derived: no NORMAL row there
-- + a SUBSTITUTION row pointing at it (migration 082). Session numbers are
-- per-class, so they drift between sibling classes and cannot carry this — the
-- id can, in both directions: the make-up may be sat before OR after the lesson
-- it covers, and when it comes first the link is attached once that lesson is
-- opened. See aws/lambda/api/src/db/substitutions.ts.
-- =============================================
CREATE TABLE session_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    attendance_type VARCHAR(16) NOT NULL DEFAULT 'NORMAL'
        CHECK (attendance_type IN ('NORMAL', 'SUBSTITUTION')),
    home_class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
    -- The home-class lesson this SUBSTITUTION stands in for. NULL while that
    -- lesson has not been opened yet (attended early), or when the make-up
    -- covers nothing.
    substitute_for_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, student_id)
);

CREATE INDEX idx_session_attendance_session ON session_attendance(session_id);
CREATE INDEX idx_session_attendance_student ON session_attendance(student_id);
CREATE INDEX idx_session_attendance_home_class ON session_attendance(home_class_id);
CREATE INDEX idx_session_attendance_substitute_for ON session_attendance(substitute_for_session_id);
-- One missed lesson is covered once: two make-ups by the same student cannot
-- both claim the same home session.
CREATE UNIQUE INDEX uq_session_attendance_substitute_claim
    ON session_attendance(student_id, substitute_for_session_id)
    WHERE substitute_for_session_id IS NOT NULL;

-- =============================================
-- SESSION TEACHER ATTENDANCE TABLE
-- Records which teachers (employees) attended a given session and in what role.
-- Default: one row per session for the class's assigned instructor (role=PRIMARY,
-- status=PRESENT). Additional rows for substitutes/assistants. If the primary
-- was a no-show, flip their status to ABSENT and add a SUBSTITUTE.
-- =============================================
CREATE TABLE session_teacher_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL DEFAULT 'PRIMARY' CHECK (role IN ('PRIMARY', 'SUBSTITUTE', 'ASSISTANT')),
    status VARCHAR(8) NOT NULL DEFAULT 'PRESENT' CHECK (status IN ('PRESENT', 'ABSENT')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, employee_id)
);

CREATE INDEX idx_session_teacher_attendance_session ON session_teacher_attendance(session_id);
CREATE INDEX idx_session_teacher_attendance_employee ON session_teacher_attendance(employee_id);

-- =============================================
-- DEMO LEADS TABLE
-- Public "Book a Demo" submissions from the marketing landing page. No
-- tenant scope — these are pre-customer records reviewed by Netrofit staff.
-- =============================================
CREATE TABLE demo_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    company VARCHAR(255),
    country VARCHAR(10),
    branch_count INTEGER,
    message TEXT,
    source VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'LOST', 'CONVERTED')),
    user_agent TEXT,
    ip VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_demo_leads_created ON demo_leads(created_at DESC);
CREATE INDEX idx_demo_leads_status ON demo_leads(status);
CREATE INDEX idx_demo_leads_email ON demo_leads(email);

-- =============================================
-- TRIGGERS FOR UPDATED_AT
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to all tables
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_levels_updated_at BEFORE UPDATE ON levels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_master_courses_updated_at BEFORE UPDATE ON master_courses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_master_enrollments_updated_at BEFORE UPDATE ON master_enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_master_class_enrollments_updated_at BEFORE UPDATE ON master_class_enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_demo_leads_updated_at BEFORE UPDATE ON demo_leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_classes_updated_at BEFORE UPDATE ON classes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_enrollments_updated_at BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_revenues_updated_at BEFORE UPDATE ON revenues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_withdrawals_updated_at BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_debts_updated_at BEFORE UPDATE ON debts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_installment_plans_updated_at BEFORE UPDATE ON installment_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_installment_schedule_updated_at BEFORE UPDATE ON installment_schedule FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Stamp students.inactive_date when a student is deactivated (is_active flips
-- true -> false) and clear it on reactivation. This gives the churn/over-time
-- reports a deactivation date regardless of which code path flips the flag.
CREATE OR REPLACE FUNCTION set_student_inactive_date()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_active = false AND COALESCE(OLD.is_active, true) = true AND NEW.inactive_date IS NULL THEN
        NEW.inactive_date = CURRENT_DATE;
    ELSIF NEW.is_active = true AND COALESCE(OLD.is_active, true) = false THEN
        NEW.inactive_date = NULL;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trg_student_inactive_date BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION set_student_inactive_date();

-- =============================================
-- VIEWS FOR ANALYTICS
-- =============================================

-- Revenue Summary by Branch
CREATE VIEW revenue_summary_by_branch AS
SELECT
    b.id as branch_id,
    b.name as branch_name,
    DATE_TRUNC('month', r.date) as month,
    SUM(r.amount) as total_revenue,
    COUNT(r.id) as transaction_count
FROM branches b
LEFT JOIN revenues r ON b.id = r.branch_id
GROUP BY b.id, b.name, DATE_TRUNC('month', r.date);

-- Expense Summary by Branch
CREATE VIEW expense_summary_by_branch AS
SELECT
    b.id as branch_id,
    b.name as branch_name,
    DATE_TRUNC('month', e.date) as month,
    e.type,
    e.category,
    SUM(e.amount) as total_expense
FROM branches b
LEFT JOIN expenses e ON b.id = e.branch_id
GROUP BY b.id, b.name, DATE_TRUNC('month', e.date), e.type, e.category;

-- Student Enrollment Stats
CREATE VIEW student_enrollment_stats AS
SELECT
    b.id as branch_id,
    b.name as branch_name,
    COUNT(DISTINCT s.id) as total_students,
    COUNT(DISTINCT CASE WHEN s.is_active = true THEN s.id END) as active_students,
    COUNT(DISTINCT CASE WHEN s.inactive_date IS NOT NULL THEN s.id END) as inactive_students
FROM branches b
LEFT JOIN students s ON b.id = s.branch_id
GROUP BY b.id, b.name;

-- =============================================
-- MONTHLY SUBSCRIPTION PAYMENTS TABLE  (migration 027)
-- One row per student per billing month for MONTHLY_SUBSCRIPTION courses.
-- Generated by staff via POST /monthly-subscriptions/generate (idempotent).
-- =============================================
CREATE TABLE monthly_subscription_payments (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- A bill has exactly one subject (migration 087): a course enrolment, or a
    -- master enrolment when the master itself is sold per month. A master bill
    -- has no single course behind it — it covers every course in the bundle —
    -- so enrollment_id and course_id are empty on those rows.
    enrollment_id    UUID REFERENCES enrollments(id) ON DELETE CASCADE,
    master_enrollment_id UUID REFERENCES master_enrollments(id) ON DELETE CASCADE,
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_id        UUID REFERENCES courses(id) ON DELETE CASCADE,
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
    CONSTRAINT msp_one_subject CHECK (num_nonnulls(enrollment_id, master_enrollment_id) = 1),
    -- Course bills stay unique per month. NULLs are not equal in Postgres, so
    -- master rows fall outside this and get uq_msp_master_month instead.
    UNIQUE (enrollment_id, billing_year, billing_month)
);

CREATE UNIQUE INDEX uq_msp_master_month
    ON monthly_subscription_payments(master_enrollment_id, billing_year, billing_month)
    WHERE master_enrollment_id IS NOT NULL;

CREATE INDEX idx_msp_enrollment_id   ON monthly_subscription_payments(enrollment_id);
CREATE INDEX idx_msp_master_enrollment ON monthly_subscription_payments(master_enrollment_id);
CREATE INDEX idx_msp_company_id      ON monthly_subscription_payments(company_id);
CREATE INDEX idx_msp_student_id      ON monthly_subscription_payments(student_id);
CREATE INDEX idx_msp_course_id       ON monthly_subscription_payments(course_id);
CREATE INDEX idx_msp_branch_id       ON monthly_subscription_payments(branch_id);
CREATE INDEX idx_msp_billing_year    ON monthly_subscription_payments(billing_year);
CREATE INDEX idx_msp_billing_month   ON monthly_subscription_payments(billing_month);
CREATE INDEX idx_msp_payment_status  ON monthly_subscription_payments(payment_status);
CREATE INDEX idx_msp_due_date        ON monthly_subscription_payments(due_date);

CREATE TRIGGER update_monthly_subscription_payments_updated_at
    BEFORE UPDATE ON monthly_subscription_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- MONTHLY SUBSCRIPTION INSTALLMENTS  (migration 079)
-- One row per COLLECTION against a monthly bill. The bill above holds a single
-- cumulative amount_paid and a single paid_date, so a second installment used to
-- move the whole collected amount onto the later date (100 on the 19th + 200 on
-- the 26th read as 300 on the 26th). Every date-bucketed revenue read sums these
-- rows; the bill keeps amount_paid/paid_date as denormalised status.
-- Refunds do not touch this table — amount_paid stays gross and refunds are
-- subtracted from the refunds table by refund_date.
-- =============================================
CREATE TABLE monthly_subscription_installments (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    monthly_payment_id UUID NOT NULL REFERENCES monthly_subscription_payments(id) ON DELETE CASCADE,
    company_id         UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
    -- Same two possible subjects as the bill this pays off (migration 087).
    enrollment_id      UUID REFERENCES enrollments(id) ON DELETE CASCADE,
    master_enrollment_id UUID REFERENCES master_enrollments(id) ON DELETE CASCADE,
    student_id         UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
    course_id          UUID REFERENCES courses(id)     ON DELETE CASCADE,
    branch_id          UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
    amount             DECIMAL(10, 2) NOT NULL,
    payment_date       DATE NOT NULL,
    notes              TEXT,
    -- TRUE only for a row synthesised from a bill that was already paid when the
    -- ledger was introduced (whole amount_paid on the bill's last paid_date).
    is_backfill        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT msi_one_subject CHECK (num_nonnulls(enrollment_id, master_enrollment_id) = 1)
);

CREATE INDEX idx_msi_payment_id   ON monthly_subscription_installments(monthly_payment_id);
CREATE INDEX idx_msi_company_date ON monthly_subscription_installments(company_id, payment_date);
CREATE INDEX idx_msi_branch_id    ON monthly_subscription_installments(branch_id);
CREATE INDEX idx_msi_student_id   ON monthly_subscription_installments(student_id);
CREATE INDEX idx_msi_course_id    ON monthly_subscription_installments(course_id);
CREATE UNIQUE INDEX uq_msi_backfill
    ON monthly_subscription_installments(monthly_payment_id) WHERE is_backfill;

-- =============================================
-- COURSE MONTHLY PRICE OVERRIDES TABLE  (migration 042)
-- Allows teachers to override the price of a monthly-subscription course
-- for a specific month. Student amounts scale proportionally.
-- =============================================
CREATE TABLE course_monthly_price_overrides (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- The overridden thing: a monthly course, or a master course sold per month
    -- (migration 088). Exactly one, the same pairing the bills themselves use.
    course_id        UUID REFERENCES courses(id) ON DELETE CASCADE,
    master_course_id UUID REFERENCES master_courses(id) ON DELETE CASCADE,
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    billing_year     INTEGER NOT NULL,
    billing_month    INTEGER NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
    override_price   DECIMAL(10, 2) NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT cmpo_one_subject CHECK (num_nonnulls(course_id, master_course_id) = 1),
    UNIQUE (course_id, billing_year, billing_month)
);

CREATE UNIQUE INDEX uq_cmpo_master_month
    ON course_monthly_price_overrides(master_course_id, billing_year, billing_month)
    WHERE master_course_id IS NOT NULL;

CREATE INDEX idx_cmpo_course_id   ON course_monthly_price_overrides(course_id);
CREATE INDEX idx_cmpo_master_course ON course_monthly_price_overrides(master_course_id);
CREATE INDEX idx_cmpo_company_id  ON course_monthly_price_overrides(company_id);

CREATE TRIGGER update_course_monthly_price_overrides_updated_at
    BEFORE UPDATE ON course_monthly_price_overrides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- EMPLOYEE COURSE PERCENTAGES TABLE  (migration 089)
-- A PERCENTAGE teacher's rate for one specific course. employees.percentage_rate
-- remains the global rate and applies to every course without a row here — a row
-- is an exception to it, not a replacement, so "X% of everything" is the global
-- rate with no rows at all.
-- =============================================
CREATE TABLE employee_course_percentages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    course_id       UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
    -- How this teacher is paid for THIS course (migration 090). Overrides
    -- employees.salary_type for it — the method as well as the number.
    pay_type        VARCHAR(20) NOT NULL DEFAULT 'PERCENTAGE'
                        CHECK (pay_type IN ('PERCENTAGE', 'SESSION_BASED')),
    percentage_rate DECIMAL(5, 2) CHECK (percentage_rate >= 0 AND percentage_rate <= 100),
    session_rate    DECIMAL(10, 2),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Whichever method is named, the number it needs must be present.
    CONSTRAINT ecp_rate_matches_type CHECK (
      (pay_type = 'PERCENTAGE'    AND percentage_rate IS NOT NULL AND session_rate IS NULL)
      OR
      (pay_type = 'SESSION_BASED' AND session_rate    IS NOT NULL AND percentage_rate IS NULL)
    ),
    UNIQUE (employee_id, course_id)
);

CREATE INDEX idx_ecp_employee ON employee_course_percentages(employee_id);
CREATE INDEX idx_ecp_company  ON employee_course_percentages(company_id);
CREATE INDEX idx_ecp_course   ON employee_course_percentages(course_id);

-- =============================================
-- SESSION PACKAGES TABLE  (migration 050)
-- Prepaid credit balance for PER_SESSION courses ("pay X sessions in advance").
-- One row per package bought upfront; attendance consumes credits.
-- =============================================
CREATE TABLE session_packages (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id      UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    company_id         UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
    student_id         UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
    course_id          UUID NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
    branch_id          UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
    sessions_total     INTEGER NOT NULL,
    sessions_used      INTEGER NOT NULL DEFAULT 0,
    amount_due         DECIMAL(10, 2) NOT NULL DEFAULT 0,
    amount_paid        DECIMAL(10, 2) NOT NULL DEFAULT 0,
    status             VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                           CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'REFUNDED')),
    purchased_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes              TEXT,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_spkg_enrollment_id ON session_packages(enrollment_id);
CREATE INDEX idx_spkg_company_id    ON session_packages(company_id);
CREATE INDEX idx_spkg_student_id    ON session_packages(student_id);
CREATE INDEX idx_spkg_course_id     ON session_packages(course_id);
CREATE INDEX idx_spkg_branch_id     ON session_packages(branch_id);
CREATE INDEX idx_spkg_status        ON session_packages(status);

-- =============================================
-- SESSION PACKAGE INSTALLMENTS  (migration 079)
-- One row per COLLECTION against a prepaid bundle: the money taken at purchase
-- and every later top-up. A package has no "last paid" column — purchased_at is
-- the purchase day and never moves — so summing amount_paid against it booked a
-- top-up back onto a day that had already been reported. Date-bucketed revenue
-- reads sum these rows instead; amount_paid stays the settled-so-far total that
-- the remaining balance is computed from.
-- =============================================
CREATE TABLE session_package_installments (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_package_id UUID NOT NULL REFERENCES session_packages(id) ON DELETE CASCADE,
    company_id         UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
    enrollment_id      UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    student_id         UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
    course_id          UUID NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
    branch_id          UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
    amount             DECIMAL(10, 2) NOT NULL,
    payment_date       DATE NOT NULL,
    notes              TEXT,
    is_backfill        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pki_package_id   ON session_package_installments(session_package_id);
CREATE INDEX idx_pki_company_date ON session_package_installments(company_id, payment_date);
CREATE INDEX idx_pki_branch_id    ON session_package_installments(branch_id);
CREATE INDEX idx_pki_student_id   ON session_package_installments(student_id);
CREATE INDEX idx_pki_course_id    ON session_package_installments(course_id);
CREATE UNIQUE INDEX uq_pki_backfill
    ON session_package_installments(session_package_id) WHERE is_backfill;

CREATE TRIGGER update_session_packages_updated_at
    BEFORE UPDATE ON session_packages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- SESSION PAYMENTS TABLE  (migration 050)
-- Per-session billing ledger / dues for PER_SESSION courses.
-- One row per billable (enrollment, session), created when attendance is taken.
-- payment_status: COVERED (by package) | PAID | PENDING (due) | WAIVED | REFUNDED
-- =============================================
CREATE TABLE session_payments (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id    UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    session_id       UUID NOT NULL REFERENCES sessions(id)    ON DELETE CASCADE,
    company_id       UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
    student_id       UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
    course_id        UUID NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
    branch_id        UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
    package_id       UUID REFERENCES session_packages(id) ON DELETE SET NULL,
    attendance_state VARCHAR(10) NOT NULL DEFAULT 'PRESENT'
                         CHECK (attendance_state IN ('PRESENT', 'ABSENT')),
    amount_due       DECIMAL(10, 2) NOT NULL DEFAULT 0,
    amount_paid      DECIMAL(10, 2) NOT NULL DEFAULT 0,
    payment_status   VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                         CHECK (payment_status IN ('PENDING', 'PAID', 'COVERED', 'WAIVED', 'REFUNDED')),
    paid_date        DATE,
    notes            TEXT,
    refunded_amount  DECIMAL(10, 2) NOT NULL DEFAULT 0,
    refund_note      TEXT,
    refunded_at      TIMESTAMP WITH TIME ZONE,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (enrollment_id, session_id)
);

CREATE INDEX idx_sp_enrollment_id  ON session_payments(enrollment_id);
CREATE INDEX idx_sp_session_id     ON session_payments(session_id);
CREATE INDEX idx_sp_company_id     ON session_payments(company_id);
CREATE INDEX idx_sp_student_id     ON session_payments(student_id);
CREATE INDEX idx_sp_course_id      ON session_payments(course_id);
CREATE INDEX idx_sp_branch_id      ON session_payments(branch_id);
CREATE INDEX idx_sp_package_id     ON session_payments(package_id);
CREATE INDEX idx_sp_payment_status ON session_payments(payment_status);

CREATE TRIGGER update_session_payments_updated_at
    BEFORE UPDATE ON session_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- SESSION PAYMENT INSTALLMENTS  (migration 079)
-- One row per COLLECTION against a per-session charge — same reason as
-- monthly_subscription_installments above: the charge holds one cumulative
-- amount_paid and one paid_date, so a part payment followed by the rest booked
-- all of it on the later date. Date-bucketed revenue reads sum these rows.
-- COVERED charges carry amount_paid = 0 (their money is on the package row), so
-- they never appear here.
-- =============================================
CREATE TABLE session_payment_installments (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_payment_id UUID NOT NULL REFERENCES session_payments(id) ON DELETE CASCADE,
    company_id         UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
    enrollment_id      UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    student_id         UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
    course_id          UUID NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
    branch_id          UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
    amount             DECIMAL(10, 2) NOT NULL,
    payment_date       DATE NOT NULL,
    notes              TEXT,
    is_backfill        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_spi_payment_id   ON session_payment_installments(session_payment_id);
CREATE INDEX idx_spi_company_date ON session_payment_installments(company_id, payment_date);
CREATE INDEX idx_spi_branch_id    ON session_payment_installments(branch_id);
CREATE INDEX idx_spi_student_id   ON session_payment_installments(student_id);
CREATE INDEX idx_spi_course_id    ON session_payment_installments(course_id);
CREATE UNIQUE INDEX uq_spi_backfill
    ON session_payment_installments(session_payment_id) WHERE is_backfill;

-- =============================================
-- EXAMS TABLES
-- An exam belongs to a Course (name + date + status SCHEDULED/DONE). Grades are
-- recorded one-per-student-per-exam, usually via QR scan. branch_id/company_id
-- are denormalised from the course for fast, branch-scoped listing. See exam.md.
-- =============================================
CREATE TABLE exams (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
    course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    exam_date   DATE NOT NULL,
    max_grade   DECIMAL(6, 2),
    status      VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED'
                  CHECK (status IN ('SCHEDULED', 'DONE')),
    -- Homework rides on this table behind a flag (migration 059) — same grading,
    -- listed separately. class_id narrows who sits it to one class (an exam left
    -- without one stays course-wide); session_id is the optional stamp for
    -- homework recorded during a lesson. Both FKs SET NULL so deleting a session
    -- or a class never destroys the marks recorded against them.
    is_homework BOOLEAN NOT NULL DEFAULT false,
    class_id    UUID REFERENCES classes(id)  ON DELETE SET NULL,
    session_id  UUID REFERENCES sessions(id) ON DELETE SET NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_exams_company   ON exams(company_id);
CREATE INDEX idx_exams_branch    ON exams(branch_id);
CREATE INDEX idx_exams_course    ON exams(course_id);
CREATE INDEX idx_exams_exam_date ON exams(exam_date);
CREATE INDEX idx_exams_class     ON exams(class_id);
CREATE INDEX idx_exams_session   ON exams(session_id);
CREATE INDEX idx_exams_homework  ON exams(company_id, is_homework);

CREATE TABLE exam_results (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id     UUID NOT NULL REFERENCES exams(id)     ON DELETE CASCADE,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    course_id   UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
    student_id  UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
    -- NULL grade is allowed when the student was absent (is_absent = true).
    grade       VARCHAR(50),
    is_absent   BOOLEAN NOT NULL DEFAULT false,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, student_id)
);

CREATE INDEX idx_exam_results_exam    ON exam_results(exam_id);
CREATE INDEX idx_exam_results_student ON exam_results(student_id);
CREATE INDEX idx_exam_results_company ON exam_results(company_id);

CREATE TRIGGER update_exams_updated_at
    BEFORE UPDATE ON exams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_exam_results_updated_at
    BEFORE UPDATE ON exam_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- SESSION SALARY PAYMENTS
-- Links a taught session to the salary payment that covered it, so
-- session-based teachers can be paid partially through a month and reappear
-- for newly-attended sessions. See migration 038 / exam.md-style flow.
-- =============================================
CREATE TABLE session_salary_payments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id)        ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id)        ON DELETE CASCADE,
    session_id  UUID NOT NULL REFERENCES sessions(id)         ON DELETE CASCADE,
    payment_id  UUID NOT NULL REFERENCES expense_payments(id) ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, session_id)
);

CREATE INDEX idx_ssp_employee ON session_salary_payments(employee_id);
CREATE INDEX idx_ssp_payment  ON session_salary_payments(payment_id);
CREATE INDEX idx_ssp_session  ON session_salary_payments(session_id);

-- =============================================
-- WHATSAPP TEMPLATES (click-to-chat / wa.me)
-- =============================================
-- Editable message bodies per company. Messages are sent from each staff
-- member's own WhatsApp via wa.me deep links — the server only stores the
-- editable templates; it does not send anything.
CREATE TABLE whatsapp_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL
                  CHECK (type IN ('QR_STUDENT', 'FOLLOWUP_PARENT', 'ABSENCE', 'PAYMENT_DELAY', 'EXAM_RESULTS')),
    body        TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, type)
);

CREATE INDEX idx_whatsapp_templates_company ON whatsapp_templates(company_id);

CREATE TRIGGER update_whatsapp_templates_updated_at
    BEFORE UPDATE ON whatsapp_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- TELEGRAM (attendance bot + auto-notifications) — see migration 046
-- =============================================
-- Per-company bot config + notification toggles. bot_token is server-only.
CREATE TABLE telegram_settings (
    company_id        UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    bot_token         VARCHAR(255),
    bot_username      VARCHAR(64),
    webhook_secret    VARCHAR(64),
    enabled           BOOLEAN NOT NULL DEFAULT false,
    notify_on_present BOOLEAN NOT NULL DEFAULT true,
    notify_on_absent  BOOLEAN NOT NULL DEFAULT true,
    notify_target     VARCHAR(16) NOT NULL DEFAULT 'BOTH'
                        CHECK (notify_target IN ('STUDENT','PARENT','BOTH')),
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Maps a student/parent/staff to the Telegram chat we can message (captured on /start).
CREATE TABLE telegram_links (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role              VARCHAR(16) NOT NULL CHECK (role IN ('STUDENT','PARENT','STAFF')),
    student_id        UUID REFERENCES students(id)  ON DELETE CASCADE,
    employee_id       UUID REFERENCES employees(id) ON DELETE CASCADE,
    chat_id           BIGINT NOT NULL,
    telegram_username VARCHAR(64),
    linked_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, role, chat_id),
    CHECK ( (role IN ('STUDENT','PARENT') AND student_id IS NOT NULL)
         OR (role = 'STAFF' AND employee_id IS NOT NULL) )
);
CREATE INDEX idx_tg_links_student  ON telegram_links(student_id);
CREATE INDEX idx_tg_links_employee ON telegram_links(employee_id);
CREATE INDEX idx_tg_links_chat     ON telegram_links(company_id, chat_id);

-- Editable PRESENT/ABSENT/LINK_WELCOME message bodies (defaults filled in app code).
CREATE TABLE telegram_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL CHECK (type IN ('PRESENT','ABSENT','LINK_WELCOME','EXAM_RESULT','EXAM_ABSENT')),
    body        TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, type)
);

-- Delivery log + idempotency guard for auto-notify.
CREATE TABLE telegram_outbox (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    chat_id      BIGINT NOT NULL,
    student_id   UUID REFERENCES students(id) ON DELETE SET NULL,
    session_id   UUID REFERENCES sessions(id) ON DELETE SET NULL,
    kind         VARCHAR(16) NOT NULL CHECK (kind IN ('PRESENT','ABSENT')),
    body         TEXT NOT NULL,
    status       VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','SENT','FAILED','SKIPPED')),
    error        TEXT,
    attempts     INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sent_at      TIMESTAMP WITH TIME ZONE,
    UNIQUE (session_id, student_id, chat_id, kind)
);
CREATE INDEX idx_tg_outbox_company ON telegram_outbox(company_id);
CREATE INDEX idx_tg_outbox_status  ON telegram_outbox(status);

CREATE TRIGGER update_telegram_settings_updated_at
    BEFORE UPDATE ON telegram_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_telegram_templates_updated_at
    BEFORE UPDATE ON telegram_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Pool of platform-owned bots auto-assigned to academies on enable (migration 047).
CREATE TABLE telegram_bot_pool (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_token           VARCHAR(255) NOT NULL UNIQUE,
    bot_username        VARCHAR(64) NOT NULL,
    assigned_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    assigned_at         TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tg_pool_assigned ON telegram_bot_pool(assigned_company_id);

-- =============================================
-- CRM LEADS (migration 053) — Phase 1 CRM for ADVANCED-plan academies.
-- A prospective student before they enroll: captured, owned, moved through a
-- fixed pipeline, and converted into a real student on close.
-- =============================================
CREATE TABLE crm_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    full_name VARCHAR(200) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    source VARCHAR(50),                        -- acquisition channel (WALK_IN, REFERRAL, ...)
    interested_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    stage VARCHAR(20) NOT NULL DEFAULT 'NEW'
        CHECK (stage IN ('NEW', 'CONTACTED', 'TRIAL', 'NEGOTIATION', 'WON', 'LOST')),
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    lost_reason TEXT,
    next_action_at DATE,
    converted_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_crm_leads_company ON crm_leads(company_id);
CREATE INDEX idx_crm_leads_branch ON crm_leads(branch_id);
CREATE INDEX idx_crm_leads_stage ON crm_leads(stage);
CREATE INDEX idx_crm_leads_owner ON crm_leads(owner_user_id);

CREATE TRIGGER update_crm_leads_updated_at
    BEFORE UPDATE ON crm_leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- CRM activities/tasks (migration 054) — timeline entries on a lead: notes,
-- calls, meetings, and dated follow-up tasks (done_at = completed).
CREATE TABLE crm_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES crm_leads(id) ON DELETE CASCADE,   -- nullable: TASKs can be standalone (migration 055)
    type VARCHAR(20) NOT NULL DEFAULT 'NOTE'
        CHECK (type IN ('NOTE', 'CALL', 'WHATSAPP', 'MEETING', 'TASK', 'TRIAL')),
    subject VARCHAR(300),
    body TEXT,
    due_at TIMESTAMP WITH TIME ZONE,
    done_at TIMESTAMP WITH TIME ZONE,
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Tasks are assignable to an employee (mobile app future) — migration 055.
    assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_crm_act_lead ON crm_activities(lead_id);
CREATE INDEX idx_crm_act_company ON crm_activities(company_id);
CREATE INDEX idx_crm_act_owner ON crm_activities(owner_user_id);
CREATE INDEX idx_crm_act_due ON crm_activities(due_at);
CREATE INDEX idx_crm_act_assignee ON crm_activities(assigned_employee_id);

-- CRM call log (migration 056) — one row per reach/call attempt to a lead, with
-- the response and the obstacle to joining. Powers the reach count & call history.
CREATE TABLE crm_lead_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    response VARCHAR(24) NOT NULL DEFAULT 'NO_ANSWER',   -- NO_ANSWER/ANSWERED/INTERESTED/...
    obstacle VARCHAR(24),                                -- PRICE/SCHEDULE/DISTANCE/... (null = none)
    notes TEXT,
    called_by UUID REFERENCES users(id) ON DELETE SET NULL,
    called_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_crm_calls_lead ON crm_lead_calls(lead_id);
CREATE INDEX idx_crm_calls_company ON crm_lead_calls(company_id);

-- =============================================
-- WHATSAPP CLOUD API (migration 057) — per-tenant number, settings, templates,
-- two-way inbox. wa_* to avoid colliding with click-to-chat whatsapp_templates.
-- Tokens live in AWS Secrets Manager, NOT here.
-- =============================================
CREATE TABLE wa_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    waba_id VARCHAR(64), phone_number_id VARCHAR(64) UNIQUE, display_phone_number VARCHAR(32),
    verified_name VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'NOT_CONNECTED'
        CHECK (status IN ('NOT_CONNECTED', 'CONNECTING', 'ACTIVE', 'ERROR')),
    quality_rating VARCHAR(16), connected_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE wa_settings (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    auto_send_on_checkin BOOLEAN NOT NULL DEFAULT false,
    auto_send_on_absence BOOLEAN NOT NULL DEFAULT false,
    absence_warning_threshold INTEGER NOT NULL DEFAULT 3,
    auto_send_absence_warning BOOLEAN NOT NULL DEFAULT false,
    crm_auto_outreach BOOLEAN NOT NULL DEFAULT false,
    crm_auto_drip BOOLEAN NOT NULL DEFAULT false,
    crm_stop_on_reply BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE wa_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    key VARCHAR(40) NOT NULL, meta_template_name VARCHAR(120),
    category VARCHAR(16) NOT NULL DEFAULT 'UTILITY', language VARCHAR(10) NOT NULL DEFAULT 'ar',
    body TEXT NOT NULL DEFAULT '', is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, key)
);
CREATE TABLE wa_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_phone VARCHAR(32) NOT NULL, contact_name VARCHAR(200),
    student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    last_message_at TIMESTAMP WITH TIME ZONE, last_inbound_at TIMESTAMP WITH TIME ZONE,
    unread_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, contact_phone)
);
CREATE INDEX idx_wa_conv_company ON wa_conversations(company_id, last_message_at DESC);
CREATE TABLE wa_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
    direction VARCHAR(4) NOT NULL CHECK (direction IN ('OUT', 'IN')),
    type VARCHAR(20) NOT NULL DEFAULT 'text', template_key VARCHAR(40), body TEXT,
    meta_message_id VARCHAR(120), status VARCHAR(16), error_message TEXT,
    student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_wa_msg_conversation ON wa_messages(conversation_id, created_at);
CREATE INDEX idx_wa_msg_meta ON wa_messages(meta_message_id);

CREATE TRIGGER update_crm_activities_updated_at
    BEFORE UPDATE ON crm_activities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions (adjust as needed for your specific AWS RDS setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO automative_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO automative_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO automative_user;
