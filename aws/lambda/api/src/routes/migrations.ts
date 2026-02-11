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
};
