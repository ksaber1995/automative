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
    code VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'Egypt',
    tax_id VARCHAR(100),
    registration_number VARCHAR(100),
    industry VARCHAR(100),
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

CREATE INDEX idx_companies_code ON companies(code);
CREATE INDEX idx_companies_email ON companies(email);
CREATE INDEX idx_companies_subscription_status ON companies(subscription_status);

-- =============================================
-- SUBSCRIPTIONS TABLE
-- One row per company tracking their billing state (distinct from the legacy
-- subscription fields on companies, which are retained for backward compat).
-- =============================================
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'TRIAL' CHECK (status IN ('TRIAL', 'MONTHLY', 'ANNUAL', 'EXPIRED')),
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
    -- Granular per-resource permissions JSON (migration 006).
    granular_permissions JSONB,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID,
    -- Email verification (migration 010).
    email_verified BOOLEAN DEFAULT false,
    email_verification_token VARCHAR(255),
    email_verification_expires TIMESTAMP WITH TIME ZONE,
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_branch_id ON users(branch_id);
CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_users_role ON users(role);

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

CREATE UNIQUE INDEX branches_company_id_code_key ON branches(company_id, code);
CREATE INDEX idx_branches_manager_id ON branches(manager_id);

-- Add foreign key constraint to users table
ALTER TABLE users ADD CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

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
    code VARCHAR(50) NOT NULL,
    description TEXT,
    default_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    default_duration INTEGER NOT NULL DEFAULT 8,
    default_max_students INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (branch_id, code)
);

CREATE INDEX idx_master_courses_company ON master_courses(company_id);
CREATE INDEX idx_master_courses_branch ON master_courses(branch_id);

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

CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    duration INTEGER NOT NULL,
    max_students INTEGER,
    instructor_id UUID,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES employees(id) ON DELETE SET NULL,
    UNIQUE(branch_id, code)
);

CREATE INDEX idx_courses_branch_id ON courses(branch_id);
CREATE INDEX idx_courses_code ON courses(code);

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
    branch_id UUID NOT NULL,
    instructor_id UUID,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    days_of_week VARCHAR(50),
    max_students INTEGER,
    current_enrollment INTEGER DEFAULT 0,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES employees(id) ON DELETE SET NULL,
    UNIQUE(branch_id, code)
);

CREATE INDEX idx_classes_course_id ON classes(course_id);
CREATE INDEX idx_classes_branch_id ON classes(branch_id);
CREATE INDEX idx_classes_instructor_id ON classes(instructor_id);

-- =============================================
-- STUDENTS TABLE
-- =============================================
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    email VARCHAR(255),
    phone VARCHAR(50),
    parent_name VARCHAR(200),
    parent_phone VARCHAR(50),
    parent_email VARCHAR(255),
    address TEXT,
    branch_id UUID NOT NULL,
    is_active BOOLEAN DEFAULT true,
    enrollment_date DATE NOT NULL,
    churn_date DATE,
    churn_reason TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE INDEX idx_students_branch_id ON students(branch_id);
CREATE INDEX idx_students_enrollment_date ON students(enrollment_date);
CREATE INDEX idx_students_churn_date ON students(churn_date);
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
    status VARCHAR(50) NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'DROPPED', 'PENDING')),
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
    code VARCHAR(50),
    event_type VARCHAR(32) NOT NULL DEFAULT 'OTHER',
    description TEXT,
    location VARCHAR(255),
    start_date DATE,
    end_date DATE,
    status VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

CREATE INDEX idx_events_company ON events(company_id);
CREATE INDEX idx_events_branch ON events(branch_id);

-- =============================================
-- REFUNDS TABLE
-- =============================================
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID,
    master_enrollment_id UUID,
    company_id UUID NOT NULL,
    student_id UUID NOT NULL,
    event_id UUID,
    amount DECIMAL(10, 2) NOT NULL,
    refund_date DATE NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('FULL', 'PARTIAL')),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE,
    FOREIGN KEY (master_enrollment_id) REFERENCES master_enrollments(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
    CHECK (
        (enrollment_id IS NOT NULL AND master_enrollment_id IS NULL) OR
        (enrollment_id IS NULL AND master_enrollment_id IS NOT NULL)
    )
);

CREATE INDEX idx_refunds_enrollment_id ON refunds(enrollment_id);
CREATE INDEX idx_refunds_master_enrollment_id ON refunds(master_enrollment_id);
CREATE INDEX idx_refunds_company_id ON refunds(company_id);
CREATE INDEX idx_refunds_student_id ON refunds(student_id);
CREATE INDEX idx_refunds_event ON refunds(event_id);

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
    hire_date DATE,
    notes TEXT,
    branch_id UUID,
    is_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

CREATE INDEX idx_employees_branch_id ON employees(branch_id);
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
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_type ON expenses(type);
CREATE INDEX idx_expenses_category ON expenses(category);
CREATE INDEX idx_expenses_event ON expenses(event_id);

-- =============================================
-- CASH STATE TABLE
-- =============================================
CREATE TABLE cash_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    current_balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID,
    notes TEXT,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Initialize cash state with a single row
INSERT INTO cash_state (current_balance) VALUES (0);

-- =============================================
-- WITHDRAWALS TABLE
-- =============================================
CREATE TABLE withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID,
    amount DECIMAL(10, 2) NOT NULL,
    withdrawal_date DATE NOT NULL,
    reason TEXT,
    category VARCHAR(50) DEFAULT 'OTHER',
    payment_method VARCHAR(50) DEFAULT 'CASH',
    stakeholders JSONB DEFAULT '[]',
    notes TEXT,
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
CREATE INDEX idx_withdrawals_date ON withdrawals(date);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);


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
    event_id UUID,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
    UNIQUE(branch_id, code)
);

CREATE INDEX idx_products_branch_id ON products(branch_id);
CREATE INDEX idx_products_code ON products(code);
CREATE INDEX idx_products_event ON products(event_id);

-- =============================================
-- PRODUCT SALES TABLE
-- =============================================
CREATE TABLE product_sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    discount_type VARCHAR(50) DEFAULT 'NONE',
    discount_value DECIMAL(10, 2) DEFAULT 0,
    discount_amount DECIMAL(10, 2) DEFAULT 0,
    subtotal DECIMAL(10, 2),
    total_amount DECIMAL(10, 2) NOT NULL,
    sale_date DATE NOT NULL,
    payment_method VARCHAR(50),
    receipt_number VARCHAR(100),
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    notes TEXT,
    event_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE INDEX idx_product_sales_product_id ON product_sales(product_id);
CREATE INDEX idx_product_sales_branch_id ON product_sales(branch_id);
CREATE INDEX idx_product_sales_sale_date ON product_sales(sale_date);
CREATE INDEX idx_product_sales_event ON product_sales(event_id);

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
    COUNT(DISTINCT CASE WHEN s.churn_date IS NOT NULL THEN s.id END) as churned_students
FROM branches b
LEFT JOIN students s ON b.id = s.branch_id
GROUP BY b.id, b.name;

-- Grant permissions (adjust as needed for your specific AWS RDS setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO automative_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO automative_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO automative_user;
