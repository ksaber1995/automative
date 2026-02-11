const { Client } = require('pg');

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

async function checkClassesTable() {
  const client = new Client(dbConfig);

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected!\n');

    // Check if classes table exists
    const tableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'classes';
    `);

    if (tableCheck.rows.length === 0) {
      console.log('❌ Classes table does NOT exist!');
      console.log('\nAvailable tables:');
      const tables = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);
      tables.rows.forEach(row => console.log('  -', row.table_name));
      return;
    }

    console.log('✅ Classes table exists\n');

    // Get column information
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'classes'
      ORDER BY ordinal_position;
    `);

    console.log('Classes table columns:');
    console.table(columns.rows);

    // Try to insert a test record
    console.log('\nTrying to insert a test record...');
    try {
      const testInsert = await client.query(`
        INSERT INTO classes (
          course_id, branch_id, instructor_id, name, code,
          start_date, end_date, start_time, end_time,
          days_of_week, max_students, current_enrollment, notes, is_active
        ) VALUES (
          'f504a4b9-4dff-4ccb-add9-9e979c9f0f31',
          '30b4a996-1561-4fc0-8403-8bbb4a020999',
          NULL,
          'Test Class',
          'TEST-1',
          '2026-03-01',
          '2026-04-26',
          '09:00:00',
          '11:00:00',
          'MONDAY,WEDNESDAY',
          10,
          0,
          NULL,
          true
        ) RETURNING *;
      `);
      console.log('✅ Test insert successful!');
      console.log('Inserted record:', testInsert.rows[0]);

      // Clean up test record
      await client.query(`DELETE FROM classes WHERE code = 'TEST-1'`);
      console.log('✅ Test record cleaned up');
    } catch (insertError) {
      console.error('❌ Test insert failed:', insertError.message);
      console.error('Error details:', insertError);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
    console.log('\nDatabase connection closed.');
  }
}

checkClassesTable();
