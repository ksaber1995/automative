import { query } from '../db/connection';

async function runInstructorMigration() {
  console.log('Starting migration: add_instructor_to_courses');

  try {
    // Check if column already exists
    const checkResult = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'courses' AND column_name = 'instructor_id';
    `);

    if (checkResult.length > 0) {
      console.log('✅ Migration already applied - instructor_id column exists');
      return { success: true, message: 'Migration already applied - instructor_id column already exists' };
    }

    // Run the migration
    console.log('Adding instructor_id column to courses table...');

    await query(`
      ALTER TABLE courses
      ADD COLUMN instructor_id UUID;
    `);

    await query(`
      ALTER TABLE courses
      ADD CONSTRAINT fk_courses_instructor
      FOREIGN KEY (instructor_id) REFERENCES employees(id) ON DELETE SET NULL;
    `);

    await query(`
      CREATE INDEX idx_courses_instructor_id ON courses(instructor_id);
    `);

    await query(`
      COMMENT ON COLUMN courses.instructor_id IS 'Reference to the employee (instructor) teaching this course';
    `);

    console.log('✅ Migration completed successfully!');

    // Verify
    const verifyResult = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'courses' AND column_name = 'instructor_id';
    `);

    console.log('Verification:', verifyResult);

    return {
      success: true,
      message: 'Migration completed successfully! instructor_id column added to courses table',
      verification: verifyResult
    };
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
}

async function runClassesInstructorMigration() {
  console.log('Starting migration: add_instructor_to_classes');

  try {
    // Check if column already exists
    const checkResult = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'classes' AND column_name = 'instructor_id';
    `);

    if (checkResult.length > 0) {
      console.log('✅ Migration already applied - instructor_id column exists in classes table');
      return { success: true, message: 'Migration already applied - instructor_id column already exists in classes table' };
    }

    // Run the migration
    console.log('Adding instructor_id column to classes table...');

    await query(`
      ALTER TABLE classes
      ADD COLUMN instructor_id UUID;
    `);

    await query(`
      ALTER TABLE classes
      ADD CONSTRAINT fk_classes_instructor
      FOREIGN KEY (instructor_id) REFERENCES employees(id) ON DELETE SET NULL;
    `);

    await query(`
      CREATE INDEX idx_classes_instructor_id ON classes(instructor_id);
    `);

    await query(`
      COMMENT ON COLUMN classes.instructor_id IS 'Reference to the employee (instructor) teaching this class';
    `);

    console.log('✅ Migration completed successfully!');

    // Verify
    const verifyResult = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'classes' AND column_name = 'instructor_id';
    `);

    console.log('Verification:', verifyResult);

    return {
      success: true,
      message: 'Migration completed successfully! instructor_id column added to classes table',
      verification: verifyResult
    };
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
}

async function updateClassesTableStructure() {
  console.log('Starting migration: update_classes_table_structure');

  try {
    // Check if name column already exists
    const checkResult = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'classes' AND column_name = 'name';
    `);

    if (checkResult.length > 0) {
      console.log('✅ Migration already applied - classes table structure is up to date');
      return { success: true, message: 'Migration already applied - classes table structure is up to date' };
    }

    console.log('Adding missing columns to classes table...');

    // Add all missing columns
    await query(`
      ALTER TABLE classes
      ADD COLUMN IF NOT EXISTS name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS start_date DATE,
      ADD COLUMN IF NOT EXISTS end_date DATE,
      ADD COLUMN IF NOT EXISTS start_time TIME,
      ADD COLUMN IF NOT EXISTS end_time TIME,
      ADD COLUMN IF NOT EXISTS days_of_week VARCHAR(50),
      ADD COLUMN IF NOT EXISTS current_enrollment INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    // Set default values for existing rows
    await query(`
      UPDATE classes
      SET name = 'Class ' || SUBSTRING(id::text FROM 1 FOR 8)
      WHERE name IS NULL;
    `);

    // Make columns NOT NULL
    await query(`ALTER TABLE classes ALTER COLUMN name SET NOT NULL;`);

    console.log('✅ Migration completed successfully!');

    // Verify
    const verifyResult = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'classes'
      AND column_name IN ('name', 'start_date', 'end_date', 'start_time', 'end_time', 'days_of_week', 'current_enrollment', 'notes')
      ORDER BY column_name;
    `);

    return {
      success: true,
      message: 'Classes table structure updated successfully! All columns added.',
      addedColumns: verifyResult.map((r: any) => r.column_name)
    };
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
}

async function updateProductsTableStructure() {
  console.log('Starting migration: update_products_table_structure');

  try {
    // Check current table structure
    const currentColumns = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'products'
      ORDER BY ordinal_position;
    `);

    const currentColumnNames = currentColumns.map((c: any) => c.column_name);
    console.log('Current columns:', currentColumnNames);

    // Check if migration is needed
    if (currentColumnNames.includes('stock') &&
        currentColumnNames.includes('category') &&
        currentColumnNames.includes('unit')) {
      console.log('✅ Migration already applied - products table structure is up to date');
      return {
        success: true,
        message: 'Migration already applied - products table structure is up to date',
        currentColumns: currentColumnNames
      };
    }

    console.log('🔄 Updating products table structure...');

    // Step 1: Add new columns if they don't exist
    if (!currentColumnNames.includes('category')) {
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(50);`);
      console.log('✓ Added category column');
    }

    if (!currentColumnNames.includes('unit')) {
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS unit VARCHAR(50);`);
      console.log('✓ Added unit column');
    }

    if (!currentColumnNames.includes('is_global')) {
      await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT false;`);
      console.log('✓ Added is_global column');
    }

    // Step 2: Rename columns if they exist with old names
    if (currentColumnNames.includes('price') && !currentColumnNames.includes('selling_price')) {
      await query(`ALTER TABLE products RENAME COLUMN price TO selling_price;`);
      console.log('✓ Renamed price to selling_price');
    }

    if (currentColumnNames.includes('cost') && !currentColumnNames.includes('cost_price')) {
      await query(`ALTER TABLE products RENAME COLUMN cost TO cost_price;`);
      console.log('✓ Renamed cost to cost_price');
    }

    if (currentColumnNames.includes('stock_quantity') && !currentColumnNames.includes('stock')) {
      await query(`ALTER TABLE products RENAME COLUMN stock_quantity TO stock;`);
      console.log('✓ Renamed stock_quantity to stock');
    }

    if (currentColumnNames.includes('min_stock_level') && !currentColumnNames.includes('min_stock')) {
      await query(`ALTER TABLE products RENAME COLUMN min_stock_level TO min_stock;`);
      console.log('✓ Renamed min_stock_level to min_stock');
    }

    // Step 3: Update existing data with default values
    await query(`UPDATE products SET category = 'OTHER' WHERE category IS NULL;`);
    await query(`UPDATE products SET unit = 'piece' WHERE unit IS NULL;`);
    await query(`UPDATE products SET is_global = false WHERE is_global IS NULL;`);
    console.log('✓ Updated NULL values with defaults');

    // Step 4: Set NOT NULL constraints and defaults
    await query(`ALTER TABLE products ALTER COLUMN category SET NOT NULL;`);
    await query(`ALTER TABLE products ALTER COLUMN unit SET NOT NULL;`);
    await query(`ALTER TABLE products ALTER COLUMN stock SET NOT NULL;`);
    await query(`ALTER TABLE products ALTER COLUMN stock SET DEFAULT 0;`);
    await query(`ALTER TABLE products ALTER COLUMN min_stock SET NOT NULL;`);
    await query(`ALTER TABLE products ALTER COLUMN min_stock SET DEFAULT 0;`);
    await query(`ALTER TABLE products ALTER COLUMN is_global SET NOT NULL;`);
    await query(`ALTER TABLE products ALTER COLUMN is_global SET DEFAULT false;`);
    console.log('✓ Applied NOT NULL constraints and defaults');

    // Step 5: Make branch_id nullable (for global products)
    await query(`ALTER TABLE products ALTER COLUMN branch_id DROP NOT NULL;`);
    console.log('✓ Made branch_id nullable for global products');

    // Step 6: Add CHECK constraint for global products if it doesn't exist
    try {
      await query(`
        ALTER TABLE products ADD CONSTRAINT check_global_products
        CHECK ((is_global = true AND branch_id IS NULL) OR (is_global = false AND branch_id IS NOT NULL));
      `);
      console.log('✓ Added CHECK constraint for global products');
    } catch (error) {
      // Constraint might already exist
      console.log('⚠ CHECK constraint might already exist, skipping');
    }

    console.log('✅ Products table migration completed successfully!');

    // Verify
    const verifyResult = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'products'
      ORDER BY ordinal_position;
    `);

    return {
      success: true,
      message: 'Products table structure updated successfully!',
      updatedColumns: verifyResult.map((r: any) => ({
        name: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable
      }))
    };
  } catch (error) {
    console.error('❌ Products migration error:', error);
    throw error;
  }
}

