# Feature Plan: Exams — Course Exams & QR Grade Recording

## The idea in one paragraph

An **Exam** belongs to a **Course**. It is deliberately tiny: it has a **name**, a **date**, and a
**status**. You create an exam with just its course, name and date — it starts as `SCHEDULED`. When
the exam has been sat, you flip it to `DONE` and then **record a grade per student by scanning their
QR code** (the same `qr_token` used by attendance magic). A student can be graded only if they are
**enrolled in that exam's course in any class** (exactly the attendance-magic rule: membership of the
*course* is enough, not a specific class). Every student's grades show up on **their student-detail
page** in the app and on the **public QR profile** they see when they scan their own code.

### Decisions locked in
- **Scope:** an exam is tied to a **Course** (`courses.id`), never to a single class. Eligibility to be
  graded = the student is enrolled in **any** class of that course (via `enrollments` ∪
  `master_class_enrollments`, not dropped/cancelled) — mirrors `checkinByQr` in `routes/attendance.ts`.
- **Exam fields:** `name`, `course_id`, `exam_date`, `status`. Nothing else. `branch_id` and
  `company_id` are denormalised from the course for fast, branch-scoped listing/filtering.
- **Status:** `SCHEDULED` → `DONE` (CHECK-constrained). You create as `SCHEDULED`; you set `DONE`
  when the exam is over. Grades can be recorded once it's `DONE` (the UI nudges that order; the API
  allows it whenever the exam exists, so a teacher who forgets to flip status isn't blocked).
- **Grade:** **one value per student per exam** — free-text `VARCHAR(50)` (`"85"`, `"A"`, `"Pass"`,
  `"17/20"`). Kept as text on purpose so academies aren't forced into a numeric scheme. *(Decision
  point — if you'd rather have averages/sorting, switch to `numeric_grade DECIMAL(6,2)` +
  `max_grade DECIMAL(6,2)`; noted again in §4.)*
- **Recording:** primarily **QR scan** (scan student → type grade → save, idempotent upsert). A
  **manual roster** fallback (the enrolled students of the course with a grade input each) is included
  for when a camera isn't handy — same pattern as the attendance roster + scanner.
- **Permissions:** reuse the existing **`academy`** resource (Courses/Classes/Attendance/Events already
  live under it). No RBAC migration needed. *(Optional: a dedicated `exams` resource — see §4.)*

---

## 1. Data model changes

Two **new** tables: `exams` and `exam_results`. Schema lives in `aws/sql/schema.sql`; the live DB is
migrated via a numbered file in `aws/sql/migrations/` (next number is **035**) **and** an idempotent
runtime guard (`ensureExamTables()` in the new `routes/exams.ts`, mirroring `ensureSessionRoomNullable`
in `routes/sessions.ts` and the `IF NOT EXISTS` migrations in `routes/migrations.ts`).

### `exams`
```sql
CREATE TABLE IF NOT EXISTS exams (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,   -- denormalised from course
    course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    exam_date   DATE NOT NULL,
    status      VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED'
                  CHECK (status IN ('SCHEDULED', 'DONE')),
    is_active   BOOLEAN NOT NULL DEFAULT true,                      -- soft-delete
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_exams_company   ON exams(company_id);
CREATE INDEX IF NOT EXISTS idx_exams_branch    ON exams(branch_id);
CREATE INDEX IF NOT EXISTS idx_exams_course    ON exams(course_id);
CREATE INDEX IF NOT EXISTS idx_exams_exam_date ON exams(exam_date);
```

### `exam_results` — one grade per student per exam
```sql
CREATE TABLE IF NOT EXISTS exam_results (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id     UUID NOT NULL REFERENCES exams(id)     ON DELETE CASCADE,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    course_id   UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,  -- denorm for student queries
    student_id  UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
    grade       VARCHAR(50) NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,        -- when the QR scan/save happened
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, student_id)                                           -- re-scan = update, never duplicate
);
CREATE INDEX IF NOT EXISTS idx_exam_results_exam    ON exam_results(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_student ON exam_results(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_company ON exam_results(company_id);
```

