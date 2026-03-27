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

    // Check current table structure
    console.log('\n📋 Checking current products table structure...');
    const currentColumns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'products'
      ORDER BY ordinal_position;
    `);
    console.log('Current columns:', currentColumns.rows);

    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrate-products-schema.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('\n🔄 Running products schema migration...');
    console.log(migrationSQL);
    console.log('\n');

    await client.query(migrationSQL);

    console.log('✅ Migration completed successfully!');

    // Verify the columns after migration
    console.log('\n📋 Verifying updated table structure...');
    const updatedColumns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'products'
      ORDER BY ordinal_position;
    `);
    console.log('\n✅ Updated columns:');
    updatedColumns.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${row.column_default ? `DEFAULT ${row.column_default}` : ''}`);
    });

    // Verify specific important columns
    const checkColumns = ['stock', 'min_stock', 'cost_price', 'selling_price', 'category', 'unit', 'is_global'];
    console.log('\n✅ Verifying key columns:');
    for (const col of checkColumns) {
      const result = updatedColumns.rows.find(r => r.column_name === col);
      if (result) {
        console.log(`  ✓ ${col} exists (${result.data_type})`);
      } else {
        console.log(`  ✗ ${col} NOT FOUND`);
      }
    }

  } catch (error) {
    console.error('\n❌ Error running migration:', error.message);
    console.error('Full error:', error);
    throw error;
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed.');
  }
}

runMigration().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