async function runRbacMigration() {
  console.log('Starting migration: rbac_system');

  try {
    // ── 1. Add linked_employee_id to users ─────────────────────────────────
    const linkedEmployeeCheck = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'linked_employee_id';
    `);

    if (linkedEmployeeCheck.length === 0) {
      await query(`
        ALTER TABLE users
        ADD COLUMN linked_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;
      `);
      await query(`CREATE INDEX IF NOT EXISTS idx_users_linked_employee_id ON users(linked_employee_id);`);
      console.log('✓ Added linked_employee_id to users');
    } else {
      console.log('⚠ linked_employee_id already exists');
    }

    // ── 2. Add permissions JSONB to users ──────────────────────────────────
    const permissionsCheck = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'permissions';
    `);

    if (permissionsCheck.length === 0) {
      await query(`
        ALTER TABLE users
        ADD COLUMN permissions JSONB DEFAULT NULL;
      `);
      console.log('✓ Added permissions JSONB to users');
    } else {
      console.log('⚠ permissions column already exists');
    }

    // ── 3. Drop old role CHECK constraint and add new one ─────────────────
    // First, find the constraint name
    const constraints = await query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'users'
        AND constraint_type = 'CHECK'
        AND constraint_name LIKE '%role%';
    `);

    for (const c of constraints) {
      try {
        await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS "${c.constraint_name}";`);
        console.log(`✓ Dropped old role constraint: ${c.constraint_name}`);
      } catch (_) {
        // ignore
      }
    }

    // Also try the standard generated name
    try {
      await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
    } catch (_) {}

    // Add new role CHECK constraint
    const newRoles = [
      'GLOBAL_ADMIN', 'BRANCH_ADMIN', 'ACADEMIC_MANAGER', 'SALES_MANAGER', 'VIEWER',
      'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT'
    ];
    const roleList = newRoles.map(r => `'${r}'`).join(', ');

    try {
      await query(`
        ALTER TABLE users
        ADD CONSTRAINT users_role_check CHECK (role IN (${roleList}));
      `);
      console.log('✓ Added new role CHECK constraint');
    } catch (err: any) {
      if (err?.message?.includes('already exists')) {
        console.log('⚠ Role constraint already updated');
      } else {
        throw err;
      }
    }

    // ── 4. Create user_branches junction table ─────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS user_branches (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, branch_id)
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_user_branches_user_id ON user_branches(user_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_user_branches_branch_id ON user_branches(branch_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_user_branches_company_id ON user_branches(company_id);`);
    console.log('✓ Created user_branches junction table');

    // ── 5. Migrate existing ADMIN → GLOBAL_ADMIN ───────────────────────────
    const migrated = await query(`
      UPDATE users SET role = 'GLOBAL_ADMIN' WHERE role = 'ADMIN'
      RETURNING id;
    `);
    console.log(`✓ Migrated ${migrated.length} ADMIN users → GLOBAL_ADMIN`);

    // ── 6. Backfill user_branches for existing non-global-admin users ──────
    await query(`
      INSERT INTO user_branches (user_id, branch_id, company_id)
      SELECT u.id, u.branch_id, u.company_id
      FROM users u
      WHERE u.branch_id IS NOT NULL
        AND u.role NOT IN ('GLOBAL_ADMIN', 'ADMIN')
      ON CONFLICT (user_id, branch_id) DO NOTHING;
    `);
    console.log('✓ Backfilled user_branches for existing branch-scoped users');

    console.log('✅ RBAC migration completed successfully!');

    return {
      success: true,
      message: 'RBAC migration completed — users table updated, user_branches table created, ADMIN users migrated to GLOBAL_ADMIN',
    };
  } catch (error) {
    console.error('❌ RBAC migration error:', error);
    throw error;
  }
}

async function createMasterClassEnrollments() {
  console.log('Starting migration: create_master_class_enrollments');

  try {
    const tableExists = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'master_class_enrollments'
    `);

    if (tableExists.length === 0) {
      await query(`
        CREATE TABLE master_class_enrollments (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          master_enrollment_id UUID NOT NULL REFERENCES master_enrollments(id) ON DELETE CASCADE,
          student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
          course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          enrolled_at DATE NOT NULL DEFAULT CURRENT_DATE,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
            CHECK (status IN ('ACTIVE', 'COMPLETED', 'DROPPED')),
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await query(`CREATE INDEX idx_mce_master_enrollment ON master_class_enrollments(master_enrollment_id)`);
      await query(`CREATE INDEX idx_mce_student ON master_class_enrollments(student_id)`);
      await query(`CREATE INDEX idx_mce_class ON master_class_enrollments(class_id)`);
      await query(`CREATE INDEX idx_mce_company ON master_class_enrollments(company_id)`);
      console.log('✓ Created master_class_enrollments table');
    } else {
      console.log('⚠ master_class_enrollments table already exists');
    }

    // Migrate existing bundle enrollments from enrollments table
    const migrated = await query(`
      INSERT INTO master_class_enrollments
        (company_id, master_enrollment_id, student_id, class_id, course_id, branch_id, enrolled_at, status, notes)
      SELECT company_id, master_enrollment_id, student_id, class_id, course_id, branch_id,
             enrollment_date, status, notes
      FROM enrollments
      WHERE master_enrollment_id IS NOT NULL
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    console.log(`✓ Migrated ${migrated.length} bundle enrollments to master_class_enrollments`);

    // Remove those rows from enrollments
    const deleted = await query(`
      DELETE FROM enrollments WHERE master_enrollment_id IS NOT NULL RETURNING id
    `);
    console.log(`✓ Deleted ${deleted.length} rows from enrollments (now in master_class_enrollments)`);

    // Drop master_enrollment_id column from enrollments if it exists
    const colExists = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'enrollments' AND column_name = 'master_enrollment_id'
    `);
    if (colExists.length > 0) {
      await query(`ALTER TABLE enrollments DROP COLUMN IF EXISTS master_enrollment_id`);
      console.log('✓ Dropped master_enrollment_id column from enrollments');
    }

    console.log('✅ master_class_enrollments migration completed!');
    return {
      success: true,
      message: `Migration done: table created, ${migrated.length} records migrated, ${deleted.length} old rows removed`,
    };
  } catch (error) {
    console.error('❌ master_class_enrollments migration error:', error);
    throw error;
  }
}

async function createExpensePaymentsTable() {
  console.log('Starting migration: create_expense_payments_table');

  try {
    const tableExists = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'expense_payments'
    `);

    if (tableExists.length > 0) {
      console.log('✅ expense_payments table already exists');
      return { success: true, message: 'expense_payments table already exists' };
    }

    console.log('Creating expense_payments table...');

    await query(`
      CREATE TABLE expense_payments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
        event_id UUID REFERENCES events(id) ON DELETE SET NULL,
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
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created expense_payments table');

    await query(`CREATE INDEX idx_expense_payments_company_id ON expense_payments(company_id)`);
    await query(`CREATE INDEX idx_expense_payments_expense_id ON expense_payments(expense_id)`);
    await query(`CREATE INDEX idx_expense_payments_date ON expense_payments(date)`);
    await query(`CREATE INDEX idx_expense_payments_employee_id ON expense_payments(employee_id)`);
    await query(`CREATE INDEX idx_expense_payments_category ON expense_payments(category)`);
    await query(`CREATE INDEX idx_expense_payments_branch_id ON expense_payments(branch_id)`);
    console.log('✓ Created indexes');

    // Migrate existing non-template expense records to expense_payments
    const migrated = await query(`
      INSERT INTO expense_payments (
        company_id, expense_id, branch_id, employee_id, event_id,
        type, category, amount, date, notes, vendor, invoice_number,
        bonus_amount, discount_amount, adjustment_reason,
        created_at, updated_at
      )
      SELECT
        e.company_id,
        CASE WHEN e.recurring_template_id IS NOT NULL THEN e.recurring_template_id ELSE e.id END AS expense_id,
        e.branch_id,
        e.employee_id,
        e.event_id,
        e.type,
        e.category,
        e.amount,
        e.date,
        e.notes,
        e.vendor,
        e.invoice_number,
        COALESCE(e.bonus_amount, 0),
        COALESCE(e.discount_amount, 0),
        e.adjustment_reason,
        e.created_at,
        e.updated_at
      FROM expenses e
      WHERE e.is_recurring = false
      RETURNING id
    `);
    console.log(`✓ Migrated ${migrated.length} historical expense records to expense_payments`);

    console.log('✅ expense_payments migration completed!');
    return {
      success: true,
      message: `expense_payments table created and ${migrated.length} historical records migrated`,
      migratedCount: migrated.length,
    };
  } catch (error) {
    console.error('❌ expense_payments migration error:', error);
    throw error;
  }
}

async function createInstallmentTables() {
  console.log('Starting migration: create_installment_tables');

  try {
    const plansExists = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'installment_plans'
    `);
    const scheduleExists = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'installment_schedule'
    `);

    if (plansExists.length > 0 && scheduleExists.length > 0) {
      console.log('✅ installment_plans and installment_schedule tables already exist');
      return { success: true, message: 'installment tables already exist' };
    }

    if (plansExists.length === 0) {
      await query(`
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
        )
      `);
      await query(`CREATE INDEX idx_installment_plans_company_id ON installment_plans(company_id)`);
      await query(`CREATE INDEX idx_installment_plans_branch_id ON installment_plans(branch_id)`);
      await query(`CREATE INDEX idx_installment_plans_status ON installment_plans(status)`);
      await query(`CREATE INDEX idx_installment_plans_start_date ON installment_plans(start_date)`);
      console.log('✓ Created installment_plans table');
    }

    if (scheduleExists.length === 0) {
      await query(`
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
        )
      `);
      await query(`CREATE INDEX idx_installment_schedule_plan_id ON installment_schedule(plan_id)`);
      await query(`CREATE INDEX idx_installment_schedule_company_id ON installment_schedule(company_id)`);
      await query(`CREATE INDEX idx_installment_schedule_status ON installment_schedule(status)`);
      await query(`CREATE INDEX idx_installment_schedule_due_date ON installment_schedule(due_date)`);
      console.log('✓ Created installment_schedule table');
    }

    console.log('✅ installment tables migration completed!');
    return { success: true, message: 'installment_plans and installment_schedule created successfully' };
  } catch (error) {
    console.error('❌ installment tables migration error:', error);
    throw error;
  }
}

async function createSessionAttendanceTable() {
  console.log('Starting migration: create_session_attendance_table');

  try {
    const tableExists = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'session_attendance'
    `);

    if (tableExists.length > 0) {
      console.log('✅ session_attendance table already exists');
      return { success: true, message: 'session_attendance table already exists' };
    }

    await query(`
      CREATE TABLE session_attendance (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, student_id)
      )
    `);
    console.log('✓ Created session_attendance table');

    await query(`CREATE INDEX idx_session_attendance_session ON session_attendance(session_id)`);
    await query(`CREATE INDEX idx_session_attendance_student ON session_attendance(student_id)`);
    console.log('✓ Created indexes');

    console.log('✅ session_attendance migration completed!');
    return { success: true, message: 'session_attendance table created successfully' };
  } catch (error) {
    console.error('❌ session_attendance migration error:', error);
    throw error;
  }
}

