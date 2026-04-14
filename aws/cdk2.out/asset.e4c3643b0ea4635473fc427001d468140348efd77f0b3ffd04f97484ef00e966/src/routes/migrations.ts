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
      ADD COLUMN IF NOT EXISTS code VARCHAR(50),
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

    await query(`
      UPDATE classes
      SET code = 'CLS-' || SUBSTRING(id::text FROM 1 FOR 6)
      WHERE code IS NULL;
    `);

    // Make columns NOT NULL
    await query(`ALTER TABLE classes ALTER COLUMN name SET NOT NULL;`);
    await query(`ALTER TABLE classes ALTER COLUMN code SET NOT NULL;`);

    // Add unique constraint on code
    await query(`
      ALTER TABLE classes
      ADD CONSTRAINT unique_class_code UNIQUE (code);
    `);

    console.log('✅ Migration completed successfully!');

    // Verify
    const verifyResult = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'classes'
      AND column_name IN ('name', 'code', 'start_date', 'end_date', 'start_time', 'end_time', 'days_of_week', 'current_enrollment', 'notes')
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

export const migrationsRoutes = {
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
};
