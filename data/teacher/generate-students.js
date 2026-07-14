#!/usr/bin/env node
/**
 * Teacher-tenant student seed.
 *
 * Populates N students for a TEACHER-registration-type company. Unlike the
 * academy seed (../seed.js), a teacher tenant has exactly ONE branch — the
 * "<Company> - Main Branch" (code MAIN) created automatically at signup — so
 * this script resolves that existing branch and attaches every student to it
 * rather than seeding its own branches.
 *
 * Students are generated deterministically: the UUID and every field are
 * derived from `(company_id, index)`, so the data is stable and re-runnable.
 * Every insert uses ON CONFLICT (id) DO NOTHING, so running twice is a no-op.
 *
 * Usage:
 *   node generate-students.js                              # 1000 students, default email
 *   node generate-students.js --email=foo@bar.com --count=1000
 *   node generate-students.js --branch="MAIN"              # target a branch by code or name
 *   node generate-students.js --dry-run                    # generate + print sample, no DB writes
 *
 * Production connection (NOT defaulted — must be supplied for prod):
 *   DB_CLUSTER_ARN=arn:... DB_SECRET_ARN=arn:... DB_NAME=automative \
 *   AWS_PROFILE=prod AWS_REGION=eu-west-1 node generate-students.js
 *
 * Requires AWS credentials for $AWS_PROFILE (defaults to 'personal').
 */

import crypto from 'node:crypto';
// AWS SDK is imported lazily inside getClient() so `--dry-run` works without
// `npm install` and without AWS credentials.

// ── Configuration ─────────────────────────────────────────────────────────────
// NOTE: the ARNs below default to the DEV cluster. To seed PRODUCTION you MUST
// override DB_CLUSTER_ARN / DB_SECRET_ARN (and likely AWS_PROFILE) via env vars.
const CONFIG = {
  region: process.env.AWS_REGION || 'eu-west-1',
  profile: process.env.AWS_PROFILE || 'personal',
  resourceArn:
    process.env.DB_CLUSTER_ARN ||
    'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-dev-automatemagicauroradbef2379-yqb2wihdkbe8',
  secretArn:
    process.env.DB_SECRET_ARN ||
    'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/dev/automate-magic/db-credentials-i8zzeQ',
  database: process.env.DB_NAME || 'automative',
  defaultEmail: 'karimali201094@gmail.com',
};

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const EMAIL = args.email || CONFIG.defaultEmail;
const COUNT = Number.parseInt(args.count ?? '1000', 10);
const BRANCH_HINT = args.branch || null; // branch code or name to target (optional)
const DRY_RUN = Boolean(args['dry-run']);

// ── AWS client (lazy) ───────────────────────────────────────────────────────
let _rds = null;
let _ExecuteStatementCommand = null;
async function getClient() {
  if (_rds) return _rds;
  const { RDSDataClient, ExecuteStatementCommand } = await import('@aws-sdk/client-rds-data');
  const { fromIni } = await import('@aws-sdk/credential-providers');
  _ExecuteStatementCommand = ExecuteStatementCommand;
  _rds = new RDSDataClient({ region: CONFIG.region, credentials: fromIni({ profile: CONFIG.profile }) });
  return _rds;
}

async function runSql(sql, parameters = []) {
  const client = await getClient();
  const cmd = new _ExecuteStatementCommand({
    resourceArn: CONFIG.resourceArn,
    secretArn: CONFIG.secretArn,
    database: CONFIG.database,
    sql,
    parameters,
  });
  return client.send(cmd);
}

const p = {
  str: (name, value) => ({ name, value: value == null ? { isNull: true } : { stringValue: String(value) } }),
  uuid: (name, value) => ({ name, value: value == null ? { isNull: true } : { stringValue: String(value) }, typeHint: 'UUID' }),
  date: (name, value) => ({ name, value: value == null ? { isNull: true } : { stringValue: String(value) }, typeHint: 'DATE' }),
};