async function createEventFeatureMigration() {
  console.log('Starting migration: event_subscriptions + relax refunds');
  try {
    // 1) event_subscriptions table
    const subsExists = await query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'event_subscriptions'
    `);
    if (subsExists.length === 0) {
      await query(`
        CREATE TABLE event_subscriptions (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
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
        )
      `);
      await query(`CREATE INDEX idx_event_subs_company ON event_subscriptions(company_id)`);
      await query(`CREATE INDEX idx_event_subs_event ON event_subscriptions(event_id)`);
      await query(`CREATE INDEX idx_event_subs_branch ON event_subscriptions(branch_id)`);
      await query(`CREATE INDEX idx_event_subs_student ON event_subscriptions(student_id)`);
      console.log('✓ Created event_subscriptions table');
    } else {
      console.log('✓ event_subscriptions table already exists');
    }

    // 2) Drop the refunds CHECK that requires enrollment_id XOR master_enrollment_id
    //    (event-only refunds need both to be NULL)
    const constraintRows = await query(`
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'refunds' AND con.contype = 'c'
    `);
    for (const c of constraintRows) {
      // Drop any check constraints on refunds; we re-add the bare minimum below.
      await query(`ALTER TABLE refunds DROP CONSTRAINT IF EXISTS ${c.conname}`);
    }
    console.log(`✓ Dropped ${constraintRows.length} CHECK constraint(s) on refunds`);

    // 3) Make refunds.student_id nullable so event-only refunds can omit it.
    await query(`ALTER TABLE refunds ALTER COLUMN student_id DROP NOT NULL`);
    console.log('✓ refunds.student_id is now nullable');

    // Re-add type CHECK (we dropped all CHECKs above; type values are still fixed).
    await query(`
      ALTER TABLE refunds
      ADD CONSTRAINT refunds_type_check CHECK (type IN ('FULL', 'PARTIAL'))
    `);
    console.log('✓ Re-added refunds_type_check');

    return { success: true, message: 'event subscriptions + refunds constraints applied' };
  } catch (error) {
    console.error('❌ Event feature migration error:', error);
    throw error;
  }
}

async function addRefundSubscriptionLink() {
  console.log('Starting migration: add subscription_id to refunds (CASCADE)');

  // 1) Add the column if missing. When fresh, default to CASCADE.
  await query(`
    ALTER TABLE refunds
      ADD COLUMN IF NOT EXISTS subscription_id UUID
        REFERENCES event_subscriptions(id) ON DELETE CASCADE
  `);

  // 2) Earlier installs created this FK with ON DELETE SET NULL. Detect and
  //    upgrade to CASCADE so deleting a subscription wipes its refunds.
  const existing = await query<{ conname: string; deltype: string }>(`
    SELECT con.conname, con.confdeltype AS deltype
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'refunds'
      AND con.contype = 'f'
      AND con.conkey @> ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = rel.oid AND attname = 'subscription_id'
      )]::smallint[]
  `);
  for (const c of existing) {
    if (c.deltype !== 'c') {
      console.log(`Upgrading ${c.conname} from delete_rule=${c.deltype} to CASCADE`);
      await query(`ALTER TABLE refunds DROP CONSTRAINT ${c.conname}`);
      await query(`
        ALTER TABLE refunds
          ADD CONSTRAINT refunds_subscription_id_fkey
          FOREIGN KEY (subscription_id) REFERENCES event_subscriptions(id) ON DELETE CASCADE
      `);
    }
  }

  // 3) Purge orphan event-refunds whose subscription was already wiped by the
  //    legacy SET NULL behaviour. Scope strictly to event-refunds.
  const orphans = await query(`
    DELETE FROM refunds
    WHERE subscription_id IS NULL
      AND event_id IS NOT NULL
      AND enrollment_id IS NULL
      AND master_enrollment_id IS NULL
    RETURNING id
  `);
  console.log(`Deleted ${orphans.length} orphan event refund(s)`);

  await query(`CREATE INDEX IF NOT EXISTS idx_refunds_subscription ON refunds(subscription_id)`);
  return {
    success: true,
    message: `refunds.subscription_id CASCADE applied; ${orphans.length} orphan(s) removed`,
  };
}

async function fixEventSubscriptionStudentFk() {
  console.log('Starting migration: event_subscriptions.student_id -> CASCADE');

  // The original FK was ON DELETE SET NULL, which conflicts with the table's
  // CHECK constraint (student_id NOT NULL OR external_first_name+last_name NOT
  // NULL). Deleting a branch CASCADEs to students, which then tries to NULL
  // student_id on student-attached subscription rows and the CHECK rejects it.
  const fks = await query<{ conname: string; deltype: string }>(`
    SELECT con.conname, con.confdeltype AS deltype
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'event_subscriptions'
      AND con.contype = 'f'
      AND con.conkey @> ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = rel.oid AND attname = 'student_id'
      )]::smallint[]
  `);

  let upgraded = 0;
  for (const c of fks) {
    if (c.deltype !== 'c') {
      console.log(`Upgrading ${c.conname} from delete_rule=${c.deltype} to CASCADE`);
      await query(`ALTER TABLE event_subscriptions DROP CONSTRAINT ${c.conname}`);
      await query(`
        ALTER TABLE event_subscriptions
          ADD CONSTRAINT event_subscriptions_student_id_fkey
          FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      `);
      upgraded++;
    }
  }

  return {
    success: true,
    message: `event_subscriptions.student_id FK: ${upgraded} upgraded to CASCADE, ${fks.length - upgraded} already correct`,
  };
}

async function addEventSubscriptionPrice() {
  console.log('Starting migration: add subscription_price to events');
  await query(`
    ALTER TABLE events
      ADD COLUMN IF NOT EXISTS subscription_price DECIMAL(10, 2)
  `);
  return { success: true, message: 'events.subscription_price ready' };
}

async function addProductSaleRefundLink() {
  console.log('Starting migration: add product_sale_id to refunds');
  await query(`
    ALTER TABLE refunds
      ADD COLUMN IF NOT EXISTS product_sale_id UUID
  `);
  // FK is added only if it doesn't already exist. Drop-and-add is safer in case
  // the column existed without the constraint.
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'refunds' AND constraint_name = 'refunds_product_sale_id_fkey'
      ) THEN
        ALTER TABLE refunds
          ADD CONSTRAINT refunds_product_sale_id_fkey
          FOREIGN KEY (product_sale_id) REFERENCES product_sales(id) ON DELETE CASCADE;
      END IF;
    END$$;
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_refunds_product_sale ON refunds(product_sale_id)`);
  return { success: true, message: 'refunds.product_sale_id ready' };
}