### `updated_at` triggers (codebase convention)
```sql
DROP TRIGGER IF EXISTS update_exams_updated_at ON exams;
CREATE TRIGGER update_exams_updated_at
    BEFORE UPDATE ON exams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_exam_results_updated_at ON exam_results;
CREATE TRIGGER update_exam_results_updated_at
    BEFORE UPDATE ON exam_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Migration file: `aws/sql/migrations/035_exams.sql`
Idempotent — the two `CREATE TABLE IF NOT EXISTS` blocks, indexes, and triggers above. No backfill
(brand-new tables). Also add both `CREATE TABLE` blocks to `aws/sql/schema.sql` (near the other
academy tables) so fresh DBs match.

---

## 2. Backend changes (`aws/lambda/api/src`)

### `routes/exams.ts` (new) — mirror `routes/events.ts`
Standard `mapExamFromDB(row)` / `mapExamResultFromDB(row)` (snake_case → camelCase). Every handler:
`const context = await extractTenantContext(headers.authorization)`, then
`checkGranularPermission(context, 'academy', <action>)`, then `canAccessBranch(context, branchId)`.
Use `query` / `queryOne` / `insert` / `update` from `db/connection`. Call `ensureExamTables()` at the
top of `create` and `recordByQr` (idempotent).

- **`create`** — `POST /api/exams`, `academy:write`. Body `{ courseId, name, examDate, status? }`.
  Resolve the course (company-scoped) to copy `branch_id` onto the exam and verify branch access:
  ```sql
  SELECT id, branch_id FROM courses WHERE id = $1 AND company_id = $2
  ```
  `insert('exams', { company_id, branch_id: course.branch_id, course_id, name, exam_date, status: body.status ?? 'SCHEDULED' })`.
- **`list`** — `GET /api/exams?branchId&courseId&status`, `academy:read`. Same branch-scoping block as
  `events.list` (`appendBranchSqlFilter` for non-global-admins, `OR branch_id IS NULL`). Join `courses`
  for `courseName` and left-join a count of results:
  ```sql
  SELECT e.*, c.name AS course_name,
         (SELECT COUNT(*) FROM exam_results r WHERE r.exam_id = e.id) AS result_count
  FROM exams e JOIN courses c ON c.id = e.course_id
  WHERE e.company_id = $1 AND e.is_active = true ...
  ORDER BY e.exam_date DESC, e.created_at DESC
  ```
- **`getById`** — `GET /api/exams/:id`, `academy:read`. Company + branch checked.
- **`update`** — `PATCH /api/exams/:id`, `academy:write`. Accept `{ name?, examDate?, status?, courseId? }`.
  Setting `status:'DONE'` is just a normal field update. If `courseId` changes, re-copy `branch_id`.
- **`delete`** — `DELETE /api/exams/:id`, `academy:delete`. Soft-delete (`is_active = false`).
  `exam_results` cascade on hard-delete; for soft-delete they simply stop showing with the exam.

#### Grade recording — the core endpoints
- **`results`** — `GET /api/exams/:id/results`, `academy:read`. Returns **every enrolled student of the
  exam's course** with their grade (if any) so the roster UI can show who's graded and who isn't:
  ```sql
  -- enrolled = enrollments ∪ master_class_enrollments for this course, not dropped/cancelled
  SELECT s.id AS student_id, s.first_name, s.last_name,
         r.id AS result_id, r.grade, r.recorded_at
  FROM students s
  JOIN (
        SELECT student_id FROM enrollments
          WHERE course_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED')
        UNION
        SELECT student_id FROM master_class_enrollments
          WHERE course_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED')
       ) en ON en.student_id = s.id
  LEFT JOIN exam_results r ON r.exam_id = $3 AND r.student_id = s.id
  WHERE s.company_id = $2 AND s.is_active = true
  ORDER BY s.first_name, s.last_name
  ```
- **`recordByQr`** — `POST /api/exams/:id/record-by-qr`, `academy:write`. Body `{ qrToken, grade }`.
  The exam-equivalent of `attendance.checkinByQr`:
  1. Load exam (company-scoped) + branch check; get its `course_id`.
  2. Resolve the token **company-scoped** (same query attendance uses):
     `SELECT id, first_name, last_name FROM students WHERE qr_token = $1 AND company_id = $2 AND is_active = true`
     → `404 ERRORS.EXAMS.QR_STUDENT_NOT_FOUND` if none.
  3. Verify the student is enrolled in this exam's **course** (the `enrollments ∪
     master_class_enrollments` check above). If not → `409 ERRORS.EXAMS.STUDENT_NOT_IN_COURSE`.
  4. Upsert the grade (idempotent — re-scan edits):
     ```sql
     INSERT INTO exam_results (exam_id, company_id, course_id, student_id, grade)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (exam_id, student_id)
     DO UPDATE SET grade = EXCLUDED.grade, recorded_at = NOW(), updated_at = NOW()
     RETURNING (xmax = 0) AS inserted
     ```
  5. Return `{ studentId, studentFirstName, studentLastName, grade, alreadyRecorded }`
     (`alreadyRecorded = !inserted`) so the scanner UI can flash "✔ Ahmed — 85 (updated)".
- **`saveResult`** (manual, optional but recommended) — `POST /api/exams/:id/results` with
  `{ studentId, grade }`, same enrollment check + same upsert, for the roster's per-row save / no-camera
  flow. **`deleteResult`** — `DELETE /api/exams/:id/results/:studentId` to clear a grade.

### `routes/public-students.ts`
Add an **exams** block to the public profile so a student/parent scanning the QR sees grades. For the
`qr_token`'s student, return their `exam_results` joined to `exams` + `courses`:
```sql
SELECT e.name AS exam_name, c.name AS course_name, e.exam_date, r.grade
FROM exam_results r
JOIN exams e   ON e.id = r.exam_id AND e.is_active = true
JOIN courses c ON c.id = e.course_id
WHERE r.student_id = $1
ORDER BY e.exam_date DESC
```
Low-sensitivity fields only (exam name, course, date, grade) — no internal ids/notes.

### `contract.ts`
- New `ExamSchema`, `CreateExamSchema` (`{ courseId, name, examDate, status? }`),
  `UpdateExamSchema = CreateExamSchema.partial().extend({ isActive: z.boolean().optional() })`,
  `ExamStatusSchema = z.enum(['SCHEDULED','DONE'])`, `ExamResultSchema`,
  `ExamResultRowSchema` (roster row: studentId, names, grade nullable, recordedAt nullable).
- New `exams` contract object: `create` (201), `list` (200 array, query `branchId/courseId/status`),
  `getById`, `update`, `delete`, `results` (GET `/api/exams/:id/results` → `z.array(ExamResultRowSchema)`),
  `recordByQr` (POST `/api/exams/:id/record-by-qr`, body `{ qrToken: z.string().min(1), grade: z.string().min(1) }`,
  200 `{ studentId, studentFirstName, studentLastName, grade, alreadyRecorded }`, +400/403/404/409),
  `saveResult` (POST `/api/exams/:id/results`), `deleteResult` (DELETE `/api/exams/:id/results/:studentId`).
- Public student profile schema: add `exams: z.array(z.object({ examName, courseName, examDate, grade }))`.

### `index.ts`
- `import { examsRoutes } from './routes/exams'` and register an `exams: { ...examsRoutes }` block in
  the router object (same shape as `events`/`monthlySubscriptions`).

---

## 3. Frontend changes (`frontend/src/app`)

### Shared interface — `shared/interfaces/exam.interface.ts` (new)
```ts
export type ExamStatus = 'SCHEDULED' | 'DONE';
export interface ExamModel {
  id: string; companyId: string; branchId: string | null;
  courseId: string; courseName?: string;
  name: string; examDate: string; status: ExamStatus;
  resultCount?: number; isActive: boolean;
  createdAt: string; updatedAt: string;
}
export interface ExamCreateDto { courseId: string; name: string; examDate: string; status?: ExamStatus; }
export interface ExamUpdateDto extends Partial<ExamCreateDto> { isActive?: boolean; }
export interface ExamResultRow {
  studentId: string; firstName: string; lastName: string;
  grade: string | null; recordedAt: string | null;
}
export interface QrExamResult {
  studentId: string; studentFirstName: string; studentLastName: string;
  grade: string; alreadyRecorded: boolean;
}
```

### Service — `features/exams/services/exam.service.ts` (new)
Inject `ApiService` (like `event.service.ts`): `getAll(filters?)`, `getById`, `create`, `update`,
`delete`, `getResults(examId)`, `recordByQr(examId, qrToken, grade)`, `saveResult(examId, studentId, grade)`,
`deleteResult(examId, studentId)`.

### Routes — `features/exams/exams.routes.ts` (new) + `app.routes.ts`
```ts
// exams.routes.ts
export const EXAMS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./exam-list/exam-list.component').then(m => m.ExamListComponent) },
  { path: 'create', canActivate: [permissionGuard('academy','write')], data: { breadcrumb: 'BREADCRUMBS.CREATE' },
    loadComponent: () => import('./exam-form/exam-form.component').then(m => m.ExamFormComponent) },
  { path: ':id/edit', canActivate: [permissionGuard('academy','write')], data: { breadcrumb: 'BREADCRUMBS.EDIT' },
    loadComponent: () => import('./exam-form/exam-form.component').then(m => m.ExamFormComponent) },
  { path: ':id', data: { breadcrumb: 'BREADCRUMBS.DETAIL' },
    loadComponent: () => import('./exam-detail/exam-detail.component').then(m => m.ExamDetailComponent) },
];
```
In `app.routes.ts` add (next to `events`):
```ts
{ path: 'exams', canActivate: [permissionGuard('academy')], data: { breadcrumb: 'BREADCRUMBS.EXAMS' },
  loadChildren: () => import('./features/exams/exams.routes').then(m => m.EXAMS_ROUTES) },
