# Feature Plan: Online Exams — Lessons, MCQ Question Bank, Per-Student Random Papers

> Companion to `exam.md` (offline exams + QR grade recording, shipped as migrations 035/036/059).
> This plan **extends** that stack rather than replacing it: an online exam is a row in the same
> `exams` table, and its auto-computed mark lands in the same `exam_results` row, so the student
> detail page, the public QR profile, the Telegram/SMS result blast and `markRemainingAbsent`
> all keep working with no changes.

## The idea in one paragraph

A teacher first **registers lessons** for a course (`courses 1—N lessons`, ordered). Into each lesson
they type **MCQ questions** — the lesson's question bank. Then they create an **online exam**: pick one
or more lessons (or "everything taught so far in this class"), say **how many questions** it should
draw, a **duration**, an **open/close window**, and the app prints a short **access code**. Each student
opens **their own QR profile** (`/p/s/:qr_token`), sees the exam listed, types the code, and gets a
**paper drawn at random from the pooled questions of the selected lessons** — a different set, in a
different order, for every student. On submit it is **graded instantly**, the score shows on screen, and
the mark is written into `exam_results` so it appears everywhere marks already appear.

### Decisions locked in

| Decision | Choice |
|---|---|
| **Student access** | A **separate student portal at `exams.netrofit.com`** with **real student credentials**. First visit: the student **scans their card** with the site's camera, then sets a **username (or phone) + password**. After that they sign in normally. **Forgot the password → scan the card again** and set a new one. Fully specified in §0.5. |
| **Tenant gating** | One per-company flag, **toggled from the admin console** (`dione.netrofit.com`), off for everyone but the test tenant. §0. |
| **Lessons** | New `lessons` table, per **course**, with `order_index`. `sessions` gets a nullable `lesson_id`, so **"all previous lessons" = the lessons this class has actually been taught** (Class A at L4 and Class B at L2 get different papers from the same exam definition). |
| **Randomisation** | One **total count** per exam (`question_count`). Pool = all active questions of all selected lessons; draw `question_count` at random, shuffle order, optionally shuffle options. |
| **Grading** | Auto-graded on submit. Score shown immediately with an answer review. The mark is upserted into **`exam_results`** (`grade = correct count`, `exams.max_grade = question_count`). |
| **Question type** | MCQ only, **exactly one correct option**. Multi-select / true-false / free text are explicitly out of scope for v1. |
| **Storage of a sat paper** | The drawn paper is **frozen and snapshotted** (question + option text copied) at start, so editing or deleting a question later never rewrites history or breaks a running attempt. |
| **Permissions** | Reuse the existing **`academy`** resource (`read`/`write`/`delete`) — same as Courses/Classes/Exams. No RBAC migration. |
| **Plan gating** | Not gated in v1. If it should be Advanced-only later, copy the `assertCrmAvailable` pattern in `routes/crm.ts:144`. |

### Explicitly out of scope for v1
Proctoring, tab-switch detection, question images/LaTeX, multi-select and written answers, per-question
marks (every question is worth 1), question difficulty/tags, retakes, bulk CSV question import, and
exam-level analytics beyond the attempts list. Each is additive on top of this schema.

---

## 0. Tenant gating — the whole feature is off for everyone but the test tenant

**One per-company flag, `companies.online_exams_enabled`, default `false`.** Everything in this plan —
Lessons, the question bank, the online section of the exam form, the attempts monitor, and every
student-facing endpoint — is dark for every tenant until that flag is flipped.

### Why a DB flag and not a hardcoded company-id allowlist

The codebase has both patterns, and they are not interchangeable here:

- `VENDOR_TEST_COMPANIES` / the WhatsApp trial list in `core/services/auth.service.ts:31` — a hardcoded
  **frontend** list. It hides UI, and that is all it can do.
- `companies.qr_cards_enabled` (migration 063) and `companies.sms_activated` (097) — a per-company
  column, read at login and enforced by the API, flipped from the admin console.

Online exams need the second one, and the deciding reason is §3: **the student-facing endpoints are
unauthenticated.** `POST /api/public/exams/start` has no JWT, no user and no company context — it
resolves a tenant *from the student's QR token*. A frontend allowlist gates nothing there. The flag has
to be a fact about the company that the server can read from whatever it resolved, which is exactly
what a column is. It also means turning the feature on for one tenant is a one-row `UPDATE`, with no
redeploy and no code edit naming an id.

### The column

**Shipped** in `aws/sql/migrations/100_lessons.sql` — the migration is split per phase rather than one
big `100_lessons_and_online_exams.sql`, so each phase deploys with exactly the schema it needs (later
phases take 101, 102, …). Runtime guard sits next to its siblings in `routes/companies.ts`
(`ensureCompanySmsColumns`, `ensureCardDesignColumn`):

```sql
-- Online exams (lessons, question bank, student sitting) are gated per tenant and
-- OFF by default: the feature ships dark and is switched on for the vendor's test
-- tenant first. The API enforces this, including on the unauthenticated student
-- endpoints, which resolve the company from the student's QR token.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS online_exams_enabled BOOLEAN NOT NULL DEFAULT false;
```

```ts
// routes/companies.ts — same shape as ensureCompanySmsColumns
let onlineExamsColumnInitPromise: Promise<void> | null = null;
export async function ensureOnlineExamsColumn(): Promise<void> { /* ALTER … IF NOT EXISTS */ }

/**
 * "May this tenant use online exams at all?" — the single gate for the whole
 * feature. Returns an apiError response when denied, null when allowed, so callers
 * read `const denied = await assertOnlineExams(companyId); if (denied) return denied;`
 * Mirrors assertCrmAvailable in routes/crm.ts:144.
 */
export async function assertOnlineExams(companyId: string) { /* … 403 ERRORS.EXAMS.ONLINE_NOT_AVAILABLE */ }
```

### Where it is enforced

| Layer | Enforcement |
|---|---|
| `routes/lessons.ts` | `assertOnlineExams(context.companyId)` at the top of **every** handler, right after the permission check. Lessons are part of the feature, not a separate one. |
| `routes/exams.ts` | Only the online paths: `create`/`update` when `isOnline` is set (a gated tenant asking for an online exam gets the 403), `attempts`, `regenerateCode`, `resetAttempt`. Offline exams and homework are untouched — no existing tenant can notice this feature landing. |
| `routes/sessions.ts` | The `lessonId` field is ignored (not rejected) for a gated tenant, so the sessions API keeps its shape. |
| `routes/student-exams.ts` (§3) | Enforced inside `extractStudentContext`, so it is re-checked on **every** student request rather than only at login — switching a tenant off stops papers mid-flight instead of at the next sign-in. |
| `routes/public-students.ts` | **Untouched.** The public QR profile never gains an exam-sitting affordance — it keeps showing marks, which it already does through `exam_results`. Nothing to gate. |
| Login payload | `routes/auth.ts` — **five** query sites read the company feature columns, not two: three in `findUserByIdentifier`, one in `verifyEmail`, one in `profile`. All five get `c.online_exams_enabled as company_online_exams`, each with `ensureOnlineExamsColumn()` beside the existing `ensureQrCardSchema()`/`ensureVerticalColumn()` calls (a login must never 500 on a DB that predates the column). `buildSafeUser` is the single mapping point → `onlineExamsEnabled`. Add the field to `SafeUser` in `shared/interfaces/user.interface.ts` and `SafeUserSchema` in `contract.ts` — **not** to `RegisterDto`, the other place `qrCardsEnabled` appears: this is not a signup choice. |
| `routes/student-auth.ts` (§0.5) | Card claim, password reset **and** login all check the flag on the student's company. A student of a gated tenant cannot even create portal credentials, so the portal is dark for them end to end. |
| Frontend | `AuthService.canUseOnlineExams()` → `currentUser()?.onlineExamsEnabled === true`, sitting with `canUseQrCards()` at `auth.service.ts:298`. It hides the Lessons nav entry and the exam form's "Online exam" toggle; a new `onlineExamsGuard` in `core/guards/permission.guard.ts` (copy `qrPoolGuard`) blocks the `/lessons` URL. **Do not** admit `isDebugUser()` here the way `canSeeQrCardPool` does — showing the page to a login whose tenant lacks the flag just produces a screen that 403s. |

The portal itself needs no client-side gate: every one of its endpoints refuses a gated tenant, so a
student who somehow reaches `exams.netrofit.com` cannot get past the card scan.

### Turning it on for the test tenant

No code change — it is data. The vendor's two tenants (from `VENDOR_TEST_COMPANIES`) are
`07d91513-9a21-478c-ba46-4a8d6aa84150` (**Karim**, academy) and
`b6420df6-74fc-4d9d-ab56-78106b376f06` (**netrofit**, teacher):