async function createSessionTeacherAttendanceTable() {
  console.log('Starting migration: create session_teacher_attendance');
  await query(`
    CREATE TABLE IF NOT EXISTS session_teacher_attendance (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      role VARCHAR(16) NOT NULL DEFAULT 'PRIMARY' CHECK (role IN ('PRIMARY', 'SUBSTITUTE', 'ASSISTANT')),
      status VARCHAR(8) NOT NULL DEFAULT 'PRESENT' CHECK (status IN ('PRESENT', 'ABSENT')),
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (session_id, employee_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_session_teacher_attendance_session ON session_teacher_attendance(session_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_session_teacher_attendance_employee ON session_teacher_attendance(employee_id)`);
  return { success: true, message: 'session_teacher_attendance ready' };
}

async function runPhoneAuthMigration() {
  console.log('Starting migration: add phone auth columns to users');

  // 1) Add the columns we need for phone-based registration / verification.
  await query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS country_code VARCHAR(8),
      ADD COLUMN IF NOT EXISTS phone VARCHAR(32),
      ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS phone_otp VARCHAR(6),
      ADD COLUMN IF NOT EXISTS phone_otp_expires_at TIMESTAMPTZ
  `);

  // 2) Backfill existing users to verified = true so we don't lock anyone out
  //    when login starts checking phone_verified.
  await query(`
    UPDATE users
    SET phone_verified = TRUE
    WHERE phone IS NOT NULL AND phone_verified = FALSE
  `);

  // 3) Unique index on phone so phone is a usable login key.
  //    Partial index avoids blocking pre-existing rows that have NULL phone.
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
    ON users (phone)
    WHERE phone IS NOT NULL
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_users_phone_lookup
    ON users (phone)
  `);

  console.log('✅ Phone auth migration applied');
  return { success: true, message: 'Phone auth columns added to users table' };
}

