// Local-only API for the admin console.
//
// Holds your AWS access keys (from .env) and runs read-only SQL against the
// Aurora cluster through the RDS Data API. The Aurora cluster lives in a private
// VPC, so this HTTPS-based Data API path is the only way to reach it from your
// laptop — and a browser can't sign these SigV4 calls itself, hence this thin
// local server. Nothing here is deployed; you run it on localhost.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { RDSDataClient, ExecuteStatementCommand } = require('@aws-sdk/client-rds-data');

const {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_PROFILE,
  AWS_REGION = 'eu-west-1',
  DB_CLUSTER_ARN,
  DB_SECRET_ARN,
  DB_NAME = 'automative',
  PORT = 3001,
} = process.env;

function assertConfig() {
  const missing = [
    ['DB_CLUSTER_ARN', DB_CLUSTER_ARN],
    ['DB_SECRET_ARN', DB_SECRET_ARN],
  ].filter(([, v]) => !v).map(([k]) => k);
  // Need credentials by *some* route: explicit keys here, or a named profile /
  // default chain (~/.aws/credentials, env vars, etc.).
  if (!AWS_ACCESS_KEY_ID && !AWS_PROFILE) {
    missing.push('AWS_ACCESS_KEY_ID (or AWS_PROFILE)');
  }
  if (missing.length) {
    console.error('\nMissing required env vars: ' + missing.join(', '));
    console.error('Copy .env.example to .env and fill them in.\n');
    process.exit(1);
  }
}
assertConfig();

// The Data API needs the cluster *ARN*. Be forgiving if someone pastes the bare
// cluster identifier: rebuild the ARN using the region + the account parsed from
// the secret ARN (arn:aws:secretsmanager:<region>:<account>:secret:...).
function resolveClusterArn(value, secretArn, region) {
  if (!value || value.startsWith('arn:')) return value;
  const account = (secretArn || '').split(':')[4];
  return account ? `arn:aws:rds:${region}:${account}:cluster:${value}` : value;
}
const RESOURCE_ARN = resolveClusterArn(DB_CLUSTER_ARN, DB_SECRET_ARN, AWS_REGION);

const client = new RDSDataClient({
  region: AWS_REGION,
  // If explicit keys are in .env, use them. Otherwise fall back to the default
  // AWS credential chain, which picks up AWS_PROFILE / ~/.aws/credentials.
  ...(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } }
    : {}),
});

// One read-only statement powers the whole table. The "type" of a subscription
// is its status (TRIAL / ACTIVE / ...); start/end fall back to the trial window
// for companies still on trial. Employee and branch counts are per-company.
const SUBSCRIPTIONS_SQL = `
  SELECT
    c.id                                                       AS company_id,
    c.name                                                     AS company_name,
    c.is_active                                                AS company_active,
    c.currency                                                 AS currency,
    c.created_at                                               AS company_created_at,
    s.status                                                   AS subscription_type,
    s.price                                                    AS price,
    COALESCE(s.subscription_start_date, s.trial_start_date)    AS start_date,
    COALESCE(s.subscription_end_date,   s.trial_end_date)      AS end_date,
    (SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id) AS employee_count,
    (SELECT COUNT(*) FROM branches  b WHERE b.company_id = c.id) AS branch_count
  FROM companies c
  LEFT JOIN subscriptions s ON s.company_id = c.id
  ORDER BY c.created_at DESC
`;

async function runQuery(sql) {
  const cmd = new ExecuteStatementCommand({
    resourceArn: RESOURCE_ARN,
    secretArn: DB_SECRET_ARN,
    database: DB_NAME,
    sql,
    // Get clean JSON objects back instead of typed field arrays.
    formatRecordsAs: 'JSON',
  });
  const res = await client.send(cmd);
  return res.formattedRecords ? JSON.parse(res.formattedRecords) : [];
}

const app = express();
app.use(cors());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, region: AWS_REGION, database: DB_NAME });
});

app.get('/api/subscriptions', async (_req, res) => {
  try {
    const rows = await runQuery(SUBSCRIPTIONS_SQL);
    res.json(rows);
  } catch (err) {
    console.error('Query failed:', err);
    res.status(500).json({
      error: err.name || 'QueryError',
      message: err.message || 'Failed to run query',
    });
  }
});

app.listen(PORT, async () => {
  console.log(`\n  Admin local API → http://localhost:${PORT}`);
  console.log(`  DB: ${DB_NAME}  Region: ${AWS_REGION}`);
  console.log(`  Cluster: ${RESOURCE_ARN}`);
  console.log(`  GET /api/subscriptions\n`);

  // Self-test: hit the Data API once on startup so the real error (if any) is
  // printed right here in the terminal instead of hiding behind a browser 500.
  try {
    process.stdout.write('  Self-test (SELECT 1) … ');
    await runQuery('SELECT 1 AS ok');
    console.log('OK — connection works ✓\n');
  } catch (err) {
    console.log('FAILED ✗');
    console.error('  →', err.name + ':', err.message);
    if (err.name === 'BadRequestException') {
      console.error('  Hint: check DB_CLUSTER_ARN (must be a full cluster ARN), DB_SECRET_ARN, and DB_NAME.');
    } else if (err.name === 'AccessDeniedException' || /not authorized/i.test(err.message || '')) {
      console.error('  Hint: the IAM identity needs rds-data:ExecuteStatement + secretsmanager:GetSecretValue.');
    }
    console.error('');
  }
});
