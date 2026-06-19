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
    age INTEGER,
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
    default_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    default_duration INTEGER NOT NULL DEFAULT 8,
    default_max_students INTEGER,
    level_id UUID REFERENCES levels(id) ON DELETE SET NULL,
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
    duration INTEGER NOT NULL,
    max_students INTEGER,
    instructor_id UUID,
    level_id UUID REFERENCES levels(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    -- Payment model: ONE_TIME (default, existing behaviour) or MONTHLY_SUBSCRIPTION.
    -- When MONTHLY_SUBSCRIPTION, the existing `price` column holds the monthly fee.
    payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME'
        CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE INDEX idx_courses_branch_id ON courses(branch_id);
CREATE INDEX idx_courses_company_id ON courses(company_id);
CREATE INDEX idx_courses_level_id ON courses(level_id);

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
    name VARCHAR(255) NOT NULL,
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
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(10) CHECK (gender IN ('MALE', 'FEMALE')),
    email VARCHAR(255),
    phone VARCHAR(50),
    parent_name VARCHAR(200),
    parent_phone VARCHAR(50),
    parent_email VARCHAR(255),
    address TEXT,
    branch_id UUID NOT NULL,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    enrollment_date DATE NOT NULL,
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE INDEX idx_students_branch_id ON students(branch_id);
CREATE UNIQUE INDEX idx_students_qr_token ON students(qr_token);
CREATE INDEX idx_students_company_id ON students(company_id);
CREATE INDEX idx_students_enrollment_date ON students(enrollment_date);
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
    -- Denormalised from courses.payment_type for fast monthly-subscription queries
    payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME'
        CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION')),
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
        CHECK (salary_type IN ('MONTHLY', 'SESSION_BASED')),
    session_rate DECIMAL(10, 2),
    hire_date DATE,
    notes TEXT,
    branch_id UUID,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    is_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
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
--                  class's session of the same session_number). home_class_id
--                  points at the enrolled class the attendance substitutes for.
-- "Absent-with-substitution" on the home class is derived: no NORMAL row there
-- + a SUBSTITUTION row for the same (course, session_number).
-- =============================================
CREATE TABLE session_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    attendance_type VARCHAR(16) NOT NULL DEFAULT 'NORMAL'
        CHECK (attendance_type IN ('NORMAL', 'SUBSTITUTION')),
    home_class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, student_id)
);

CREATE INDEX idx_session_attendance_session ON session_attendance(session_id);
CREATE INDEX idx_session_attendance_student ON session_attendance(student_id);
CREATE INDEX idx_session_attendance_home_class ON session_attendance(home_class_id);

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

CREATE INDEX idx_msp_enrollment_id   ON monthly_subscription_payments(enrollment_id);
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
-- COURSE MONTHLY PRICE OVERRIDES TABLE  (migration 042)
-- Allows teachers to override the price of a monthly-subscription course
-- for a specific month. Student amounts scale proportionally.
-- =============================================
CREATE TABLE course_monthly_price_overrides (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id        UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    billing_year     INTEGER NOT NULL,
    billing_month    INTEGER NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
    override_price   DECIMAL(10, 2) NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, billing_year, billing_month)
);

CREATE INDEX idx_cmpo_course_id   ON course_monthly_price_overrides(course_id);
CREATE INDEX idx_cmpo_company_id  ON course_monthly_price_overrides(company_id);

CREATE TRIGGER update_course_monthly_price_overrides_updated_at
    BEFORE UPDATE ON course_monthly_price_overrides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_exams_company   ON exams(company_id);
CREATE INDEX idx_exams_branch    ON exams(branch_id);
CREATE INDEX idx_exams_course    ON exams(course_id);
CREATE INDEX idx_exams_exam_date ON exams(exam_date);

CREATE TABLE exam_results (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id     UUID NOT NULL REFERENCES exams(id)     ON DELETE CASCADE,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    course_id   UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
    student_id  UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
    grade       VARCHAR(50) NOT NULL,
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
-- MESSAGING (WhatsApp via Meta Cloud API)
-- =============================================
CREATE TABLE message_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL
                  CHECK (type IN ('ABSENCE', 'PAYMENT_DELAY', 'ABSENCE_WARNING', 'EXAM_RESULTS')),
    body        TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, type)
);

CREATE INDEX idx_message_templates_company ON message_templates(company_id);

CREATE TABLE message_settings (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id                  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    messaging_status            VARCHAR(20) NOT NULL DEFAULT 'DISABLED'
                                  CHECK (messaging_status IN ('DISABLED', 'PENDING', 'ACTIVE', 'REJECTED', 'REVOKED')),
    absence_warning_threshold   INTEGER NOT NULL DEFAULT 3,
    auto_send_absence           BOOLEAN NOT NULL DEFAULT false,
    auto_send_payment_delay     BOOLEAN NOT NULL DEFAULT false,
    auto_send_absence_warning   BOOLEAN NOT NULL DEFAULT true,
    auto_send_exam_results      BOOLEAN NOT NULL DEFAULT false,
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id)
);

CREATE TABLE message_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type            VARCHAR(30) NOT NULL,
    recipient_phone VARCHAR(50) NOT NULL,
    recipient_name  VARCHAR(200),
    student_id      UUID REFERENCES students(id) ON DELETE SET NULL,
    body            TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
    meta_message_id VARCHAR(100),
    error_message   TEXT,
    sent_at         TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_message_log_company    ON message_log(company_id);
CREATE INDEX idx_message_log_student    ON message_log(student_id);
CREATE INDEX idx_message_log_type       ON message_log(type);
CREATE INDEX idx_message_log_status     ON message_log(status);
CREATE INDEX idx_message_log_created_at ON message_log(created_at);

CREATE TABLE messaging_quota (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    month           VARCHAR(7) NOT NULL,
    messages_sent   INTEGER NOT NULL DEFAULT 0,
    quota_limit     INTEGER NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, month)
);

CREATE TRIGGER update_message_templates_updated_at
    BEFORE UPDATE ON message_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_message_settings_updated_at
    BEFORE UPDATE ON message_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messaging_quota_updated_at
    BEFORE UPDATE ON messaging_quota
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions (adjust as needed for your specific AWS RDS setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO automative_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO automative_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO automative_user;