async function runEmailVerificationMigration() {
  console.log('Starting migration: switch to email verification, drop company code/email & phone OTP');

  // 1) Add email OTP columns. Repurpose them from the phone OTP slot.
  await query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_otp VARCHAR(6),
      ADD COLUMN IF NOT EXISTS email_otp_expires_at TIMESTAMPTZ
  `);

  // 2) Ensure email_verified column exists and is NOT NULL with default FALSE.
  await query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN
  `);
  await query(`UPDATE users SET email_verified = FALSE WHERE email_verified IS NULL`);
  await query(`ALTER TABLE users ALTER COLUMN email_verified SET NOT NULL`);
  await query(`ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT FALSE`);

  // 3) Backfill existing users to verified=true so we don't lock anyone out
  //    when login starts gating on email_verified.
  await query(`UPDATE users SET email_verified = TRUE WHERE email_verified = FALSE`);

  // 4) Drop phone OTP columns — no longer used (WhatsApp OTP removed).
  await query(`ALTER TABLE users DROP COLUMN IF EXISTS phone_otp`);
  await query(`ALTER TABLE users DROP COLUMN IF EXISTS phone_otp_expires_at`);
  await query(`ALTER TABLE users DROP COLUMN IF EXISTS phone_verified`);

  // 5) Drop legacy email_verification_token / expires (replaced by email_otp).
  await query(`ALTER TABLE users DROP COLUMN IF EXISTS email_verification_token`);
  await query(`ALTER TABLE users DROP COLUMN IF EXISTS email_verification_expires`);

  // 6) Drop companies.code & companies.email — no longer collected at registration.
  await query(`DROP INDEX IF EXISTS idx_companies_code`);
  await query(`DROP INDEX IF EXISTS idx_companies_email`);
  await query(`ALTER TABLE companies DROP COLUMN IF EXISTS code`);
  await query(`ALTER TABLE companies DROP COLUMN IF EXISTS email`);

  console.log('✅ Email verification migration applied');
  return { success: true, message: 'Switched to email verification; dropped phone OTP & company code/email' };
}