```sql
UPDATE companies SET online_exams_enabled = true, updated_at = NOW()
 WHERE id = '07d91513-9a21-478c-ba46-4a8d6aa84150';   -- Karim (academy) only
```

Two things to know when testing:

- **The flag is read at login.** Flip it and the signed-in session still says no until the user
  re-authenticates or something calls `AuthService.refreshUser()` (`auth.service.ts:184`, which exists
  for exactly this — plan-driven UI updating in place). Simplest is to sign out and back in. Note
  `refreshUser` swallows its own errors, so it fails silently if `GET /api/auth/profile` is unhappy.
- **Switching it back off is immediate and blunt**: new starts are refused and in-progress attempts
  start 404-ing on their next autosave. Acceptable for a test tenant; do not toggle a tenant off while
  someone is mid-paper.

### The admin-console toggle — part of phase 0, not an afterthought

The flag is switched per tenant from the owner's console at **`dione.netrofit.com`**, exactly like the
QR-card pool. Four edits, mirroring `setQrCardsEnabled` end to end:

| File | Change |
|---|---|
| `aws/lambda/api/src/routes/admin-secret.ts` | `setOnlineExamsEnabled` — `POST /api/karim-admin-secret/companies/:companyId/online-exams { enabled }`, a copy of `setQrCardsEnabled` (line 531): `ensureOnlineExamsColumn()`, 404 on unknown company, `UPDATE companies SET online_exams_enabled = $2`. Also add `c.online_exams_enabled AS online_exams_enabled` to the companies list query (line 51, beside `sms_activated`) so the console can render current state. |
| `aws/lambda/api/src/contract.ts` | The route + `online_exams_enabled: z.boolean()` on the companies-list row schema (~line 6110 / 6421, where `sms_activated` already sits). |
| `admin/src/app/subscriptions.service.ts` | `setOnlineExams(companyId, enabled)` + the field on the row interface (line 20 is where `sms_activated` lives). |
| `admin/src/app/companies/companies-page.component.ts` | An **Enable/Disable** button in the per-company row, modelled on the QR-cards button at ~line 168 (`{{ q.qr_cards_enabled ? 'Disable' : 'Enable' }}`), with the same optimistic-signal pattern at ~line 702. |

The console is a public hostname but not a public tool — everything behind it sits behind the
`admin-portal.ts` sign-in, so no new exposure. `admin/` is built and deployed separately from the tenant
app (`NetrofitAdminStack-prod`); a toggle change means redeploying the admin app, not the API.

The raw SQL stays the escape hatch if the console is mid-deploy:

```sql
UPDATE companies SET online_exams_enabled = true, updated_at = NOW() WHERE id = '<company-id>';
```

---

## 0.5 The student portal — `exams.netrofit.com`

Students do not sign into the staff app and never see it. They get their own site.

```
exams.netrofit.com
  │
  ├─ first visit ──> [ Scan your card ]  ──camera──> qr_token
  │                        │
  │                        ├─ no credentials yet ──> set username (or phone) + password ──> signed in
  │                        └─ credentials exist   ──> RESET: set a new password       ──> signed in
  │
  └─ returning  ──> [ username / phone + password ]  ──> signed in
                          │
                          └─> My exams · sit a paper · my results
```

### 0.5.1 Why a separate Angular app (`student-portal/`)

The repo already ships four separate front-ends — `frontend/` (staff), `landing/`, `admin/`, `cards/` —
so this is the established shape, and `admin/` is the template to copy for build + deploy.

The alternative, serving the existing `frontend/` on the subdomain and locking students to `/p/**`
routes, is **rejected**: it ships the entire staff bundle, the staff `AuthService`, the permission
machinery and every lazy route manifest to students, and one routing mistake then exposes a staff screen.
A student app that contains no staff code cannot leak staff code.

### 0.5.2 Hosting — one new CDK stack, no CORS change

`LandingStack` is already the reusable "private S3 + CloudFront + ACM + Route53 + same-origin `/api/*`
proxy" construct. Add a fourth instantiation in `aws/bin/core.ts`, copying the
`NetrofitAdminStack-prod` block verbatim and changing three things:

```ts
new LandingStack(app, `NetrofitExamsStack-prod`, {
  domainName: 'exams.netrofit.com',
  wwwDomain: null,                    // no www for a portal students reach by typing the name
  sourcePath: path.resolve(__dirname, '../../student-portal/dist/student-portal/browser'),
  apiProxy: {                         // same-origin /api/* — so NO CORS entry is needed
    originDomain: 'xnbgr057y1.execute-api.eu-west-1.amazonaws.com',
    pathPattern: '/api/*',
    originPath: '/prod',
  },
  hostedZoneId: netrofitZoneId,
  certValidationInZone: true,         // brand-new stack, so it may issue its own cert
  env: { account, region: 'us-east-1' },
  description: 'Netrofit Student Exam Portal (prod)',
  tags: { Environment: 'prod', Application: 'NetrofitStudentPortal', ManagedBy: 'CDK' },
});
```

Three gotchas the stack file documents, all of which apply here:
- **`certValidationInZone: true` is only ever safe on a brand-new stack** — it changes a CloudFormation
  property that *replaces* an already-issued certificate. This is a new stack, so it is correct here and
  must not be added to the three older ones.
- **`hostedZoneId` makes CDK create the A/AAAA records**, and the deploy fails with "record already
  exists" if someone has already pointed `exams.netrofit.com` somewhere by hand. Delete those first.
- The `apiProxy` behaviour is what keeps the API same-origin, so **`core-stack.ts`'s CORS
  `allowOrigins` needs no new entry** (line ~437 explains why the console needed none either). If the
  portal is ever pointed at the API host directly, that changes — don't.

Local dev: mirror `admin/`'s proxy setup so `ng serve` on its own port reaches the API.

### 0.5.3 Student credentials — `student_auth`, never on `students`

`routes/students.ts` reads `SELECT s.*` and `SELECT * FROM students` in seven places (446, 485, 517,
573, 610, 650, 687). A `password_hash` column on `students` would therefore be serialised into staff API
responses sooner or later. So credentials live in **their own table**:

```sql
CREATE TABLE IF NOT EXISTS student_auth (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id    UUID NOT NULL UNIQUE REFERENCES students(id)  ON DELETE CASCADE,
    company_id    UUID NOT NULL        REFERENCES companies(id) ON DELETE CASCADE,
    -- What the student types to sign in. A phone number IS a valid username --
    -- "username or phone" is one field, not two, so there is one unique index and
    -- one lookup. Stored lower-cased; anything phone-shaped is put through the
    -- existing normalizePhone() from routes/auth.ts first, so 01001234567 and
    -- +201001234567 can't become two accounts.
    username      VARCHAR(60)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,       -- bcryptjs, cost 10, as everywhere else
    -- Lockout, so a guessable student username isn't a free brute-force target.
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until  TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    -- Audit of the card scans that created and last reset this credential. The
    -- teacher sees these: an unexpected reset is the only visible symptom of a
    -- lost or borrowed card.
    claimed_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reset_at      TIMESTAMP WITH TIME ZONE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- GLOBALLY unique, not per company: the portal is one hostname with one login
-- form, so "ahmed" has to resolve to exactly one student. Collisions are handled
-- at claim time ("that name is taken, pick another"), which is why the student
-- chooses the name rather than being assigned one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_auth_username ON student_auth(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_student_auth_company ON student_auth(company_id);
```

### 0.5.4 `routes/student-auth.ts` (new) — claim, reset, login

Unauthenticated except where noted, `enforceByIp` first, generic errors throughout.

| Route | Body | Behaviour |
|---|---|---|
| `POST /api/student-auth/claim-start` | `{ qrToken }` | Resolve the card through the **existing** `qrStudentMatchPublic` helper (`routes/qr-cards.ts`) so paid-QR activation and expiry rules stay in one place, then check the §0 flag on that student's company. Returns the student's **name** (so they can confirm it is their card), whether credentials already exist, and a **claim ticket**: a JWT with `typ: 'STUDENT_CLAIM'`, `sub: studentId`, **TTL 10 minutes**. The raw `qr_token` is not kept in the SPA while a password is typed, and the ticket cannot be replayed tomorrow. |
| `POST /api/student-auth/claim-finish` | `{ claimTicket, username, password }` | Verifies the ticket, validates the username (3–60 chars, or a normalisable phone) and password (min 8), then **upserts** `student_auth` — insert on first claim, `password_hash` + `reset_at` update if a row exists. **This is both "set my password" and "reset my password": one scan, one endpoint.** Username already taken → `409`. Returns a student session token. |
| `POST /api/student-auth/login` | `{ identifier, password }` | Looks up `LOWER(username)` (phone-normalising a phone-shaped identifier), `bcrypt.compare`, checks `locked_until`, checks the §0 flag, bumps `failed_attempts` on a miss and locks for 15 min after 10. A miss always answers the same generic `401`, and it runs a dummy `bcrypt.compare` when no row exists so a wrong username and a wrong password take the same time (`admin-portal.ts:403` does exactly this). |
| `GET /api/student-auth/me` | — | Authenticated. Name, username, company/branch names, `lastLoginAt`. |
| `POST /api/student-auth/change-password` | `{ currentPassword, newPassword }` | Authenticated. For a student who remembers the old one and has no card to hand. |

