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
};
