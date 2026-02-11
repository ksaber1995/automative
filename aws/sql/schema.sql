-- Automative Database Schema
-- PostgreSQL Database for Automate Magic Application

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- USERS TABLE
-- =============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')),
    branch_id UUID,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_branch_id ON users(branch_id);
CREATE INDEX idx_users_role ON users(role);

-- =============================================
-- BRANCHES TABLE
-- =============================================
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
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

CREATE INDEX idx_branches_code ON branches(code);
CREATE INDEX idx_branches_manager_id ON branches(manager_id);

-- Add foreign key constraint to users table
ALTER TABLE users ADD CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

-- =============================================
-- COURSES TABLE
-- =============================================
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    duration INTEGER NOT NULL,
    max_students INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    UNIQUE(branch_id, code)
);

CREATE INDEX idx_courses_branch_id ON courses(branch_id);
CREATE INDEX idx_courses_code ON courses(code);

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
    payment_status VARCHAR(50) NOT NULL CHECK (payment_status IN ('PENDING', 'PARTIAL', 'PAID', 'REFUNDED')),
    completion_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE INDEX idx_enrollments_student_id ON enrollments(student_id);
CREATE INDEX idx_enrollments_class_id ON enrollments(class_id);
CREATE INDEX idx_enrollments_course_id ON enrollments(course_id);
CREATE INDEX idx_enrollments_branch_id ON enrollments(branch_id);
CREATE INDEX idx_enrollments_status ON enrollments(status);
CREATE INDEX idx_enrollments_payment_status ON enrollments(payment_status);

-- =============================================
-- EMPLOYEES TABLE
-- =============================================
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    position VARCHAR(100),
    salary DECIMAL(10, 2),
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
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
);

CREATE INDEX idx_revenues_branch_id ON revenues(branch_id);
CREATE INDEX idx_revenues_date ON revenues(date);
CREATE INDEX idx_revenues_course_id ON revenues(course_id);
CREATE INDEX idx_revenues_enrollment_id ON revenues(enrollment_id);
CREATE INDEX idx_revenues_student_id ON revenues(student_id);

-- =============================================
-- EXPENSES TABLE
-- =============================================
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID,
    type VARCHAR(50) NOT NULL CHECK (type IN ('FIXED', 'VARIABLE', 'SHARED')),
    category VARCHAR(50) NOT NULL CHECK (category IN ('SALARIES', 'RENT', 'UTILITIES', 'MARKETING', 'SUPPLIES', 'MAINTENANCE', 'OTHER')),
    amount DECIMAL(10, 2) NOT NULL,
    description TEXT,
    date DATE NOT NULL,
    is_recurring BOOLEAN DEFAULT false,
    recurring_day INTEGER,
    distribution_method VARCHAR(50),
    vendor VARCHAR(255),
    invoice_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

CREATE INDEX idx_expenses_branch_id ON expenses(branch_id);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_type ON expenses(type);
CREATE INDEX idx_expenses_category ON expenses(category);

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
    date DATE NOT NULL,
    reason TEXT,
    approved_by UUID,
    status VARCHAR(50) NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_withdrawals_branch_id ON withdrawals(branch_id);
CREATE INDEX idx_withdrawals_date ON withdrawals(date);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);

-- =============================================
-- DEBTS TABLE
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
    status VARCHAR(50) NOT NULL CHECK (status IN ('ACTIVE', 'PAID', 'OVERDUE', 'CANCELLED')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

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
    is_global BOOLEAN DEFAULT false NOT NULL,
    branch_id UUID,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    UNIQUE(branch_id, code),
    CHECK ((is_global = true AND branch_id IS NULL) OR (is_global = false AND branch_id IS NOT NULL))
);

CREATE INDEX idx_products_branch_id ON products(branch_id);
CREATE INDEX idx_products_code ON products(code);

-- =============================================
-- PRODUCT SALES TABLE
-- =============================================
CREATE TABLE product_sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    sale_date DATE NOT NULL,
    payment_method VARCHAR(50),
    customer_name VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE INDEX idx_product_sales_product_id ON product_sales(product_id);
CREATE INDEX idx_product_sales_branch_id ON product_sales(branch_id);
CREATE INDEX idx_product_sales_sale_date ON product_sales(sale_date);

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
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
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