New rate limits in `middleware/rate-limit.ts`, mirroring `AUTH_IP`/`AUTH_EMAIL`:

```ts
STUDENT_CLAIM_IP:      { name: 'student-claim:ip',    limit: 20, windowMs: 15 * 60_000 },
STUDENT_LOGIN_IP:      { name: 'student-login:ip',    limit: 60, windowMs: 15 * 60_000 },
STUDENT_LOGIN_IDENT:   { name: 'student-login:ident', limit: 20, windowMs: 15 * 60_000 },
```

### 0.5.5 The student session token — the one thing that must not be got wrong

Student tokens are signed with the **same secret** as staff tokens, which is how `admin-portal.ts:107`
already handles a second audience: carry a `typ` marker and check it on every request.

```ts
// typ marks the audience. Deliberately NO `role` and NO `permissions` claim —
// nothing a student token carries should look like staff authority.
interface StudentTokenPayload { sub: string; companyId: string; typ: 'student'; }
const STUDENT_TOKEN_TTL = '12h';   // staff tokens last a year; a shared phone should not
```

**The asymmetry that bites.** The admin portal is safe in the reverse direction for free, because portal
tokens have no `companyId` and `extractTenantContext` rejects a token without one (it is the *only*
claim it checks — `tenant-isolation.ts`). **A student token must carry `companyId`** for tenant scoping,
so it would sail straight through `extractTenantContext` and into staff endpoints, where `role` and
`permissions` are read off the token.

Two changes, both required:

1. **`extractTenantContext` must reject any token carrying a `typ` claim** — one condition beside the
   existing `companyId` check. This is what stops a student token being a staff token, and it hardens the
   portal case at the same time.
2. **`extractStudentContext(authHeader)`** (new, in `middleware/student-context.ts`) requires
   `typ === 'student'`, loads the student, re-checks `students.is_active` and the §0 company flag on
   every request, and returns `{ studentId, companyId }`. It must never call `checkGranularPermission`;
   students have no RBAC row and never will.

A student token grants exactly one thing: the student endpoints in §3, for that one student.

---

## 1. Data model

New: `lessons`, `lesson_questions`, `lesson_question_options`, `exam_lessons`, `exam_attempts`,
`exam_attempt_questions`, and `student_auth` (§0.5.3). Altered: `sessions` (+`lesson_id`), `exams`
(+online config columns), `companies` (+`online_exams_enabled`, §0).

Everything goes in **`aws/sql/migrations/100_lessons_and_online_exams.sql`** (099 is the highest
existing number; note 042 and 060 are already duplicated, so 100 is the next genuinely free one), is
mirrored into **`aws/sql/schema.sql`** for fresh installs, and is applied **idempotently at runtime**
by `ensureLessonSchema()` in the new `routes/lessons.ts` plus additions to `ensureExamTables()` in
`routes/exams.ts` — the codebase convention (see `ensureAttendanceMagicColumns` in `routes/sessions.ts:31`).

### 1.1 `lessons` — the curriculum of a course

```sql
CREATE TABLE IF NOT EXISTS lessons (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,   -- denormalised from the course
    course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    -- Position in the course. Drives "all lessons up to here" and the ordering of
    -- the lesson picker. Not unique on purpose: reordering would fight a unique
    -- index, and two lessons sharing a position is a display quirk, not corruption.
    order_index INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT true,                     -- soft-delete
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lessons_company ON lessons(company_id);
CREATE INDEX IF NOT EXISTS idx_lessons_course  ON lessons(course_id, order_index);
```