```

### Components — `features/exams/`
- **`exam-list/`** — table of exams (name, course, date, status badge, `resultCount`). Filters: course +
  status. **Branch filter follows the single-branch rule** already shipped — wrap it in
  `@if (!branchState.isSingleBranch())` (see `core/services/branch-state.service.ts`). "Create exam" button
  gated by `auth.canWrite('academy')`.
- **`exam-form/`** — create/edit. Fields: **Course** (`p-select`), **Name**, **Date** (`p-datepicker`),
  **Status** (`p-select` SCHEDULED/DONE; defaults SCHEDULED on create). Apply the single-branch
  preselect/hide convention to the course/branch context if a branch field is shown (reuse
  `BranchStateService`). Minimal — matches "all I need is the date and status".
- **`exam-detail/`** — the workhorse "record results" screen, modelled on
  `features/rooms/session-attendance/session-attendance.component.ts`:
  - Header: exam name, course, date, a **status toggle** (flip to `DONE`).
  - **Roster** from `getResults(examId)`: each enrolled student with a grade input; per-row save →
    `saveResult`. Shows graded/ungraded counts.
  - **QR scanner** (reuse the `Html5Qrcode` flow + `extractToken()` "/p/s/" parsing + dedup + beep from
    `session-attendance.component.ts`): on scan, focus that student's row and prompt the grade (or use a
    "current grade to apply" field), then call `recordByQr(examId, token, grade)`; flash
    "✔ Ahmed — 85" / "updated" and update the roster row. Handle `409` (not enrolled in course) with a
    distinct error beep + toast `EXAMS.QR_NOT_IN_COURSE`.
  - Manual token entry box (Enter to submit) sharing the same call, like the attendance page.

### Student detail — `features/students/student-detail/student-detail.component.*`
Add an **"Exam Results"** `<p-card>` after the Attendance History card (~line 871, before Books &
Products). New `examResults = signal<...>([])`, loaded in `ngOnInit` via a new
`ExamService.getByStudent(studentId)` (add `GET /api/exams/student/:studentId` returning
`{ examName, courseName, examDate, grade }[]`, or reuse the public projection shape). Render a small
table: Course · Exam · Date · Grade.

### Public QR profile — `features/public/public-student/*` + `public-student.service.ts`
Extend `PublicStudentProfile` with `exams: { examName; courseName; examDate; grade }[]` and add a
section after "Recent sessions" (bilingual EN/AR like the rest of that page). No auth — it's the
`/p/s/:token` page.

### Navigation — `core/layout/layout.component.ts`
Add to the Academic group:
```ts
{ labelKey: 'NAV.EXAMS', icon: 'pi pi-file-edit', routerLink: ['/exams'], visible: auth.canRead('academy') },
```

### i18n — `frontend/src/assets/i18n/{en,ar}.json`
`NAV.EXAMS`, `BREADCRUMBS.EXAMS`, `EXAMS.*` (list/form/detail labels, status SCHEDULED/DONE,
grade, QR scan result + `EXAMS.QR_NOT_IN_COURSE` / `EXAMS.QR_STUDENT_NOT_FOUND`), and the
student-detail + public-profile section headings.

---

## 4. Edge cases & notes
- **Grade type:** shipping as free-text `VARCHAR(50)` per "record only grade". If analytics/averages
  are wanted later, add `numeric_grade DECIMAL(6,2)` + `max_grade` alongside (keep `grade` as the
  display string) — additive migration, no breakage.
- **Eligibility uses the course, not a class** — identical to attendance magic: a student in any class
  of the course can be graded. Both `enrollments` and `master_class_enrollments` (bundles) are checked.
- **Re-scan / correction:** `ON CONFLICT (exam_id, student_id) DO UPDATE` — scanning a student twice
  updates the grade, never duplicates. `deleteResult` clears a mistake.
- **Status is advisory, not a hard gate:** `recordByQr` works whenever the exam exists so a teacher who
  forgot to flip `DONE` isn't blocked; the UI still leads with "mark DONE, then record".
- **Branch scoping:** exams inherit `branch_id` from their course; listing/visibility reuse the existing
  `academy` permission + `canAccessBranch`/`appendBranchSqlFilter` guards and the single-branch UI rule.
- **Soft-delete:** `is_active = false` hides the exam (and its grades) without losing history; matches
  `events`.
- **Optional dedicated `exams` permission** (instead of reusing `academy`): add `exams` to
  `UserPermissions` + `PERMISSION_RESOURCES` + every role in `ROLE_DEFAULT_PERMISSIONS`
  (`shared/interfaces/permissions.interface.ts`) and the backend `PermissionResource` union /
  `ROLE_DEFAULTS` (`middleware/tenant-isolation.ts`), then gate routes/nav on `'exams'`. Recommended
  only if exams need access separate from the rest of the academy.

---

## 5. File-change checklist
| Area | File | Change |
|------|------|--------|
| Migration | `aws/sql/migrations/035_exams.sql` | **new** — `exams` + `exam_results` tables, indexes, triggers |
| Schema | `aws/sql/schema.sql` | add both `CREATE TABLE` blocks near academy tables |
| API | `aws/lambda/api/src/routes/exams.ts` | **new** — CRUD + `results` + `recordByQr` + `saveResult`/`deleteResult` + `ensureExamTables`, `getByStudent` |
| API | `aws/lambda/api/src/routes/public-students.ts` | add exams block to public profile |
| API | `aws/lambda/api/src/contract.ts` | exam schemas + `exams` endpoints + public-profile `exams` field |
| API | `aws/lambda/api/src/index.ts` | register `exams` routes |
| Shared | `shared/interfaces/exam.interface.ts` | **new** — Exam DTOs/models, QR + result rows |
| FE | `frontend/src/app/features/exams/services/exam.service.ts` | **new** |
| FE | `frontend/src/app/features/exams/exams.routes.ts` | **new** |
| FE | `frontend/src/app/features/exams/exam-list/*` | **new** — list + filters (single-branch aware) |
| FE | `frontend/src/app/features/exams/exam-form/*` | **new** — course/name/date/status |
| FE | `frontend/src/app/features/exams/exam-detail/*` | **new** — roster + QR grade recording (reuse Html5Qrcode flow) |
| FE | `frontend/src/app/app.routes.ts` | add `exams` route |
| FE | `frontend/src/app/core/layout/layout.component.ts` | add Exams nav entry |
| FE | `frontend/src/app/features/students/student-detail/*` | Exam Results card |
| FE | `frontend/src/app/features/public/public-student/*` + `public-student.service.ts` | exams section on QR profile |
| i18n | `frontend/src/assets/i18n/{en,ar}.json` | `NAV.EXAMS`, `BREADCRUMBS.EXAMS`, `EXAMS.*` |
