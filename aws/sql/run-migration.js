const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  host: 'automatemagicstack-dev-automatemagicauroradbef2379-nmlmuhgtiaqh.cluster-cd602k6cauug.eu-west-1.rds.amazonaws.com',
  port: 5432,
  database: 'automative',
  user: 'automative_admin',
  password: 'ukOsRxxNXngxOVaa9iSxTkJsPLyKqND6',
  ssl: {
    rejectUnauthorized: false
  }
};

async function runMigration() {
  const client = new Client(dbConfig);

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully!');

    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', 'add_instructor_to_courses.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('\nRunning migration...');
    console.log(migrationSQL);
    console.log('\n');

    await client.query(migrationSQL);

    console.log('✅ Migration completed successfully!');

    // Verify the column was added
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'courses' AND column_name = 'instructor_id';
    `);

    if (result.rows.length > 0) {
      console.log('\n✅ Verification: instructor_id column exists');
      console.log(result.rows[0]);
    } else {
      console.log('\n❌ Verification failed: instructor_id column not found');
    }

  } catch (error) {
    console.error('❌ Error running migration:', error.message);
    throw error;
  } finally {
    await client.end();
    console.log('\nDatabase connection closed.');
  }
}

runMigration().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
