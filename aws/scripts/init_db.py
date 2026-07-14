import boto3
import time

client = boto3.client('rds-data', region_name='eu-west-1')

CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-dev-automatemagicauroradbef2379-lrkhx80x9ugj'
SECRET_ARN = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/dev/automate-magic/db-credentials-gBYvv0'
DATABASE = 'automative'

statements = [
    "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"",

    # COMPANIES
    """CREATE TABLE IF NOT EXISTS companies (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(50),
        address TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",

    # USERS
    """CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')),
        branch_id UUID,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, email)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
    "CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id)",

    # BRANCHES
    """CREATE TABLE IF NOT EXISTS branches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) NOT NULL,
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(50),
        phone VARCHAR(50),
        email VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        opening_date DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id, code)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_branches_company_id ON branches(company_id)",
    "ALTER TABLE users ADD CONSTRAINT IF NOT EXISTS fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL",

    # EMPLOYEES
    """CREATE TABLE IF NOT EXISTS employees (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        department VARCHAR(100),
        position VARCHAR(100),
        salary DECIMAL(10, 2),
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        is_global BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        hire_date DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_employees_branch_id ON employees(branch_id)",

    # COURSES
    """CREATE TABLE IF NOT EXISTS courses (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        instructor_id UUID REFERENCES employees(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        duration INTEGER NOT NULL,
        max_students INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(branch_id, code)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_courses_company_id ON courses(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_courses_branch_id ON courses(branch_id)",

    # CLASSES
    """CREATE TABLE IF NOT EXISTS classes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        instructor_id UUID REFERENCES employees(id) ON DELETE SET NULL,
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
        UNIQUE(branch_id, code)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_classes_company_id ON classes(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_classes_branch_id ON classes(branch_id)",

    # STUDENTS
    """CREATE TABLE IF NOT EXISTS students (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        date_of_birth DATE,
        email VARCHAR(255),
        phone VARCHAR(50),
        parent_name VARCHAR(200),
        parent_phone VARCHAR(50),
        address TEXT,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        churn_date DATE,
        churn_reason TEXT,
        notes TEXT,
        acquisition_channel VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS idx_students_company_id ON students(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_students_branch_id ON students(branch_id)",

    # ENROLLMENTS
    """CREATE TABLE IF NOT EXISTS enrollments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
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
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS idx_enrollments_company_id ON enrollments(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_enrollments_branch_id ON enrollments(branch_id)",

    # REVENUES
    """CREATE TABLE IF NOT EXISTS revenues (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
        enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL,
        student_id UUID REFERENCES students(id) ON DELETE SET NULL,
        amount DECIMAL(10, 2) NOT NULL,
        description TEXT,
        date DATE NOT NULL,
        payment_method VARCHAR(50) CHECK (payment_method IN ('BANK_TRANSFER', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'CHECK', 'OTHER')),
        receipt_number VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS idx_revenues_company_id ON revenues(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_revenues_branch_id ON revenues(branch_id)",
    "CREATE INDEX IF NOT EXISTS idx_revenues_date ON revenues(date)",

    # PRODUCTS
    """CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
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
        branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS idx_products_company_id ON products(company_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS products_code_branch_unique ON products(company_id, code, branch_id) WHERE branch_id IS NOT NULL AND is_active = true",
    "CREATE UNIQUE INDEX IF NOT EXISTS products_code_global_unique ON products(company_id, code) WHERE is_global = true AND is_active = true",

    # PRODUCT SALES
    """CREATE TABLE IF NOT EXISTS product_sales (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        sale_date DATE NOT NULL,
        payment_method VARCHAR(50),
        customer_name VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS idx_product_sales_company_id ON product_sales(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_sales_product_id ON product_sales(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_sales_sale_date ON product_sales(sale_date)",

    # EXPENSES
    """CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('FIXED', 'VARIABLE', 'SHARED', 'CAPITAL')),
        category VARCHAR(50) NOT NULL CHECK (category IN ('SALARIES','RENT','UTILITIES','ELECTRICITY','INTERNET','WATER','MARKETING','SUPPLIES','EQUIPMENT','MAINTENANCE','INSURANCE','SOFTWARE','ADMINISTRATION','COGS','INVENTORY','OTHER')),
        amount DECIMAL(10, 2) NOT NULL,
        description TEXT,
        date DATE NOT NULL,
        is_recurring BOOLEAN DEFAULT false,
        recurring_day INTEGER,
        recurring_template_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
        employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
        distribution_method VARCHAR(50),
        vendor VARCHAR(255),
        invoice_number VARCHAR(100),
        notes TEXT,
        asset_name VARCHAR(255),
        amortization_months INTEGER,
        product_sale_id UUID REFERENCES product_sales(id) ON DELETE SET NULL,
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS idx_expenses_company_id ON expenses(company_id)",
    "CREATE INDEX IF NOT EXISTS idx_expenses_branch_id ON expenses(branch_id)",
    "CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)",
    "CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category)",

    # CASH STATE
    """CREATE TABLE IF NOT EXISTS cash_state (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
        current_balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        notes TEXT
    )""",

    # WITHDRAWALS
    """CREATE TABLE IF NOT EXISTS withdrawals (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        amount DECIMAL(10, 2) NOT NULL,
        date DATE NOT NULL,
        reason TEXT,
        approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(50) NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS idx_withdrawals_company_id ON withdrawals(company_id)",

    # DEBTS
    """CREATE TABLE IF NOT EXISTS debts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        creditor_name VARCHAR(255) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        remaining_amount DECIMAL(10, 2) NOT NULL,
        description TEXT,
        date DATE NOT NULL,
        due_date DATE,
        status VARCHAR(50) NOT NULL CHECK (status IN ('ACTIVE', 'PAID', 'OVERDUE', 'CANCELLED')),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS idx_debts_company_id ON debts(company_id)",

    # DEBT PAYMENTS
    """CREATE TABLE IF NOT EXISTS debt_payments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        debt_id UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
        amount DECIMAL(10, 2) NOT NULL,
        payment_date DATE NOT NULL,
        payment_method VARCHAR(50),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )""",

    # TRIGGERS
    """CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $$ language 'plpgsql'""",

    "DROP TRIGGER IF EXISTS update_companies_updated_at ON companies",
    "CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_users_updated_at ON users",
    "CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_branches_updated_at ON branches",
    "CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_employees_updated_at ON employees",
    "CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_courses_updated_at ON courses",
    "CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_classes_updated_at ON classes",
    "CREATE TRIGGER update_classes_updated_at BEFORE UPDATE ON classes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_students_updated_at ON students",
    "CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_enrollments_updated_at ON enrollments",
    "CREATE TRIGGER update_enrollments_updated_at BEFORE UPDATE ON enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_revenues_updated_at ON revenues",
    "CREATE TRIGGER update_revenues_updated_at BEFORE UPDATE ON revenues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_expenses_updated_at ON expenses",
    "CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_withdrawals_updated_at ON withdrawals",
    "CREATE TRIGGER update_withdrawals_updated_at BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_debts_updated_at ON debts",
    "CREATE TRIGGER update_debts_updated_at BEFORE UPDATE ON debts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
    "DROP TRIGGER IF EXISTS update_products_updated_at ON products",
    "CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
]

def run(sql):
    try:
        result = client.execute_statement(
            resourceArn=CLUSTER_ARN,
            secretArn=SECRET_ARN,
            database=DATABASE,
            sql=sql.strip()
        )
        print(f'  OK: {sql.strip()[:80]}')
    except Exception as e:
        print(f'  ERR: {sql.strip()[:80]}')
        print(f'       {e}')

print('Running schema migration...')
for stmt in statements:
    run(stmt)
    time.sleep(0.1)

print('\nDone!')