async function addAcquisitionChannelToStudents() {
  console.log('Starting migration: add acquisition_channel to students');
  await query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS acquisition_channel VARCHAR(50)
  `);
  console.log('✅ acquisition_channel column ensured on students');
  return { success: true, message: 'acquisition_channel column ensured on students' };
}

async function renameChurnToInactive() {
  console.log('Starting migration: rename students.churn_date/churn_reason -> inactive_date/inactive_reason');
  // Idempotent: only rename if the old column still exists and the new one does
  // not. A view (student_enrollment_stats) references churn_date, but Postgres
  // tracks the dependency by column number, so the rename propagates cleanly.
  await query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'students' AND column_name = 'churn_date')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'students' AND column_name = 'inactive_date') THEN
        ALTER TABLE students RENAME COLUMN churn_date TO inactive_date;
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'students' AND column_name = 'churn_reason')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'students' AND column_name = 'inactive_reason') THEN
        ALTER TABLE students RENAME COLUMN churn_reason TO inactive_reason;
      END IF;
    END $$;
  `);
  await query(`ALTER INDEX IF EXISTS idx_students_churn_date RENAME TO idx_students_inactive_date`);
  console.log('✅ students churn columns renamed to inactive_date / inactive_reason');
  return { success: true, message: 'Renamed students.churn_date->inactive_date, churn_reason->inactive_reason' };
}

async function addStudentInactiveDateTrigger() {
  console.log('Starting migration: students inactive_date deactivation trigger + backfill');
  // Trigger: stamp inactive_date when is_active flips true->false, clear on reactivation.
  await query(`
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
  `);
  await query(`DROP TRIGGER IF EXISTS trg_student_inactive_date ON students`);
  await query(`
    CREATE TRIGGER trg_student_inactive_date
      BEFORE UPDATE ON students
      FOR EACH ROW EXECUTE FUNCTION set_student_inactive_date()
  `);
  // Backfill: existing deactivated students with no date get their last-update date.
  const backfilled = await query(`
    UPDATE students
      SET inactive_date = updated_at::date
      WHERE is_active = false AND inactive_date IS NULL
      RETURNING id
  `);
  console.log(`✅ inactive_date trigger installed; backfilled ${backfilled.length} deactivated students`);
  return { success: true, message: `inactive_date trigger installed; backfilled ${backfilled.length} students` };
}

async function createLevelsFeature() {
  console.log('Starting migration: levels table + course/master_course level_id');

  // 0) Ensure the shared updated_at trigger function exists (some DBs were
  //    initialized without it). Idempotent via CREATE OR REPLACE.
  await query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ language 'plpgsql'
  `);

  // 1) levels table
  await query(`
    CREATE TABLE IF NOT EXISTS levels (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      age INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_levels_company_id ON levels(company_id)`);
  await query(`DROP TRIGGER IF EXISTS update_levels_updated_at ON levels`);
  await query(`
    CREATE TRIGGER update_levels_updated_at
      BEFORE UPDATE ON levels
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
  `);
  console.log('✓ levels table ready');

  // 2) courses.level_id
  await query(`
    ALTER TABLE courses
      ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES levels(id) ON DELETE SET NULL
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_courses_level_id ON courses(level_id)`);
  console.log('✓ courses.level_id ready');

  // 3) master_courses.level_id
  await query(`
    ALTER TABLE master_courses
      ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES levels(id) ON DELETE SET NULL
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_master_courses_level_id ON master_courses(level_id)`);
  console.log('✓ master_courses.level_id ready');

  console.log('✅ levels migration completed!');
  return { success: true, message: 'levels table created; level_id added to courses and master_courses' };
}

async function addGenderToStudents() {
  console.log('Starting migration: add gender to students');

  await query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS gender VARCHAR(10)
  `);

  // Backfill all existing rows to MALE before adding the CHECK constraint.
  const backfilled = await query(`
    UPDATE students SET gender = 'MALE' WHERE gender IS NULL RETURNING id
  `);
  console.log(`✓ Backfilled ${backfilled.length} student(s) to gender = MALE`);

  // Add the CHECK constraint if it isn't there yet.
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'students' AND constraint_name = 'students_gender_check'
      ) THEN
        ALTER TABLE students
          ADD CONSTRAINT students_gender_check CHECK (gender IN ('MALE', 'FEMALE'));
      END IF;
    END$$;
  `);

  console.log('✅ students.gender migration completed!');
  return { success: true, message: `students.gender ready; ${backfilled.length} existing row(s) set to MALE` };
}

async function addCompanyType() {
  console.log('Starting migration: add type to companies');

  // 1) Add the column (idempotent).
  await query(`
    ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS type VARCHAR(20)
  `);

  // 2) Backfill existing rows to ACADEMY before adding the CHECK constraint.
  const backfilled = await query(`
    UPDATE companies SET type = 'ACADEMY' WHERE type IS NULL RETURNING id
  `);
  console.log(`✓ Backfilled ${backfilled.length} compan(y/ies) to type = ACADEMY`);

  // 3) Default + NOT NULL so future inserts always have a value.
  await query(`ALTER TABLE companies ALTER COLUMN type SET DEFAULT 'ACADEMY'`);
  await query(`ALTER TABLE companies ALTER COLUMN type SET NOT NULL`);

  // 4) Add the CHECK constraint if it isn't there yet.
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'companies' AND constraint_name = 'companies_type_check'
      ) THEN
        ALTER TABLE companies
          ADD CONSTRAINT companies_type_check CHECK (type IN ('ACADEMY', 'TEACHER'));
      END IF;
    END$$;
  `);

  console.log('✅ companies.type migration completed!');
  return { success: true, message: `companies.type ready; ${backfilled.length} existing row(s) set to ACADEMY` };
}