### 1.2 `sessions.lesson_id` — which lesson a class actually covered

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_lesson ON sessions(lesson_id);
```

`ON DELETE SET NULL` — deleting a lesson must never delete a taught session. Nullable and optional:
existing sessions have no lesson, and a teacher who never tags sessions still gets the manual lesson
picker (only the "everything taught so far" shortcut goes quiet).

### 1.3 `lesson_questions` + `lesson_question_options` — the MCQ bank

```sql
CREATE TABLE IF NOT EXISTS lesson_questions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    lesson_id     UUID NOT NULL REFERENCES lessons(id)   ON DELETE CASCADE,
    course_id     UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,  -- denorm, for pool queries
    question_text TEXT NOT NULL,
    -- MCQ is the only type in v1; the column exists so adding TRUE_FALSE /
    -- MULTI / WRITTEN later is a CHECK change, not a table change.
    question_type VARCHAR(16) NOT NULL DEFAULT 'MCQ' CHECK (question_type IN ('MCQ')),
    explanation   TEXT,                                  -- optional, shown in the answer review
    is_active     BOOLEAN NOT NULL DEFAULT true,          -- soft-delete: retires a question from future draws
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lesson_questions_lesson  ON lesson_questions(lesson_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lesson_questions_company ON lesson_questions(company_id);

CREATE TABLE IF NOT EXISTS lesson_question_options (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id UUID NOT NULL REFERENCES lesson_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    is_correct  BOOLEAN NOT NULL DEFAULT false,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lesson_question_options_q ON lesson_question_options(question_id, order_index);
```

Options are a **table, not JSONB**: they need stable ids so a shuffled paper can record *which* option
the student picked, and 2–6 rows per question is nothing. "Exactly one `is_correct`" is enforced in the
API (a question is always written as a whole — text + full option list in one transaction), not by a
constraint, because a partial-update path that trips a DB CHECK mid-write is worse than a 400.

### 1.4 `exams` — online config columns (same table as offline exams and homework)

```sql
ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_online       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS question_count  INTEGER;      -- how many to draw
ALTER TABLE exams ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;     -- per-student clock, from their start
ALTER TABLE exams ADD COLUMN IF NOT EXISTS opens_at        TIMESTAMP WITH TIME ZONE;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS closes_at       TIMESTAMP WITH TIME ZONE;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS access_code     VARCHAR(12);  -- short, case-insensitive
ALTER TABLE exams ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN NOT NULL DEFAULT true;
-- Answer review after submit. Off = score only (stops the key leaking to students sitting later).
ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_answers    BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_exams_online ON exams(company_id, is_online);
```

Reused as-is from the existing table: `course_id` (which course), `class_id` (null = every class of the
course sits it; set = only that class), `exam_date`, `max_grade` (set to `question_count` on save, so
"out of" displays everywhere already work), `status`, `is_active`, `is_homework` (an online exam can be
homework — the flag only decides which list it appears in).

### 1.5 `exam_lessons` — which lessons an exam draws from

```sql
CREATE TABLE IF NOT EXISTS exam_lessons (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id    UUID NOT NULL REFERENCES exams(id)   ON DELETE CASCADE,
    lesson_id  UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_lessons_exam ON exam_lessons(exam_id);
```

"All previous lessons" is resolved **at save time**, not at sit time: the teacher's shortcut expands to
explicit rows here. An exam's scope must not silently grow because another session was taught after it
was created.

### 1.6 `exam_attempts` — one sitting per student

```sql
CREATE TABLE IF NOT EXISTS exam_attempts (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id      UUID NOT NULL REFERENCES exams(id)     ON DELETE CASCADE,
    company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    student_id   UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
    -- No attempt_token. An earlier draft addressed a running paper by an
    -- unguessable token because there was no student login; now the student's
    -- session token identifies them, the attempt is found by (exam, student), and
    -- there is no shareable link to a paper at all.
    status       VARCHAR(16) NOT NULL DEFAULT 'IN_PROGRESS'
                   CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED')),
    started_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Server-owned deadline = min(started_at + duration, exam.closes_at). The client
    -- timer is decoration; this is what grading trusts.
    expires_at   TIMESTAMP WITH TIME ZONE,
    submitted_at TIMESTAMP WITH TIME ZONE,
    score        INTEGER,     -- correct answers, filled on submit/expiry
    total        INTEGER,      -- questions on this paper (== exams.question_count at start)
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, student_id)          -- one attempt; signing back in resumes it
);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam    ON exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON exam_attempts(student_id);
```

### 1.7 `exam_attempt_questions` — the frozen paper + the answers

```sql
CREATE TABLE IF NOT EXISTS exam_attempt_questions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attempt_id  UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    -- Provenance, for "which questions do students keep failing" later. SET NULL so
    -- deleting a question never deletes a sat paper.
    question_id UUID REFERENCES lesson_questions(id) ON DELETE SET NULL,
    lesson_id   UUID REFERENCES lessons(id)          ON DELETE SET NULL,
    order_index INTEGER NOT NULL,                    -- this student's question order
    -- SNAPSHOT. The paper is immutable once drawn: the question text and the option
    -- list (already in this student's shuffled order, each with a stable local id and
    -- the correct flag) are copied in at start. Editing or retiring the bank question
    -- afterwards cannot rewrite what a student was actually asked.
    question_text TEXT NOT NULL,
    options     JSONB NOT NULL,   -- [{ id, text, isCorrect }] in presentation order
    selected_option_id UUID,      -- null = unanswered
    is_correct  BOOLEAN,          -- null until graded
    answered_at TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (attempt_id, order_index)
);
CREATE INDEX IF NOT EXISTS idx_eaq_attempt  ON exam_attempt_questions(attempt_id, order_index);
CREATE INDEX IF NOT EXISTS idx_eaq_question ON exam_attempt_questions(question_id);
```

The one place `isCorrect` is stored denormalised — it is **never serialised to the student API** before
submit. See §3.4.

### 1.8 Triggers (codebase convention)

`update_updated_at_column()` triggers on `lessons`, `lesson_questions`, `exam_attempts`
(`DROP TRIGGER IF EXISTS` first, like `035_exams.sql`).

---

## 2. Backend — teacher side (`aws/lambda/api/src`)

### 2.1 `routes/lessons.ts` (new) — lessons + question bank

Mirrors `routes/events.ts` in shape. Every handler: `extractTenantContext(headers.authorization)` →
`checkGranularPermission(context, 'academy', <action>)` → **`assertOnlineExams(context.companyId)`
(§0)** → `canAccessBranch(context, branchId)`. Uses
`query`/`queryOne`/`insert`/`update` from `db/connection`, `apiError`/`mapThrownError` from
`utils/api-error`, and calls `ensureLessonSchema()` at the top of every write handler.

| Handler | Route | Notes |
|---|---|---|
| `list` | `GET /api/lessons?courseId&branchId` | `academy:read`. `appendBranchSqlFilter` for non-global-admins. Returns each lesson with `questionCount` (`(SELECT COUNT(*) FROM lesson_questions q WHERE q.lesson_id = l.id AND q.is_active)`), ordered by `order_index, created_at`. |
| `create` | `POST /api/lessons` | `academy:write`. Body `{ courseId, name, description?, orderIndex? }`. Resolve the course company-scoped to copy `branch_id` and check branch access (same block as `exams.create`). `orderIndex` defaults to `MAX(order_index)+1` for the course. |
| `getById` | `GET /api/lessons/:id` | `academy:read`. |
| `update` | `PATCH /api/lessons/:id` | `academy:write`. `{ name?, description?, orderIndex?, isActive? }`. |
| `delete` | `DELETE /api/lessons/:id` | `academy:delete`. Soft-delete (`is_active = false`) — hard delete would cascade the question bank and orphan `exam_lessons`. |
| `reorder` | `POST /api/lessons/reorder` | `academy:write`. Body `{ courseId, lessonIds: string[] }` → rewrites `order_index` in one transaction. Drag-and-drop in the UI. |
| `listQuestions` | `GET /api/lessons/:id/questions` | `academy:read`. Question + its options (correct flag **included** — this is the authenticated teacher view). |
| `createQuestion` | `POST /api/lessons/:id/questions` | `academy:write`. Body `{ questionText, explanation?, options: [{ optionText, isCorrect }] }`. Validates 2–6 options and **exactly one** `isCorrect` → else `400 ERRORS.LESSONS.ONE_CORRECT_REQUIRED`. Inserts question + options in one transaction. |
| `updateQuestion` | `PATCH /api/lessons/:lessonId/questions/:questionId` | `academy:write`. Whole-question write: same validation, replaces the option rows. Frozen papers are unaffected (§1.7). |
| `deleteQuestion` | `DELETE /api/lessons/:lessonId/questions/:questionId` | `academy:delete`. Soft-delete → drops out of future draws, keeps history. |

`export async function lessonPoolSize(lessonIds: string[], companyId): Promise<number>` lives here too
— the exam form and `exams.create` both need "how many questions are available".

### 2.2 `routes/sessions.ts` — tag a session with its lesson

- `ensureLessonSessionColumn()`: the `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lesson_id` from §1.2
  (same shape as `ensureFreeSessionSchema` at `sessions.ts:117`).
- Accept `lessonId` in `create`/`update` and return `lessonId` + `lessonName` from `list`/`getById`
  (left join `lessons`). Validate the lesson belongs to the session's class's **course**, else
  `400 ERRORS.SESSIONS.LESSON_COURSE_MISMATCH`.
- `export async function lessonsTaughtIn(classId, companyId): Promise<string[]>` — distinct
  `sessions.lesson_id` for that class where the session has started, ordered by `lessons.order_index`.
  This is what the exam form's **"all lessons taught so far"** button calls.

### 2.3 `routes/exams.ts` — online exam definition

Extend, don't fork. Additions:

- **`ensureExamTables()`**: append the §1.4 `ALTER TABLE exams` statements and the
  `CREATE TABLE IF NOT EXISTS` blocks for `exam_lessons`, `exam_attempts`, `exam_attempt_questions`
  (the module already does exactly this for homework, `exams.ts:96`).
- **`mapExamFromDB`**: carry `isOnline`, `questionCount`, `durationMinutes`, `opensAt`, `closesAt`,
  `accessCode`, `shuffleOptions`, `showAnswers`, plus computed `lessonIds: string[]` and
  `attemptCounts: { started, submitted }` on `getById`.
- **`create` / `update`** (`academy:write`): accept `isOnline`, the config fields, and
  `lessonIds: string[]`. When `isOnline`:
  - `lessonIds` non-empty and every lesson must belong to `courseId` → `400 ERRORS.EXAMS.LESSON_COURSE_MISMATCH`.
  - `question_count >= 1` and `<= lessonPoolSize(lessonIds)` → `400 ERRORS.EXAMS.NOT_ENOUGH_QUESTIONS`
    (message carries the pool size so the UI can say "only 14 questions available").
  - `max_grade = question_count` — makes every existing "out of" display correct for free.
  - `access_code`: generated if absent — 6 chars from an unambiguous alphabet (no `0/O/1/I`), stored
    upper-case, compared case-insensitively.
  - `closes_at > opens_at`; `duration_minutes >= 1`.
  - Replace `exam_lessons` rows on update. **Refuse to change `lessonIds`/`questionCount` once any
    attempt exists** → `409 ERRORS.EXAMS.ALREADY_STARTED` (the window, name and date stay editable).
- **`attempts`** — `GET /api/exams/:id/attempts`, `academy:read`. The monitoring list: student name +
  code, status, `startedAt`, `submittedAt`, `score`/`total`, `answeredCount`, and `expiresAt` so the UI
  can show a live countdown. Plus the not-started students, from the same enrolment union `results` uses.
- **`regenerateCode`** — `POST /api/exams/:id/regenerate-code`, `academy:write`. New code; in-progress
  attempts keep running (the code gates starting, not continuing).
- **`resetAttempt`** — `DELETE /api/exams/:id/attempts/:studentId`, `academy:delete`. Deletes the attempt
  (paper cascades) **and** its `exam_results` row, so a student who lost their connection mid-paper can
  be let back in. The one escape hatch for a one-attempt-per-student rule.
- **`results`** (existing) needs no change: the auto-graded mark is a normal `exam_results` row, so the
  roster, `markAbsent`, `markRemainingAbsent`, `sendTelegramResults` and `sendExamResultsSms` all work
  untouched.
- **`mapStudentExamRow`**: force `isRating = false` when `is_online` — a 5-question online exam in a
  RATING-mode company would otherwise be relabelled "Excellent" instead of showing 5/5.

### 2.4 Grading — `db/exam-grading.ts` (new, shared by the public submit and the expiry sweep)

```ts
// Grades an attempt from its frozen paper and publishes the mark.
export async function gradeAttempt(attemptId: string, reason: 'SUBMIT' | 'EXPIRY') {
  // 1. is_correct = (selected_option_id == the option flagged correct in options JSONB);
  //    unanswered counts as wrong — silence is not credit.
  // 2. score = COUNT(is_correct), total = COUNT(*)
  // 3. attempt: status = SUBMITTED | EXPIRED, submitted_at = NOW()
  // 4. publish into the SAME feed as offline exams — grade is VARCHAR(50):
  //    INSERT INTO exam_results (exam_id, company_id, course_id, student_id, grade, is_absent)
  //    VALUES ($1,$2,$3,$4,$5,false)
  //    ON CONFLICT (exam_id, student_id)
  //    DO UPDATE SET grade = EXCLUDED.grade, is_absent = false, recorded_at = NOW(), updated_at = NOW()
}
```

An **EXPIRED** attempt is still graded — the student sat it, they just ran out of clock. Steps 1–4 run in
one transaction, and grading is idempotent (a double submit recomputes the same numbers).

---

## 3. Backend — student side (authenticated, `routes/student-exams.ts`)

All of these live in **`routes/student-exams.ts`** (new). Every handler starts with
**`extractStudentContext(headers.authorization)`** (§0.5.5) — which itself re-checks `students.is_active`
and the §0 company flag — and then scopes everything to that one `studentId`. No
`extractTenantContext`, no `checkGranularPermission`: a student is not a user of the tenant.

The exam id in the path is never trusted on its own; it is always resolved **within the student's
company** and checked against their enrolments, so one tenant's student cannot address another's exam.

New rate limits in `middleware/rate-limit.ts` (on top of §0.5.4's auth limits):

```ts
// Answer autosave — one call per tap, so it has to be roomy.
STUDENT_EXAM_ANSWER: { name: 'student-exam-answer:student', limit: 600, windowMs: 15 * 60_000 },
```

### 3.1 `GET /api/student/exams` — what can I sit?

Lists online exams for the signed-in student where:
- `is_online AND is_active AND (opens_at IS NULL OR opens_at <= NOW()) AND (closes_at IS NULL OR closes_at >= NOW())`,
- the student is **enrolled in the exam's course** — the `enrollments ∪ master_class_enrollments`
  union `exams.results` already uses (status not `DROPPED`), and
- if `exams.class_id` is set, the student is in **that** class.

Returns `{ examId, name, courseName, questionCount, durationMinutes, closesAt, requiresCode, state }`
where `state` is `AVAILABLE | IN_PROGRESS | DONE` (from `exam_attempts`), plus `score`/`total` when
`DONE`. **Never the access code itself** — only whether one is needed.

A second endpoint `GET /api/student/results` returns their finished marks (reusing
`studentExamFeedSql`/`mapStudentExamRow` from `routes/exams.ts`), so the portal has a results tab
without a second source of truth.

### 3.2 `POST /api/student/exams/:examId/start` — begin or resume

Body `{ accessCode? }`.

1. Resolve the exam **within the student's company**; 404 otherwise.
2. Window open? else `403 ERRORS.EXAMS.WINDOW_CLOSED`. Enrolled (§3.1 rule)? else `403 ERRORS.EXAMS.NOT_ENROLLED`.
3. If the exam has an `access_code`, it must match case-insensitively → else `403 ERRORS.EXAMS.BAD_CODE`.
   **The code is now optional** (nullable): identity is established by the login, so the code's only
   remaining job is stopping a student starting before the teacher says go. Leave it blank and the exam
   opens on its window alone.
4. Existing attempt?
   - `IN_PROGRESS` and `expires_at > NOW()` → **resume**: return the same paper and answers so far.
   - `IN_PROGRESS` and expired → `gradeAttempt(id, 'EXPIRY')`, then return the finished state.
   - `SUBMITTED`/`EXPIRED` → `409 ERRORS.EXAMS.ALREADY_SUBMITTED` (with the score, so the page can just
     show the result).
5. Otherwise **draw the paper in one transaction**:
   ```sql
   SELECT q.id, q.lesson_id, q.question_text
     FROM lesson_questions q
     JOIN exam_lessons el ON el.lesson_id = q.lesson_id
    WHERE el.exam_id = $1 AND q.is_active = true AND q.company_id = $2
    ORDER BY random()
    LIMIT $3                      -- exams.question_count
   ```
   Fewer rows than `question_count` (questions retired since the exam was saved) → draw what exists and
   set `total` to that; the mark stays honest because `total` is per-attempt. Then insert
   `exam_attempts` (`expires_at = LEAST(NOW() + duration, closes_at)`) and one
   `exam_attempt_questions` row per drawn question, snapshotting the text and the option list — shuffled
   when `shuffle_options`, each option given a fresh local UUID.
6. Return `{ expiresAt, serverNow, exam: { name, questionCount, durationMinutes }, questions: [{ id, questionText, options: [{ id, text }] }] }`.

### 3.3 Sitting the paper

Every route resolves the attempt as **"the signed-in student's attempt at this exam"** — there is no
attempt id or token in the URL to get wrong or to share.

| Route | Behaviour |
|---|---|
| `GET /api/student/exams/:examId/attempt` | Resume: the paper, the saved answers, `expiresAt`, `serverNow` (the client clock is not trusted). Auto-grades first if already expired. |
| `POST /api/student/exams/:examId/answer` | Body `{ questionId, optionId }` (the *attempt-question* id and the *local* option id). Autosave, idempotent — re-answering overwrites. Rejects if the attempt is not `IN_PROGRESS` (`409`) or `expires_at` has passed (auto-grade, then `409 ERRORS.EXAMS.TIME_UP`). `STUDENT_EXAM_ANSWER` rate limit, keyed by student. |
| `POST /api/student/exams/:examId/submit` | `gradeAttempt(id, 'SUBMIT')` → `{ score, total, questions? }`. The per-question review (chosen option, correct option, `explanation`) is included **only if `exams.show_answers`**. |

### 3.4 Security notes — the short list that must not be got wrong

- **A student token must never be usable as a staff token.** `extractTenantContext` rejects any token
  carrying a `typ` claim; student tokens carry `typ: 'student'` and no `role`/`permissions`. §0.5.5 is
  the full argument — this is the highest-consequence line in the plan.
- **`isCorrect` never crosses the wire before submit.** The student serialiser maps
  `options → { id, text }` only. One mapping function, used by start/resume/answer; the review path is
  the *only* place the flag is emitted, and only when `show_answers` is on.
- **The clock is server-side.** `expires_at` decides; the client countdown is cosmetic. Every write
  re-checks it.
- **Nothing is addressable by a shareable token.** An attempt is reached only through the student's own
  session, so there is no link to forward to a classmate.
- **One attempt per student** via `UNIQUE (exam_id, student_id)`; the reset is a deliberate teacher action.
- **Possession of the card is a password reset.** That is the trade for a recovery flow that needs no
  email, no SMS and no staff involvement — and it is a real one: whoever holds the card can take over the
  account. Mitigations: `student_auth.reset_at` is stamped and shown to the teacher, the teacher can
  revoke credentials outright (§4.5), and a lost card can be unlinked/reissued through the existing
  QR-card tooling, which invalidates the old token. Optionally notify the parent over Telegram on every
  reset (`sendExamResultNotifications` is the model) — cheap, and it makes a silent takeover loud.
- **Still not proctored.** A student can sit the paper anywhere, with anyone beside them, on any device.
  The login, the window, the one-attempt rule and the per-student random draw are what exists. Real
  proctoring is out of scope and always will be for a phone-based portal.

### 3.5 Expiry sweep

An attempt abandoned mid-paper (browser closed) sits `IN_PROGRESS` forever, so its mark never lands.
Two cheap catches, no scheduler:
- `exams.attempts` (teacher monitor) and the student `start`/`attempt` reads grade any expired attempt
  they touch.
- `exams.markRemainingAbsent` (already shipped) covers whoever never started, once the window closes.

If a background sweep is wanted later, `routes/migrations.ts`-style maintenance endpoints are the
existing pattern.

### 3.6 `contract.ts` + `index.ts`

- Schemas: `LessonSchema`, `CreateLessonSchema`, `UpdateLessonSchema`, `LessonQuestionSchema` (with
  `options`), `CreateLessonQuestionSchema`, `ReorderLessonsSchema`, `ExamAttemptRowSchema`,
  `StudentExamListItemSchema`, `StudentAttemptSchema` (paper **without** `isCorrect`),
  `StudentAttemptResultSchema`, and the §0.5.4 auth schemas (`ClaimStartSchema`, `ClaimFinishSchema`,
  `StudentLoginSchema`, `StudentSessionSchema`). Extend `CreateExamSchema`/`ExamSchema` with the §1.4
  fields + `lessonIds`.
- New contract objects `lessons`, `studentAuth`, `studentExams`; new entries under `exams`
  (`attempts`, `regenerateCode`, `resetAttempt`, `studentCredentials`, `revokeStudentCredentials`).
- **Route order matters** — static paths before `/:id`, as the comment at `contract.ts:3039` says.
  `/api/lessons/reorder` must be registered before `/api/lessons/:id`.
- `index.ts`: import and register `lessons`, `studentAuth` and `studentExams` blocks (same shape as
  `exams`/`publicStudents`).
- The `publicStudents.profile` response is **unchanged** — the QR profile keeps showing exam *results*
  (it already does) and does not offer to start an exam. Sitting a paper lives on the portal, behind a
  login; the parent-facing QR page stays a read-only summary.
- Declaration emit is off in this package, so new routes no longer risk TS7056 (see
  `contract-ts-route-ceiling`).

---

## 4. Frontend — staff app (`frontend/src/app`); the portal is §4.7

### 4.1 Shared interfaces

- **`shared/interfaces/lesson.interface.ts`** (new): `LessonModel` (`id, companyId, branchId, courseId,
  courseName?, name, description, orderIndex, questionCount?, isActive, createdAt, updatedAt`),
  `LessonCreateDto`, `LessonUpdateDto`, `LessonQuestionModel` (`id, lessonId, questionText, explanation,
  options: LessonQuestionOption[]`), `LessonQuestionOption` (`id?, optionText, isCorrect, orderIndex`).
- **`shared/interfaces/exam.interface.ts`** (extend): `isOnline`, `questionCount`, `durationMinutes`,
  `opensAt`, `closesAt`, `accessCode`, `shuffleOptions`, `showAnswers`, `lessonIds` on `ExamModel` +
  `ExamCreateDto`; new `ExamAttemptRow`, `StudentExamListItem`, `StudentAttempt`,
  `StudentAttemptQuestion`, `StudentAttemptResult`, `StudentCredentialInfo`.
- **`shared/interfaces/session.interface.ts`** (extend): `lessonId`, `lessonName`.
- `shared/` is consumed by both front-ends, so the portal reuses these rather than redeclaring them
  (check how `admin/` handles the import path — if it keeps its own copies, follow that).

### 4.2 Teacher: lessons & question bank — `features/lessons/`

- `services/lesson.service.ts` — `ApiService`-based, like `event.service.ts`: `getAll({courseId})`,
  `getById`, `create`, `update`, `delete`, `reorder`, `getQuestions`, `createQuestion`,
  `updateQuestion`, `deleteQuestion`.
- `lessons.routes.ts` + an entry in `app.routes.ts` next to `exams` (line ~139):
  `{ path: 'lessons', canActivate: [permissionGuard('academy')], data: { breadcrumb: 'BREADCRUMBS.LESSONS' }, loadChildren: … }`.
- **`lesson-list/`** — course picker first (a lesson list is meaningless across courses; auto-selects
  when the tenant has exactly one course), then the ordered lessons of that course with `questionCount`
  per row, create/edit in a dialog, and reordering by **move up/down** rather than drag-and-drop: same
  single `reorder` call, works on a phone, and cannot half-apply. "Add questions" opens the bank
  (phase 2).
- **`lesson-questions/`** (`lessons/:id/questions`) — the bank editor: questions as cards (not a table),
  each showing every option with the correct one ticked green, because "is the answer key right" is what
  a teacher reviews a bank for. Add/edit in a `p-dialog`: question text, 2–6 option inputs, a radio for
  the correct one, optional explanation.
  **The answer key is one form control (`correctIndex`), not a flag per option** — so "exactly one
  correct" cannot be violated in the UI at all, and the server's `validateOptions` is a backstop rather
  than the UX. It starts unset: pre-selecting the first option would let a wrong key through on a fast
  Enter. Removing an option above the marked one shifts the mark with it.
- Nav (`core/layout/layout.component.ts`), Academic group, next to Exams:
  `{ labelKey: 'NAV.LESSONS', icon: 'pi pi-book', routerLink: ['/lessons'], visible: auth.canRead('academy') }`.

### 4.3 Teacher: session → lesson tag

**Shipped** in the **session-attendance header** (`features/rooms/session-attendance/`), beside the
inline session-number edit it copies: a small chip reading the lesson name with a pencil, or "Tag the
lesson covered" when untagged, opening a `p-select` of that course's lessons. Hidden entirely unless
`canUseOnlineExams() && canWrite('academy')`.

The Start dialog was the obvious home and is the wrong one: `prepare`, `autoSchedule` and
`checkinTarget` all create sessions with nobody at the keyboard, so most sessions would never be tagged.
The session's own screen is where the teacher already is when they know which lesson it was.

`sessions.getById` gained `courseId` (the picker needs the course to list its curriculum) and
`lessonName`. This is the input that makes §4.4's "everything taught so far" button meaningful.

### 4.4 Teacher: exam form — `features/exams/exam-form/`

Add an **"Online exam"** `p-toggleswitch`. Off → the form is exactly what ships today. On → reveal:

- **Lessons** — `p-multiselect` of the course's lessons (each showing its question count) **plus** two
  shortcuts: *"All lessons"* and *"All lessons taught so far in this class"* (calls the class's taught
  lessons; disabled with a hint when no class is selected or no session is tagged). Both expand to
  explicit selections the teacher can still edit — the exam stores lesson ids, never a rule.
- **Number of questions** — `p-inputnumber`, with a live *"N questions available in the selected
  lessons"* hint and client-side max, so `ERRORS.EXAMS.NOT_ENOUGH_QUESTIONS` is a fallback.
- **Duration (minutes)**, **Opens at** / **Closes at** (`p-datepicker` with time).
- **Shuffle options** and **Show answers after submit** toggles.
- **Access code** — shown read-only after save with a copy button and a *Regenerate* action.
- `maxGrade` becomes read-only and mirrors the question count.
- Once attempts exist, lock the lesson selection and question count (server returns `409`), with a
  message saying why.

### 4.5 Teacher: exam detail — `features/exams/exam-detail/`

For an online exam, replace the QR-scan grading panel with a **monitor**:
- Header: the access code (large, copyable), the window, "12 of 30 submitted", `p-progressbar`.
- Attempts table: student · status chip (Not started / In progress / Submitted / Expired) · started ·
  submitted · score `17/20` · live remaining time · a *Reset attempt* action (`academy:delete`,
  confirm dialog).
- Keep the existing footer actions: *Mark remaining absent*, *Send results on Telegram/SMS* — they work
  unchanged because the marks are ordinary `exam_results` rows.
- Auto-refresh while the window is open (a `setInterval` poll every ~20s, cleared on destroy).
- Offline exams keep the current screen; the component branches on `exam.isOnline`.

### 4.6 Teacher: student portal credentials

The teacher needs to answer "why can't this student log in?" without touching the database.

- **Student detail** (`features/students/student-detail/`) — a small **Exam portal** row next to the QR
  card block: has credentials yes/no, the username, `lastLoginAt`, `resetAt`, and a **Revoke
  credentials** button (`academy:delete`, confirm dialog) that deletes the `student_auth` row so the
  student can claim again from scratch. Backed by
  `GET /api/exams/students/:studentId/credentials` + `DELETE` of the same.
- The revoke path is also the answer to a **lost card**: revoke, then unlink/reissue the card through the
  existing QR-card tooling, which invalidates the old `qr_token` and with it the old claim route.
- Nowhere in the staff app is a student password readable or settable — staff can only revoke. A teacher
  who could set a student's password could sit their exam.

### 4.7 The student portal app — `student-portal/`

A new, deliberately small Angular app, scaffolded from `admin/` (same build/deploy shape). No PrimeNG
theme weight needed unless it comes free; mobile-first, bilingual EN/AR with RTL like the public QR page.

| Screen | Route | Contents |
|---|---|---|
| Welcome | `/` | Two paths: **Sign in** and **First time? Scan your card**. |
| Scan | `/scan` | `Html5Qrcode` camera scan, reusing the `extractToken()` "/p/s/" URL parsing, the dedup and the beep from `frontend/.../session-attendance.component.ts` — that flow is already proven against these cards. Calls `claim-start`, then shows **"Is this you? — <name>"** before going on, so a mis-scan can't set someone else's password. |
| Set password | `/claim` | Username (or phone) + password + confirm. Reached only with a live claim ticket; the same screen serves a first claim and a reset, with the heading changing. Inline handling of "username taken". |
| Sign in | `/login` | Identifier + password, and a **"Forgot password? Scan your card"** link straight back to `/scan`. |
| My exams | `/exams` | Available / in-progress / done cards: name, course, question count, duration, closes-at; **Start** (with the access-code field only when `requiresCode`), **Continue**, or the score. |
| Sitting | `/exams/:examId/sit` | Sticky header with exam name, "Question 4 of 20", and a countdown driven off `expiresAt` + `serverNow` (never the device clock), red under 2 minutes. One question per screen with big tap targets, Prev/Next, and a dot strip of answered/unanswered. Picking an option autosaves immediately with a small saved/retry indicator. **Submit** behind a confirm dialog naming how many are unanswered. |
| Result | `/exams/:examId/result` | Score, percentage, and — when `showAnswers` — the per-question review. |
| My results | `/results` | Past marks from `GET /api/student/results`. |

- Failure states are **first-class screens, not toasts**: time up (auto-submits, shows the score),
  already submitted, window closed, wrong code, expired claim ticket, locked account, network loss (the
  saved answers are safe — sign back in and continue).
- Auth plumbing: token in `localStorage`, an interceptor that attaches it and routes a `401` back to
  `/login`, and a guard on everything under `/exams`. Tiny and self-contained — none of the staff app's
  `AuthService`, permissions or branch machinery comes along.
- **No camera?** iOS Safari needs a user gesture and HTTPS (CloudFront gives the second). Fallback: the
  teacher can revoke and re-claim on the student's behalf from a scanning device, which is why revoke
  exists. A manual "type the code on your card" path is deliberately *not* offered — a short printed
  serial is far too guessable to be a password-reset factor.
- i18n: the portal carries its own small `en`/`ar` bundle. Do not import the staff app's.

### 4.8 i18n — `frontend/src/assets/i18n/{en,ar}.json` (staff app)

`NAV.LESSONS`, `BREADCRUMBS.LESSONS`, `LESSONS.*` (list/form/questions/options/reorder + validation),
`EXAMS.ONLINE.*` (form labels, access code, monitor, attempt statuses), `STUDENTS.PORTAL.*` (the
credentials row + revoke), and error keys `ERRORS.EXAMS.WINDOW_CLOSED`, `NOT_ENROLLED`, `BAD_CODE`,
`ALREADY_SUBMITTED`, `TIME_UP`, `NOT_ENOUGH_QUESTIONS`, `ALREADY_STARTED`, `LESSON_COURSE_MISMATCH`,
`ERRORS.LESSONS.*`, `ERRORS.STUDENT_AUTH.*`.

---

## 5. Build order

Each phase is independently shippable and useful on its own.

**All phases (0–7) are built:**
- **0 + 1** — migration `100_lessons.sql`, `routes/lessons.ts`, `assertOnlineExams`, the admin-console
  toggle, the Lessons screen, EN/AR strings.
- **2** — migration `101_lesson_questions.sql`, the four question handlers on `routes/lessons.ts`, and
  the Question Bank screen at `/lessons/:id/questions`. The lesson list's question count is the way in.
- **4** — migration `103_online_exams.sql` (the `exams` columns + `exam_lessons`), `resolveOnlineSettings`
  validation, `regenerateCode`, the online section of the exam form, and an "Online" badge on the exam
  list. A teacher can define an online exam; nobody can sit one yet. Two notes: the pool size is summed
  **client-side** from the lesson list (which already carries a count per lesson), so no extra endpoint
  was needed; and `scopeLocked` in the form is declared but nothing sets it until the attempts monitor
  exists — until then the server's 409 is the only thing stopping a scope change after a sitting starts.
- **3** — migration `102_sessions_lesson.sql`, `lessonId` on `sessions.start`/`update`,
  `lessonsTaughtIn` + `GET /api/sessions/lessons-taught?classId=`, and an inline lesson tag in the
  session-attendance header. Tagging lives **there**, not in the Start dialog: most sessions open
  themselves (on the schedule, or when the first student scans in), so nobody is around to be asked at
  creation — the teacher tags it from the lesson's own screen. The gate uses the new boolean
  `isOnlineExamsEnabled`, so a gated tenant's `lessonId` is *ignored, not rejected*, and the sessions API
  keeps one shape for everyone.
- **5** — migration `104_student_auth.sql`, `routes/student-auth.ts` (claim-start / claim-finish /
  login / me / change-password), `middleware/student-context.ts`, **the `typ` rejection in
  `extractTenantContext`**, the four `STUDENT_*` rate-limit buckets, `NetrofitExamsStack-prod` in
  `aws/bin/core.ts`, and the `student-portal/` app (welcome, scan, claim/reset, login, empty exam
  list). Notes against the spec: the portal keeps its **own local types** rather than a new
  `shared/interfaces/student-portal.interface.ts` — `admin/` keeps its own copies, and §4.1 says to
  follow that; a **reset keeps the existing username** (claim-finish ignores the field when a row
  exists — the card proves possession, not the right to rename); phone canonicalisation strips the
  `20` country code as well as the leading zero, or `01…`/`+201…` would mint two accounts; the
  dev server uses a real `proxy.conf.json` (admin has none and its localhost dev is broken by
  design — the portal shouldn't inherit that); and the account **lockout answers distinctly**
  (403 LOCKED) while wrong username / wrong password / gated tenant / deactivated student all share
  one generic timed 401.
- **6** — migration `105_exam_attempts.sql` (+ the two tables appended to `ensureExamTables`),
  `db/exam-grading.ts`, `routes/student-exams.ts` (list / results / start / attempt / answer /
  submit), the `STUDENT_EXAM_ANSWER` bucket, and the portal's exam list, sitting and result screens
  plus a My-results tab off the shared `studentExamFeedSql`. Notes against the spec: a **finished
  attempt answers 409 ALREADY_SUBMITTED with the score in the error's `params`**, and the portal's
  result screen fetches through the (idempotent) **submit** endpoint — "show my result" and
  "submit" are deliberately the same call, so there is no separate result-read to keep consistent;
  `gradeAttempt` never demotes a status or moves `submitted_at` on a re-grade; the sit-time
  enrolment check is the plain enrolment union **without** the substitutes clause the grading side
  has (a substitute may be graded on a class's homework, but a paper is sat by the class it was set
  for); a start race on `UNIQUE (exam_id, student_id)` rolls back the loser and serves the winner's
  paper; and questions that somehow have no options are dropped from the draw with `total` set to
  what was actually dealt.
- **7** — `exams.attempts` (the monitor list, which also runs the §3.5 expiry sweep on every
  read), `resetAttempt` (deletes the attempt AND the exam_results row in one transaction),
  `studentCredentials` + `revokeStudentCredentials`, `attemptCounts` on `exams.getById`, the
  monitor panel on exam detail (replaces the QR grading panel when `isOnline`; 20s poll that
  stops once the window is closed and nobody is mid-paper; 1s tick for the live countdowns,
  corrected by the response's `serverNow`), the Exam-portal credentials row with Revoke on
  student detail, and `scopeLocked` finally wired to `attemptCounts.started`. Notes against the
  spec: the roster union was **extracted into `examRosterUnionSql`** and shared by `results` and
  `attempts`, so the two lists cannot drift; and **revoke needed a middleware change** —
  `extractStudentContext` now also requires the `student_auth` row to exist, because without
  that a revoked student's still-valid 12h token kept working (the row is only deleted, never
  checked). Marks roster + Mark-remaining-absent + Telegram/WhatsApp sends stay on the online
  exam's detail page unchanged, below the monitor.

Not yet deployed, and the flag has not been flipped for any tenant. One incidental fix came with phase
0: `GET /api/auth/profile` selected `c.qr_cards_enabled` without grouping it, which Postgres rejects —
that query is an aggregate (`array_agg` over `user_branches`). Both feature columns are now in its
`GROUP BY`. `refreshUser()` swallows errors, so this had been failing silently.

0. **The gate** — the `online_exams_enabled` column, `ensureOnlineExamsColumn`/`assertOnlineExams`, the
   login payload field, `canUseOnlineExams()` + `onlineExamsGuard`, and the `UPDATE` that switches the
   test tenant on. **First, not last:** build the gate before there is anything to leak, and every phase
   below lands dark for real tenants by construction. The admin-console button can come later.
1. **Lessons** — migration + `routes/lessons.ts` (lessons only) + `lesson-list` + nav. A teacher can
   register the curriculum of a course. *No exam behaviour yet.*
2. **Question bank** — question endpoints + `lesson-questions` editor. The bank fills up.
3. **Session → lesson tag** — `sessions.lesson_id` + the select + `lessonsTaughtIn`. Unlocks "taught so
   far".
4. **Online exam definition** — `exams` columns, `exam_lessons`, the form section, validation, access
   code. A teacher can define an online exam that nobody can sit yet.
5. **The portal shell + student auth** — `student_auth`, `routes/student-auth.ts`,
   `extractStudentContext` **and the `extractTenantContext` `typ` rejection**, the CDK stack, and the
   `student-portal/` app up to "signed in, empty exam list". Deployable and verifiable on its own: a
   student can claim a card, sign in, reset by scanning, and see nothing to sit yet.
6. **Sitting + grading** — `exam_attempts`, `exam_attempt_questions`, `routes/student-exams.ts`,
   `db/exam-grading.ts`, the portal's exam list, sitting and result screens. **This is the phase worth
   testing hardest** (§6).
7. **Monitor + credentials** — the attempts table, reset attempt, regenerate code, auto-refresh, and the
   student-detail portal-credentials row with revoke.

Phase 5 is the one with a deploy dependency: the CDK stack needs a DNS record and an ACM validation, so
start it early even if the app it serves is still a placeholder.

## 6. Test checklists

### 6.1 Student auth (phase 5)

- **The cross-audience check, first and most important:** take a student token and call a staff endpoint
  (`GET /api/students`, `GET /api/exams`) — must be rejected because `extractTenantContext` refuses a
  token with `typ`. Then the reverse: a staff token on `/api/student/exams` — rejected. Then an
  admin-portal token on both. Automate these three if nothing else in this plan gets a test.
- Scan an unlinked/expired card, and a card from a gated tenant → refused, and the refusals look alike.
- Claim, then claim again → the second is a reset, `reset_at` is stamped, the old password stops working.
- Username collision across two tenants → the second claimer is told the name is taken.
- Phone as the username: `01001234567` and `+201001234567` resolve to the same account, not two.
- Wrong password ×10 → locked for 15 min; a wrong username and a wrong password take the same time and
  return the same message.
- Claim ticket after 10 minutes → refused, back to the scan screen.
- Revoke from student detail → student is signed out on next call and can claim afresh.

### 6.2 Sitting + grading (phase 6)

- Two students, same exam → different question sets; reload mid-paper → **same** set, answers intact.
- Answer, close the browser, sign back in → resume at the same place.
- Let the clock run out → auto-graded, unanswered counted wrong, score visible, no further writes accepted.
- Submit twice → second call returns the same score, one `exam_results` row.
- Wrong code, closed window, not-enrolled student, another company's exam id → 403/404, never a paper.
- Student A's token against an exam only student B may sit → refused.
- Inspect every student payload for `isCorrect` before submit → must be absent.
- Edit then delete a bank question after a student sat it → their paper and mark are unchanged.
- `question_count` > pool → blocked at save; questions retired after save → paper is short, `total` matches.
- Auto-graded mark shows on student detail, on the QR profile, and in the Telegram/SMS result blast.
- Rating-mode company + 5-question online exam → shows `5/5`, not "Excellent".
- Single-branch tenant → no branch pickers anywhere in the new screens.

### 6.3 The gate (§0), from a tenant that does not have it

No Lessons nav entry; `/lessons` typed directly bounces; the exam form has no online toggle;
`POST /api/lessons` and an `isOnline` exam create both 403; a card from that tenant cannot be claimed on
the portal and an existing credential cannot log in. Then flip it **from the admin console** (not SQL —
test the button), re-login, and confirm all of it works. Finally confirm an **offline** exam and homework
behaved identically before and after the flip, for a gated tenant and an enabled one.

## 7. File-change checklist

| Area | File | Change |
|---|---|---|
| Migration | `aws/sql/migrations/100_lessons_and_online_exams.sql` | **new** — all §1 tables, columns, indexes, triggers, **+ `companies.online_exams_enabled` (§0)** |
| Schema | `aws/sql/schema.sql` | mirror §1 near the academy/exam tables, + the companies column |
| Gate | `aws/lambda/api/src/routes/companies.ts` | **§0** — `ensureOnlineExamsColumn`, `assertOnlineExams` |
| Gate | `aws/lambda/api/src/routes/auth.ts` | `company_online_exams` in both login queries + the ensure call |
| Gate | `shared/interfaces/user.interface.ts` | `onlineExamsEnabled` on **both** user interfaces |
| Gate | `frontend/src/app/core/services/auth.service.ts` | `canUseOnlineExams()` |
| Gate | `frontend/src/app/core/guards/permission.guard.ts` | `onlineExamsGuard` (copy of `qrPoolGuard`) |
| Gate | `aws/lambda/api/src/routes/admin-secret.ts` | `setOnlineExamsEnabled` + the flag on the companies list query |
| Gate | `admin/src/app/subscriptions.service.ts` | `setOnlineExams()` + the row field |
| Gate | `admin/src/app/companies/companies-page.component.ts` | per-company **Enable/Disable** button |
| Auth | `aws/lambda/api/src/routes/student-auth.ts` | **new** — `claim-start`, `claim-finish` (set **and** reset), `login`, `me`, `change-password` |
| Auth | `aws/lambda/api/src/middleware/student-context.ts` | **new** — `extractStudentContext`, `typ: 'student'` tokens |
| Auth | `aws/lambda/api/src/middleware/tenant-isolation.ts` | **reject any token carrying a `typ` claim** (§0.5.5) |
| API | `aws/lambda/api/src/routes/lessons.ts` | **new** — lessons + question bank CRUD, `ensureLessonSchema`, `lessonPoolSize` |
| API | `aws/lambda/api/src/routes/student-exams.ts` | **new** — my exams / start / resume / answer / submit / my results (student-authenticated) |
| API | `aws/lambda/api/src/db/exam-grading.ts` | **new** — `gradeAttempt`, publishes into `exam_results` |
| API | `aws/lambda/api/src/routes/exams.ts` | online columns in `ensureExamTables`/`mapExamFromDB`, `create`/`update` validation + `exam_lessons`, `attempts`, `regenerateCode`, `resetAttempt`, student-credentials read + revoke, no-rating-for-online |
| API | `aws/lambda/api/src/routes/sessions.ts` | `lesson_id` column + create/update/list, `lessonsTaughtIn` |
| API | `aws/lambda/api/src/middleware/rate-limit.ts` | `STUDENT_CLAIM_IP`, `STUDENT_LOGIN_IP`, `STUDENT_LOGIN_IDENT`, `STUDENT_EXAM_ANSWER` |
| API | `aws/lambda/api/src/contract.ts` | lesson/question/attempt/student schemas, `lessons` + `studentAuth` + `studentExams` blocks, exam field + route additions, `onlineExamsEnabled` on the auth responses |
| API | `aws/lambda/api/src/index.ts` | register `lessons`, `studentAuth`, `studentExams` |
| Infra | `aws/bin/core.ts` | **new** `NetrofitExamsStack-prod` — `exams.netrofit.com`, `certValidationInZone: true`, `apiProxy` (§0.5.2) |
| Shared | `shared/interfaces/lesson.interface.ts` | **new** |
| Shared | `shared/interfaces/student-portal.interface.ts` | **new** — student session, claim, portal exam + attempt types |
| Shared | `shared/interfaces/exam.interface.ts` | online exam fields, attempt + student sitting types |
| Shared | `shared/interfaces/session.interface.ts` | `lessonId`, `lessonName` |
| FE | `frontend/src/app/features/lessons/**` | **new** — service, routes, `lesson-list`, `lesson-questions` |
| FE | `frontend/src/app/features/exams/exam-form/*` | online section (lessons, count, window, duration, code) |
| FE | `frontend/src/app/features/exams/exam-detail/*` | attempts monitor for online exams |
| FE | `frontend/src/app/features/exams/services/exam.service.ts` | `getAttempts`, `regenerateCode`, `resetAttempt` |
| FE | `frontend/src/app/features/students/student-detail/*` | Exam-portal credentials row + Revoke (§4.6) |
| FE | `frontend/src/app/features/rooms/**` (session form) | Lesson select on a session |
| FE | `frontend/src/app/app.routes.ts` | `lessons` route (+ `onlineExamsGuard`) |
| FE | `frontend/src/app/core/layout/layout.component.ts` | Lessons nav entry, `visible: auth.canRead('academy') && auth.canUseOnlineExams()` |
| Portal | `student-portal/**` | **new app** (scaffold from `admin/`) — scan, claim/reset, login, my exams, sitting, result, my results; own auth interceptor + guard + en/ar bundle (§4.7) |
| i18n | `frontend/src/assets/i18n/{en,ar}.json` | §4.8 keys |

## 8. Later (additive, nothing above blocks them)

Per-lesson quotas (`exam_lessons.question_quota`) · per-question marks (`lesson_questions.marks`) ·
true/false, multi-select and written answers (the `question_type` CHECK) · question images ·
retakes (drop the unique constraint, add `attempt_no`) · question analytics off
`exam_attempt_questions.question_id` · CSV/bulk question import · hide marks until a teacher publishes
(`exams.results_published_at`).

**Portal follow-ons:** a parent view on the same login · Telegram notice to the parent on every password
reset (`sendExamResultNotifications` is the model) · "sign out my other devices"
(a `token_version` column on `student_auth`, bumped on reset) · a PWA install prompt so students open the
portal from a home-screen icon instead of typing the URL.

**Shipping it to customers** costs no code either, which is the other reason §0 is a column: enable the
tenants who buy it (the `qr_cards_enabled` model), or, if it becomes part of Advanced, make
`assertOnlineExams` fall back to `plan = 'ADVANCED'` when the flag is false — one function, one edit,
every call site already routed through it.
