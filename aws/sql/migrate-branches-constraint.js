/**
 * Migration: Fix branches.code unique constraint to be company-scoped
 * Problem: branches.code had a global UNIQUE, so code 'MAIN' could only exist
 * once across ALL companies. Every registration after the first would fail.
 * Usage: node migrate-branches-constraint.js
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
  console.log('Running branches constraint migration...\n');

  // 1. Drop the global unique constraint on code
  await exec(
    `ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_code_key`,
    'Drop global unique constraint on branches.code'
  );

  // 2. Add company-scoped unique constraint
  await exec(
    `ALTER TABLE branches ADD CONSTRAINT branches_company_id_code_key UNIQUE(company_id, code)`,
    'Add UNIQUE(company_id, code) constraint'
  );

  // 3. Clean up orphaned companies left by previously broken registrations
  // (companies with no users — created before the transaction fix)
  await exec(
    `DELETE FROM companies
     WHERE id NOT IN (
       SELECT DISTINCT company_id FROM users WHERE company_id IS NOT NULL
     )`,
    'Remove orphaned companies from failed registrations'
  );

  console.log('\nBranches constraint migration completed successfully!');
}

main().catch(err => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