async function addQrActivationToStudents() {
  console.log('Starting migration: add QR activation columns to students');

  await query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS qr_activated BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS qr_expiration DATE,
      ADD COLUMN IF NOT EXISTS qr_price DECIMAL(10, 2),
      ADD COLUMN IF NOT EXISTS qr_paid BOOLEAN DEFAULT false
  `);

  // Booleans must never be NULL — backfill pre-existing rows.
  const a = await query(`UPDATE students SET qr_activated = false WHERE qr_activated IS NULL RETURNING id`);
  const p = await query(`UPDATE students SET qr_paid = false WHERE qr_paid IS NULL RETURNING id`);

  console.log('✅ students QR-activation migration completed!');
  return {
    success: true,
    message: `students QR-activation columns ready; backfilled qr_activated=${a.length}, qr_paid=${p.length}`,
  };
}

async function addCourseMonthlyPriceOverrides() {
  console.log('Starting migration: course_monthly_price_overrides');

  await query(`
    CREATE TABLE IF NOT EXISTS course_monthly_price_overrides (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        course_id        UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        billing_year     INTEGER NOT NULL,
        billing_month    INTEGER NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
        override_price   DECIMAL(10, 2) NOT NULL,
        created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (course_id, billing_year, billing_month)
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_cmpo_course_id  ON course_monthly_price_overrides(course_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_cmpo_company_id ON course_monthly_price_overrides(company_id)`);

  // Trigger — ignore "already exists" errors
  try {
    await query(`
      CREATE TRIGGER update_course_monthly_price_overrides_updated_at
          BEFORE UPDATE ON course_monthly_price_overrides
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);
  } catch (e: any) {
    if (!e.message?.includes('already exists')) throw e;
  }

  console.log('✅ course_monthly_price_overrides migration completed!');
  return { success: true, message: 'course_monthly_price_overrides table ready' };
}