// Deterministic UUID v5-ish from "companyId:kind:handle".
function stableUuid(companyId, kind, handle) {
  const bytes = crypto.createHash('sha1').update(`${companyId}:${kind}:${handle}`).digest();
  const b = Buffer.from(bytes.slice(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Deterministic 32-hex QR token (matches students.qr_token VARCHAR(32)). The
// real create endpoint sets one per student; the bulk seed must too, or the
// student's QR code/public profile won't work.
function stableQrToken(companyId, handle) {
  return crypto.createHash('sha1').update(`${companyId}:qr:${handle}`).digest('hex').slice(0, 32);
}

// ── Name pools (Egyptian, EGP/Africa-Cairo tenant) ──────────────────────────────
const FIRST_M = ['Ahmed', 'Mohamed', 'Mahmoud', 'Omar', 'Youssef', 'Khaled', 'Ali', 'Hassan', 'Mostafa', 'Karim', 'Tarek', 'Amr', 'Hossam', 'Sherif', 'Ibrahim', 'Abdullah', 'Ziad', 'Adel', 'Nour', 'Seif'];
const FIRST_F = ['Mariam', 'Nour', 'Salma', 'Habiba', 'Farida', 'Jana', 'Malak', 'Hana', 'Sara', 'Yasmin', 'Aya', 'Nada', 'Rana', 'Dina', 'Reem', 'Mai', 'Layla', 'Hagar', 'Menna', 'Rowan'];
const LAST = ['Hassan', 'Mohamed', 'Ali', 'Ibrahim', 'Mahmoud', 'Said', 'Fathy', 'Abdelrahman', 'Khalil', 'Mansour', 'Saleh', 'Gaber', 'Naguib', 'Shawky', 'Rashad', 'Zaki', 'Fawzy', 'Ramadan', 'Sobhy', 'Helmy'];

function pad(n, w) { return String(n).padStart(w, '0'); }

/** Build a single deterministic student record from its index. */
function makeStudent(i) {
  const isMale = i % 2 === 0;
  const first = (isMale ? FIRST_M : FIRST_F)[i % 20];
  const last = LAST[(i * 7) % LAST.length];
  const fatherFirst = FIRST_M[(i * 3) % FIRST_M.length];
  const handle = `student-${pad(i, 4)}`;
  // Ages 6–18: birth year = 2026 - (6 + i%13). Month/day cycle for variety.
  const age = 6 + (i % 13);
  const year = 2026 - age;
  const month = pad((i % 12) + 1, 2);
  const day = pad((i % 27) + 1, 2);
  const phoneTail = pad(10000000 + (i * 137) % 89999999, 8);
  return {
    handle,
    first_name: first,
    last_name: last,
    date_of_birth: `${year}-${month}-${day}`,
    email: `${first}.${last}.${pad(i, 4)}@students.example.com`.toLowerCase(),
    phone: `+2010${phoneTail}`,
    parent_name: `${fatherFirst} ${last}`,
    parent_phone: `+2011${phoneTail}`,
    address: `${(i % 200) + 1} Street, Cairo`,
  };
}

// ── Resolvers ───────────────────────────────────────────────────────────────────
async function resolveCompanyId(email) {
  const res = await runSql('SELECT company_id FROM users WHERE email = :email LIMIT 1', [p.str('email', email)]);
  const id = res.records?.[0]?.[0]?.stringValue;
  if (!id) throw new Error(`No user found for email=${email}`);
  return id;
}

/**
 * Resolve the branch to attach students to. Teacher tenants have a single
 * branch; if --branch is given we match it by code or name, otherwise we take
 * the company's MAIN branch (or the only/first active branch as a fallback).
 */
async function resolveBranchId(companyId) {
  if (BRANCH_HINT) {
    const res = await runSql(
      `SELECT id, name, code FROM branches
        WHERE company_id = :cid AND (code = :h OR name = :h) LIMIT 1`,
      [p.uuid('cid', companyId), p.str('h', BRANCH_HINT)]
    );
    const row = res.records?.[0];
    if (!row?.[0]?.stringValue) throw new Error(`No branch matching "${BRANCH_HINT}" for this company`);
    return { id: row[0].stringValue, name: row[1]?.stringValue, code: row[2]?.stringValue };
  }
  const res = await runSql(
    `SELECT id, name, code FROM branches
      WHERE company_id = :cid AND is_active = true
      ORDER BY (code = 'MAIN') DESC, created_at ASC
      LIMIT 1`,
    [p.uuid('cid', companyId)]
  );
  const row = res.records?.[0];
  if (!row?.[0]?.stringValue) throw new Error('Company has no active branch to attach students to');
  return { id: row[0].stringValue, name: row[1]?.stringValue, code: row[2]?.stringValue };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\nTeacher student seed');
  console.log(`  email   : ${EMAIL}`);
  console.log(`  count   : ${COUNT}`);
  console.log(`  db      : ${CONFIG.database}`);
  console.log(`  cluster : ${CONFIG.resourceArn}`);
  const isProd = !/-dev-|\/dev\//.test(CONFIG.resourceArn);
  console.log(`  target  : ${isProd ? 'PRODUCTION (override ARN)' : 'dev (default ARN)'}`);

  if (DRY_RUN) {
    console.log('\n[dry-run] sample of generated students:');
    for (const i of [0, 1, 2, COUNT - 1]) {
      if (i < 0) continue;
      console.log('  ', JSON.stringify(makeStudent(i)));
    }
    console.log(`\n[dry-run] would insert ${COUNT} students. No DB writes performed.\n`);
    return;
  }

  const companyId = await resolveCompanyId(EMAIL);
  console.log(`  company : ${companyId}`);
  const branch = await resolveBranchId(companyId);
  console.log(`  branch  : ${branch.name} (${branch.code}) ${branch.id}`);

  let inserted = 0;
  let skipped = 0;
  process.stdout.write('\n[students] ');
  for (let i = 0; i < COUNT; i++) {
    const s = makeStudent(i);
    const id = stableUuid(companyId, 'student', s.handle);
    const res = await runSql(
      `INSERT INTO students (id, company_id, first_name, last_name, date_of_birth, email, phone,
         parent_name, parent_phone, address, branch_id, qr_token, is_active)
       VALUES (:id, :cid, :firstName, :lastName, :dob, :emailVal, :phone,
         :parentName, :parentPhone, :address, :branchId, :qrToken, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.uuid('id', id),
        p.uuid('cid', companyId),
        p.str('firstName', s.first_name),
        p.str('lastName', s.last_name),
        p.date('dob', s.date_of_birth),
        p.str('emailVal', s.email),
        p.str('qrToken', stableQrToken(companyId, s.handle)),
        p.str('phone', s.phone),
        p.str('parentName', s.parent_name),
        p.str('parentPhone', s.parent_phone),
        p.str('address', s.address),
        p.uuid('branchId', branch.id),
      ]
    );
    if (res.numberOfRecordsUpdated) inserted++; else skipped++;
    if (i % 50 === 0) process.stdout.write('.');
  }

  console.log(`\n\nDone. inserted=${inserted}  skipped(existing)=${skipped}  total=${COUNT}\n`);
}

main().catch((err) => {
  console.error('\n\nSeed failed:', err?.message || err);
  process.exit(1);
});
