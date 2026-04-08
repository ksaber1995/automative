/**
 * Migration: Add subscriptions table and migrate existing companies to TRIAL
 * Usage: node migrate-subscriptions.js
 */

const { RDSDataClient, ExecuteStatementCommand } = require('@aws-sdk/client-rds-data');

const CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-dev-automatemagicauroradbef2379-yqb2wihdkbe8';
const SECRET_ARN = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/dev/automate-magic/db-credentials-i8zzeQ';
const DATABASE = 'automative';

const client = new RDSDataClient({ region: 'eu-west-1' });

async function exec(sql, description) {
  process.stdout.write(`  → ${description} ... `);
  try {
    await client.send(new ExecuteStatementCommand({
      resourceArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
      database: DATABASE,
      sql,
    }));
    console.log('✓');
  } catch (err) {
    console.log(`✗ ${err.message}`);
    throw err;
  }
}

async function main() {
  console.log('🚀 Running subscriptions migration...\n');

  // 1. Create subscriptions table
  await exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'TRIAL' CHECK (status IN ('TRIAL', 'MONTHLY', 'ANNUAL', 'EXPIRED')),
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      trial_start_date DATE,
      trial_end_date DATE,
      subscription_start_date DATE,
      subscription_end_date DATE,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `, 'Create subscriptions table');

  // 2. Index
  await exec(
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_company_id ON subscriptions(company_id)`,
    'Create index on company_id'
  );

  // 3. Updated_at trigger
  await exec(`
    CREATE OR REPLACE TRIGGER update_subscriptions_updated_at
      BEFORE UPDATE ON subscriptions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
  `, 'Create updated_at trigger');

  // 4. Migrate existing companies → all set to TRIAL with 60-day trial from today
  await exec(`
    INSERT INTO subscriptions (company_id, status, price, trial_start_date, trial_end_date)
    SELECT id, 'TRIAL', 0, CURRENT_DATE, CURRENT_DATE + INTERVAL '60 days'
    FROM companies
    ON CONFLICT (company_id) DO NOTHING
  `, 'Migrate existing companies to TRIAL');

  console.log('\n✅ Subscriptions migration completed successfully!');
}

main().catch(err => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