async function addSubscriptionHold() {
  console.log('Starting migration: subscription hold');

  // Add ON_HOLD to enrollment status constraint
  await query(`ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_status_check`);
  await query(`ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_check
    CHECK (status IN ('ACTIVE', 'COMPLETED', 'DROPPED', 'PENDING', 'ON_HOLD'))`);

  // Add hold tracking columns
  await query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS hold_start_month INTEGER`);
  await query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS hold_start_year INTEGER`);
  await query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS hold_months INTEGER`);

  console.log('✅ subscription hold migration completed!');
  return { success: true, message: 'Subscription hold migration ready' };
}

async function setupWhatsappTemplates() {
  console.log('Starting migration: whatsapp_templates (click-to-chat) + drop legacy messaging tables');

  // 1) Drop the legacy Meta-Cloud-API messaging tables — replaced by per-staff
  //    click-to-chat (wa.me) which needs no server-side sending, quota, or logs.
  await query(`DROP TABLE IF EXISTS message_log CASCADE`);
  await query(`DROP TABLE IF EXISTS messaging_quota CASCADE`);
  await query(`DROP TABLE IF EXISTS message_settings CASCADE`);
  await query(`DROP TABLE IF EXISTS message_templates CASCADE`);
  console.log('✓ Dropped legacy messaging tables');

  // 2) Create the editable click-to-chat template store. One body per type per
  //    company; the app fills defaults for any type a company hasn't customized.
  await query(`
    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      type        VARCHAR(30) NOT NULL
                    CHECK (type IN ('QR_STUDENT', 'FOLLOWUP_PARENT', 'ABSENCE', 'PAYMENT_DELAY', 'EXAM_RESULTS')),
      body        TEXT NOT NULL,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, type)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_company ON whatsapp_templates(company_id)`);
  await query(`DROP TRIGGER IF EXISTS update_whatsapp_templates_updated_at ON whatsapp_templates`);
  await query(`
    CREATE TRIGGER update_whatsapp_templates_updated_at
      BEFORE UPDATE ON whatsapp_templates
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
  `);
  console.log('✅ whatsapp_templates migration completed!');
  return { success: true, message: 'whatsapp_templates ready; legacy messaging tables dropped' };
}

async function addStudentCodeToStudents() {
  console.log('Starting migration: add sequential student_code to students');

  // 1) Add the column (idempotent).
  await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS student_code INTEGER`);

  // 2) Backfill per-company sequential codes in enrollment/creation order so the
  //    earliest student in each company is #1. Only fills rows that lack a code,
  //    so re-running never renumbers already-coded students.
  const backfilled = await query(`
    WITH numbered AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY company_id
               ORDER BY created_at ASC, id ASC
             ) AS seq
      FROM students
    )
    UPDATE students s
    SET student_code = n.seq
    FROM numbered n
    WHERE s.id = n.id
      AND s.student_code IS NULL
    RETURNING s.id
  `);

  // 3) One code per company (NULLs never trip the unique index).
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_company_code
      ON students(company_id, student_code)
  `);

  console.log(`✅ student_code migration completed; backfilled ${backfilled.length} student(s)`);
  return {
    success: true,
    message: `students.student_code ready; backfilled ${backfilled.length} existing student(s)`,
  };
}

export const migrationsRoutes = {
  addStudentCodeToStudents: async () => {
    try {
      const result = await addStudentCodeToStudents();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  addCourseMonthlyPriceOverrides: async () => {
    try {
      const result = await addCourseMonthlyPriceOverrides();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  addQrActivationToStudents: async () => {
    try {
      const result = await addQrActivationToStudents();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  addCompanyType: async () => {
    try {
      const result = await addCompanyType();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  addGenderToStudents: async () => {
    try {
      const result = await addGenderToStudents();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  createLevelsFeature: async () => {
    try {
      const result = await createLevelsFeature();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  renameChurnToInactive: async () => {
    try {
      const result = await renameChurnToInactive();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  addStudentInactiveDateTrigger: async () => {
    try {
      const result = await addStudentInactiveDateTrigger();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  addAcquisitionChannelToStudents: async () => {
    try {
      const result = await addAcquisitionChannelToStudents();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  runEmailVerificationMigration: async () => {
    try {
      const result = await runEmailVerificationMigration();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  runPhoneAuthMigration: async () => {
    try {
      const result = await runPhoneAuthMigration();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  runInstructorMigration: async () => {
    try {
      const result = await runInstructorMigration();
      return {
        status: 200 as const,
        body: result,
      };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  runClassesInstructorMigration: async () => {
    try {
      const result = await runClassesInstructorMigration();
      return {
        status: 200 as const,
        body: result,
      };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  updateClassesTableStructure: async () => {
    try {
      const result = await updateClassesTableStructure();
      return {
        status: 200 as const,
        body: result,
      };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  updateProductsTableStructure: async () => {
    try {
      const result = await updateProductsTableStructure();
      return {
        status: 200 as const,
        body: result,
      };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  runRbacMigration: async () => {
    try {
      const result = await runRbacMigration();
      return {
        status: 200 as const,
        body: result,
      };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'RBAC migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  createMasterClassEnrollments: async () => {
    try {
      const result = await createMasterClassEnrollments();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  createExpensePaymentsTable: async () => {
    try {
      const result = await createExpensePaymentsTable();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  cleanupOrphanedPayments: async () => {
    try {
      const result = await query(
        `DELETE FROM expense_payments
         WHERE expense_id IS NULL
           AND employee_id IS NULL
           AND event_id IS NULL
         RETURNING id`
      );
      return {
        status: 200 as const,
        body: {
          success: true,
          message: `Deleted ${result.length} orphaned payment record(s)`,
          deletedCount: result.length,
        },
      };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Cleanup failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  createSessionAttendanceTable: async () => {
    try {
      const result = await createSessionAttendanceTable();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  createInstallmentTables: async () => {
    try {
      const result = await createInstallmentTables();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  addRefundSubscriptionLink: async () => {
    try {
      const result = await addRefundSubscriptionLink();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  fixEventSubscriptionStudentFk: async () => {
    try {
      const result = await fixEventSubscriptionStudentFk();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  addEventSubscriptionPrice: async () => {
    try {
      const result = await addEventSubscriptionPrice();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  addProductSaleRefundLink: async () => {
    try {
      const result = await addProductSaleRefundLink();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  createSessionTeacherAttendanceTable: async () => {
    try {
      const result = await createSessionTeacherAttendanceTable();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  clearAdminPermissions: async () => {
    try {
      const result = await query(
        `UPDATE users
         SET permissions = NULL
         WHERE role IN ('GLOBAL_ADMIN', 'ADMIN') AND permissions IS NOT NULL
         RETURNING id`
      );
      return {
        status: 200 as const,
        body: {
          success: true,
          message: `Cleared custom permissions on ${result.length} GLOBAL_ADMIN/ADMIN user(s)`,
          clearedCount: result.length,
        },
      };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  // Merge legacy permission keys into the consolidated resources:
  //   classes, master_courses, rooms, sessions, timetable -> courses
  //   withdrawals -> cash
  // Existing per-action overrides are OR'd into the target so users keep at
  // least the broadest access they had on any source resource.
  createEventFeatureTables: async () => {
    try {
      const result = await createEventFeatureMigration();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  mergePermissions: async () => {
    try {
      const users = await query(
        `SELECT id, permissions FROM users
         WHERE permissions IS NOT NULL
           AND (permissions ?| array['classes','master_courses','rooms','sessions','timetable','withdrawals'])`
      );
      const courseSources = ['classes', 'master_courses', 'rooms', 'sessions', 'timetable'];
      const cashSources = ['withdrawals'];
      let mergedCount = 0;
      for (const u of users) {
        const perms = { ...(u.permissions || {}) } as Record<string, any>;
        const mergeInto = (target: string, sources: string[]) => {
          const merged = { ...(perms[target] || {}) };
          for (const src of sources) {
            const sp = perms[src];
            if (!sp) continue;
            for (const action of ['read', 'write', 'delete']) {
              if (sp[action] === true) merged[action] = true;
              else if (sp[action] === false && merged[action] === undefined) merged[action] = false;
            }
          }
          if (Object.keys(merged).length > 0) perms[target] = merged;
        };
        mergeInto('courses', courseSources);
        mergeInto('cash', cashSources);
        for (const k of [...courseSources, ...cashSources]) delete perms[k];
        await query(
          `UPDATE users SET permissions = $1::jsonb WHERE id = $2`,
          [JSON.stringify(perms), u.id]
        );
        mergedCount++;
      }
      return {
        status: 200 as const,
        body: {
          success: true,
          message: `Merged legacy permission keys for ${mergedCount} user(s)`,
          mergedCount,
        },
      };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Permission merge failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  addSubscriptionHold: async () => {
    try {
      const result = await addSubscriptionHold();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
  setupWhatsappTemplates: async () => {
    try {
      const result = await setupWhatsappTemplates();
      return { status: 200 as const, body: result };
    } catch (error) {
      return {
        status: 500 as const,
        body: {
          success: false,
          message: 'Migration failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
};
