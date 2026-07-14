#!/usr/bin/env node
/**
 * Netrofit data seed.
 *
 * Populates branches, master courses, employees, courses, classes, and
 * students for a target tenant (resolved from --email).
 *
 * UUIDs are derived from `(company_id, kind, handle)` — so each tenant gets
 * its own stable IDs and multiple tenants can be seeded without PK collisions.
 * Re-running the seed against the same tenant is a no-op (ON CONFLICT DO NOTHING).
 *
 * Usage:
 *   node seed.js                                  # seeds default email (see CONFIG)
 *   node seed.js --email=foo@bar.com              # target a different user's company
 *   node seed.js --only=branches                  # one entity only
 *   node seed.js --email=a@x.com --email-also=b@y.com   # seed multiple tenants
 *
 * Requires AWS credentials for the profile in $AWS_PROFILE (defaults to 'personal').
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { fromIni } from '@aws-sdk/credential-providers';

// ── Configuration ─────────────────────────────────────────────────────────────
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
  defaultEmail: 'k@gmail.com',
};

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
// Support repeating --email OR a comma-separated list.
function parseEmails() {
  const raw = process.argv.slice(2).filter((a) => a.startsWith('--email='));
  if (raw.length > 0) return raw.flatMap((a) => a.slice('--email='.length).split(',').map((s) => s.trim()).filter(Boolean));
  return [CONFIG.defaultEmail];
}
const TARGET_EMAILS = parseEmails();
const ONLY = args.only; // branches | employees | courses | students | master-courses | classes

// ── AWS client ────────────────────────────────────────────────────────────────
const rdsClient = new RDSDataClient({
  region: CONFIG.region,
  credentials: fromIni({ profile: CONFIG.profile }),
});

async function runSql(sql, parameters = []) {
  const cmd = new ExecuteStatementCommand({
    resourceArn: CONFIG.resourceArn,
    secretArn: CONFIG.secretArn,
    database: CONFIG.database,
    sql,
    parameters,
  });
  return rdsClient.send(cmd);
}

// Parameter builders — RDS Data API wants typed values.
const p = {
  str: (name, value) => ({ name, value: value == null ? { isNull: true } : { stringValue: String(value) } }),
  uuid: (name, value) => ({ name, value: value == null ? { isNull: true } : { stringValue: String(value) }, typeHint: 'UUID' }),
  num: (name, value) => ({ name, value: value == null ? { isNull: true } : { doubleValue: Number(value) } }),
  int: (name, value) => ({ name, value: value == null ? { isNull: true } : { longValue: Number.parseInt(value, 10) } }),
  bool: (name, value) => ({ name, value: value == null ? { isNull: true } : { booleanValue: Boolean(value) } }),
  date: (name, value) => ({ name, value: value == null ? { isNull: true } : { stringValue: String(value) }, typeHint: 'DATE' }),
};

// UUID v5-ish: SHA1-hash "companyId:kind:handle", set version & variant bits.
// Guarantees: deterministic (same inputs → same id), different per-tenant.
function stableUuid(companyId, kind, handle) {
  const bytes = crypto.createHash('sha1')
    .update(`${companyId}:${kind}:${handle}`)
    .digest();
  const b = Buffer.from(bytes.slice(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function normalizeTime(t) {
  if (!t) return null;
  return /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t;
}

// Record one row's outcome for the end-of-run summary.
const stats = {
  branches: { inserted: 0, skipped: 0 },
  master_courses: { inserted: 0, skipped: 0 },
  employees: { inserted: 0, skipped: 0 },
  courses: { inserted: 0, skipped: 0 },
  classes: { inserted: 0, skipped: 0 },
  students: { inserted: 0, skipped: 0 },
};

function trackResult(kind, res) {
  const n = res.numberOfRecordsUpdated ?? 0;
  if (n > 0) stats[kind].inserted += n;
  else stats[kind].skipped += 1;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function resolveCompanyId(email) {
  const res = await runSql(
    'SELECT company_id FROM users WHERE email = :email LIMIT 1',
    [p.str('email', email)]
  );
  const row = res.records?.[0];
  if (!row?.[0]?.stringValue) {
    throw new Error(`No user found for email=${email}`);
  }
  return row[0].stringValue;
}

function readJson(filename) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return JSON.parse(fs.readFileSync(path.join(__dirname, filename), 'utf8'));
}

// ── Seed: Branches ────────────────────────────────────────────────────────────
async function seedBranches(companyId) {
  const rows = readJson('branches.json');
  process.stdout.write(`\n[branches]  `);
  for (const r of rows) {
    const id = stableUuid(companyId, 'branch', r.name);
    const res = await runSql(
      `INSERT INTO branches (id, company_id, name, code, address, city, state, zip_code, phone, email, opening_date, is_active)
       VALUES (:id, :companyId, :name, :code, :address, :city, :state, :zipCode, :phone, :emailVal, :openingDate, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.uuid('id', id),
        p.uuid('companyId', companyId),
        p.str('name', r.name),
        p.str('code', r.code),
        p.str('address', r.address),
        p.str('city', r.city),
        p.str('state', r.state),
        p.str('zipCode', r.zip_code),
        p.str('phone', r.phone),
        p.str('emailVal', r.email),
        p.date('openingDate', r.opening_date),
      ]
    );
    trackResult('branches', res);
    process.stdout.write(res.numberOfRecordsUpdated ? '.' : '-');
  }
}

// ── Seed: Employees ───────────────────────────────────────────────────────────
async function seedEmployees(companyId, branchByName) {
  const rows = readJson('employees.json');
  process.stdout.write(`\n[employees] `);
  for (const r of rows) {
    const branchId = branchByName.get(r.branch_ref);
    if (!branchId) {
      console.warn(`\n  skip employee ${r.first_name}: branch "${r.branch_ref}" not found`);
      stats.employees.skipped += 1;
      continue;
    }
    const id = stableUuid(companyId, 'employee', `${r.first_name} ${r.last_name}`);
    const res = await runSql(
      `INSERT INTO employees (id, company_id, first_name, last_name, email, phone, position, department, salary, hire_date, notes, branch_id, is_active)
       VALUES (:id, :companyId, :firstName, :lastName, :emailVal, :phone, :position, :department, :salary, :hireDate, :notes, :branchId, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.uuid('id', id),
        p.uuid('companyId', companyId),
        p.str('firstName', r.first_name),
        p.str('lastName', r.last_name),
        p.str('emailVal', r.email),
        p.str('phone', r.phone),
        p.str('position', r.position),
        p.str('department', r.department),
        p.num('salary', r.salary),
        p.date('hireDate', r.hire_date),
        p.str('notes', r.notes ?? null),
        p.uuid('branchId', branchId),
      ]
    );
    trackResult('employees', res);
    process.stdout.write(res.numberOfRecordsUpdated ? '.' : '-');
  }
}

// ── Seed: Master Courses ──────────────────────────────────────────────────────
async function seedMasterCourses(companyId, branchByName) {
  const rows = readJson('master_courses.json');
  process.stdout.write(`\n[masters]   `);
  for (const r of rows) {
    const branchId = branchByName.get(r.branch_ref);
    if (!branchId) {
      console.warn(`\n  skip master ${r.name}: branch "${r.branch_ref}" not found`);
      stats.master_courses.skipped += 1;
      continue;
    }
    const id = stableUuid(companyId, 'master_course', r.name);
    const res = await runSql(
      `INSERT INTO master_courses (id, company_id, branch_id, name, code, description, default_price, default_duration, default_max_students, is_active)
       VALUES (:id, :companyId, :branchId, :name, :code, :description, :defaultPrice, :defaultDuration, :defaultMaxStudents, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.uuid('id', id),
        p.uuid('companyId', companyId),
        p.uuid('branchId', branchId),
        p.str('name', r.name),
        p.str('code', r.code),
        p.str('description', r.description ?? null),
        p.num('defaultPrice', r.default_price),
        p.int('defaultDuration', r.default_duration),
        p.int('defaultMaxStudents', r.default_max_students ?? null),
      ]
    );
    trackResult('master_courses', res);
    process.stdout.write(res.numberOfRecordsUpdated ? '.' : '-');
  }
}

// ── Seed: Courses ─────────────────────────────────────────────────────────────
async function seedCourses(companyId, branchByName, employeeByName, masterByName) {
  const rows = readJson('courses.json');
  process.stdout.write(`\n[courses]   `);
  for (const r of rows) {
    const branchId = branchByName.get(r.branch_ref);
    if (!branchId) {
      console.warn(`\n  skip course ${r.name}: branch "${r.branch_ref}" not found`);
      stats.courses.skipped += 1;
      continue;
    }
    const instructorId = r.instructor_ref ? employeeByName.get(r.instructor_ref) : null;
    const masterCourseId = r.master_course_ref ? masterByName.get(r.master_course_ref) : null;
    if (r.master_course_ref && !masterCourseId) {
      console.warn(`\n  warn course ${r.name}: master "${r.master_course_ref}" not found — link skipped`);
    }
    const id = stableUuid(companyId, 'course', r.name);
    const res = await runSql(
      `INSERT INTO courses (id, company_id, branch_id, name, code, description, price, duration, max_students, instructor_id, master_course_id, is_active)
       VALUES (:id, :companyId, :branchId, :name, :code, :description, :price, :duration, :maxStudents, :instructorId, :masterCourseId, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.uuid('id', id),
        p.uuid('companyId', companyId),
        p.uuid('branchId', branchId),
        p.str('name', r.name),
        p.str('code', r.code),
        p.str('description', r.description ?? null),
        p.num('price', r.price),
        p.int('duration', r.duration),
        p.int('maxStudents', r.max_students ?? null),
        p.uuid('instructorId', instructorId ?? null),
        p.uuid('masterCourseId', masterCourseId ?? null),
      ]
    );
    trackResult('courses', res);
    process.stdout.write(res.numberOfRecordsUpdated ? '.' : '-');
  }

  // Re-link pass: if a course row already exists but isn't yet linked to its
  // master (happens when the course was seeded before master_course_ref was
  // added), set the FK now. Only touches master_course_id.
  let linked = 0;
  for (const r of rows) {
    if (!r.master_course_ref) continue;
    const masterCourseId = masterByName.get(r.master_course_ref);
    if (!masterCourseId) continue;
    const id = stableUuid(companyId, 'course', r.name);
    const res = await runSql(
      `UPDATE courses
         SET master_course_id = :masterCourseId
       WHERE id = :id
         AND (master_course_id IS DISTINCT FROM :masterCourseId)`,
      [p.uuid('masterCourseId', masterCourseId), p.uuid('id', id)]
    );
    linked += res.numberOfRecordsUpdated ?? 0;
  }
  if (linked > 0) console.log(`\n  relinked ${linked} course(s) to their master courses`);
}

// ── Seed: Classes ─────────────────────────────────────────────────────────────
async function seedClasses(companyId, courseByName, employeeByName) {
  const rows = readJson('classes.json');
  process.stdout.write(`\n[classes]   `);
  for (const r of rows) {
    const course = courseByName.get(r.course_ref);
    if (!course) {
      console.warn(`\n  skip class ${r.name}: course "${r.course_ref}" not found`);
      stats.classes.skipped += 1;
      continue;
    }
    const instructorId = r.instructor_ref ? employeeByName.get(r.instructor_ref) : null;
    const id = stableUuid(companyId, 'class', r.code);
    const res = await runSql(
      `INSERT INTO classes (id, company_id, course_id, branch_id, instructor_id, name, code, start_date, end_date, start_time, end_time, days_of_week, max_students, notes, is_active)
       VALUES (:id, :companyId, :courseId, :branchId, :instructorId, :name, :code, :startDate, :endDate, CAST(:startTime AS TIME), CAST(:endTime AS TIME), :daysOfWeek, :maxStudents, :notes, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.uuid('id', id),
        p.uuid('companyId', companyId),
        p.uuid('courseId', course.id),
        p.uuid('branchId', course.branch_id),
        p.uuid('instructorId', instructorId ?? null),
        p.str('name', r.name),
        p.str('code', r.code),
        p.date('startDate', r.start_date),
        p.date('endDate', r.end_date),
        // Accept "HH:MM" or "HH:MM:SS" in the JSON; normalize to HH:MM:SS for Postgres.
        p.str('startTime', normalizeTime(r.start_time)),
        p.str('endTime', normalizeTime(r.end_time)),
        p.str('daysOfWeek', r.days_of_week ?? null),
        p.int('maxStudents', r.max_students ?? null),
        p.str('notes', r.notes ?? null),
      ]
    );
    trackResult('classes', res);
    process.stdout.write(res.numberOfRecordsUpdated ? '.' : '-');
  }
}

// ── Seed: Students ────────────────────────────────────────────────────────────
async function seedStudents(companyId, branchByName) {
  const rows = readJson('students.json');
  process.stdout.write(`\n[students]  `);
  for (const r of rows) {
    const branchId = branchByName.get(r.branch_ref);
    if (!branchId) {
      console.warn(`\n  skip student ${r.first_name}: branch "${r.branch_ref}" not found`);
      stats.students.skipped += 1;
      continue;
    }
    const id = stableUuid(companyId, 'student', `${r.first_name} ${r.last_name}`);
    const res = await runSql(
      `INSERT INTO students (id, company_id, first_name, last_name, date_of_birth, email, phone, parent_name, parent_phone, address, branch_id, is_active)
       VALUES (:id, :companyId, :firstName, :lastName, :dob, :emailVal, :phone, :parentName, :parentPhone, :address, :branchId, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.uuid('id', id),
        p.uuid('companyId', companyId),
        p.str('firstName', r.first_name),
        p.str('lastName', r.last_name),
        p.date('dob', r.date_of_birth ?? null),
        p.str('emailVal', r.email ?? null),
        p.str('phone', r.phone ?? null),
        p.str('parentName', r.parent_name ?? null),
        p.str('parentPhone', r.parent_phone ?? null),
        p.str('address', r.address ?? null),
        p.uuid('branchId', branchId),
      ]
    );
    trackResult('students', res);
    process.stdout.write(res.numberOfRecordsUpdated ? '.' : '-');
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────────
async function seedOneTenant(email) {
  console.log(`\n========== ${email} ==========`);
  console.log(`  db          : ${CONFIG.database}`);
  console.log(`  entities    : ${ONLY || 'all (branches, master_courses, employees, courses, classes, students)'}`);

  const companyId = await resolveCompanyId(email);
  console.log(`  company_id  : ${companyId}`);

  // Build name→id maps using the company-scoped stableUuid. Different tenants
  // get different UUIDs for the same seed name, so seeding multiple tenants
  // works without PK collisions.
  const branchByName = new Map(
    readJson('branches.json').map((b) => [b.name, stableUuid(companyId, 'branch', b.name)])
  );
  const employeeByName = new Map(
    readJson('employees.json').map((e) => [
      `${e.first_name} ${e.last_name}`,
      stableUuid(companyId, 'employee', `${e.first_name} ${e.last_name}`),
    ])
  );
  const masterByName = new Map(
    readJson('master_courses.json').map((m) => [m.name, stableUuid(companyId, 'master_course', m.name)])
  );
  // Classes need both the course's id AND branch_id, so we cache both.
  const courseByName = new Map(
    readJson('courses.json').map((c) => [
      c.name,
      { id: stableUuid(companyId, 'course', c.name), branch_id: branchByName.get(c.branch_ref) },
    ])
  );

  if (!ONLY || ONLY === 'branches')        await seedBranches(companyId);
  if (!ONLY || ONLY === 'master-courses')  await seedMasterCourses(companyId, branchByName);
  if (!ONLY || ONLY === 'employees')       await seedEmployees(companyId, branchByName);
  if (!ONLY || ONLY === 'courses')         await seedCourses(companyId, branchByName, employeeByName, masterByName);
  if (!ONLY || ONLY === 'classes')         await seedClasses(companyId, courseByName, employeeByName);
  if (!ONLY || ONLY === 'students')        await seedStudents(companyId, branchByName);
}

function resetStats() {
  for (const k of Object.keys(stats)) stats[k] = { inserted: 0, skipped: 0 };
}

async function main() {
  console.log(`\nNetrofit seed`);
  console.log(`  tenants     : ${TARGET_EMAILS.join(', ')}`);
  for (const email of TARGET_EMAILS) {
    resetStats();
    await seedOneTenant(email);
    console.log('\n\nSummary ("." = inserted, "-" = already exists / skipped):');
    for (const [k, v] of Object.entries(stats)) {
      if (v.inserted || v.skipped) {
        console.log(`  ${k.padEnd(15)}  inserted=${v.inserted}  skipped=${v.skipped}`);
      }
    }
  }
  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error('\n\nSeed failed:', err?.message || err);
  if (err?.$metadata) console.error('  RDS Data API error details above.');
  process.exit(1);
});
