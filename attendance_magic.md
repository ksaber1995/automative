# Feature Plan: Attendance Magic — Session Numbers & Substitution

## The idea in one paragraph

Every session gets a **session number** (`1`, `2`, `3`, …) that auto-increments **per Course**.
A course can have several classes (e.g. Course **A** → classes **A_1**, **A_2**). Session number
`3` of Course A is conceptually *the same session* whether it runs in A_1 or A_2. The teacher can
override the auto number to anything. Because the number is shared across a course's classes:

1. **Substitution** — if Ahmed is enrolled in A_1 but is **absent** from A_1's session `3`, he can
   walk into A_2 and attend **its** session `3`. He gets marked **present-by-substitution**: it shows
   as an absence *covered by a substitution* on his record, counts toward his attendance, and is
   clearly labelled both on his student details and on the QR scan screen.
2. **Attend twice** — a student enrolled in both A_1 and A_2 can attend session `3` in **both**
   classes (two physical sessions sharing the same number). This already works naturally; the number
   is what ties them together visually.

### Decisions locked in
- **Scope:** numbering + substitution are **per Course** (`courses.id`). Substitution is only allowed
  between classes of the **same course**.
- **Counting:** a substitution counts as **Present** for the attendance rate, but is badged
  `SUBSTITUTED` so it's visually distinct from a normal present.
- **Timing:** substitution is allowed by **matching the session number** — the student's *own* class
  session of that number does **not** need to have been started first, and the two sessions can be on
  **different days**. Example: Ahmed's own A_1 session `3` is on **Sunday**, but he scans into A_2's
  session `3` on **Saturday** — because A_1 and A_2 are the same Course and the number matches, he's
  accepted as a substitution. He doesn't need to be a member of A_2; being a member of the **Course**
  is enough.

---

## 1. Data model changes

Two tables change: `sessions` (gets the number) and `session_attendance` (gets the substitution
fields). Schema lives in `aws/sql/schema.sql`; the live DB is migrated via a numbered file in
`aws/sql/migrations/` **and** a runtime `ensure…` guard (this codebase applies idempotent ALTERs at
runtime too — see `ensureSessionRoomNullable` in `routes/sessions.ts`).

### `sessions` — add `session_number`
```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_sessions_session_number ON sessions(session_number);
```
- Assigned on start = `MAX(session_number) + 1` over **all sessions of classes in the same course**.
- Editable by the teacher (start dialog prefill + edit after the fact). No uniqueness constraint —
  the teacher may deliberately reuse a number.

### `session_attendance` — add substitution columns
```sql
ALTER TABLE session_attendance
  ADD COLUMN IF NOT EXISTS attendance_type VARCHAR(16) NOT NULL DEFAULT 'NORMAL'
    CHECK (attendance_type IN ('NORMAL', 'SUBSTITUTION'));
ALTER TABLE session_attendance
  ADD COLUMN IF NOT EXISTS home_class_id UUID REFERENCES classes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_session_attendance_home_class ON session_attendance(home_class_id);
```
- `NORMAL` = student attended a class they're enrolled in (today's behaviour). `home_class_id` NULL.
- `SUBSTITUTION` = student attended a class they're **not** enrolled in, but which shares the course
  with a class they **are** enrolled in. `home_class_id` = that enrolled sibling class (for display
  "substituted from A_1"). The existing `UNIQUE (session_id, student_id)` stays — still one row per
  physical session per student, so a single student can have at most one NORMAL **or** one
  SUBSTITUTION row per session.

The model stays "**present = row exists, absent = no row**". Substitution is just a row on the
*foreign* session tagged `SUBSTITUTION`. "Absent-with-substitution" on the home class is **derived**:
no NORMAL row here + a SUBSTITUTION row elsewhere for the same `(course, session_number)`.

### Migration file: `aws/sql/migrations/030_attendance_magic.sql`
Idempotent. Contains the two `ALTER`/index blocks above, plus a backfill that numbers existing
sessions per course in chronological order:
```sql
WITH numbered AS (
  SELECT s.id,
         ROW_NUMBER() OVER (PARTITION BY c.course_id
                            ORDER BY s.start_date, s.created_at) AS rn
  FROM sessions s
  JOIN classes c ON c.id = s.class_id
)
UPDATE sessions s
SET session_number = n.rn
FROM numbered n
WHERE n.id = s.id AND s.session_number IS NULL;
```
(Existing rows all default `attendance_type='NORMAL'`, so no attendance backfill is needed.)

### `schema.sql` edits
- Add `session_number INTEGER` + its index to the `CREATE TABLE sessions` block (~line 985).
- Add `attendance_type` + `home_class_id` + index to `CREATE TABLE session_attendance` (~line 1010)
  and update its header comment to explain substitution.

---

## 2. Backend changes (`aws/lambda/api/src`)

### `routes/sessions.ts`
- **`ensureAttendanceMagicColumns()`** runtime guard (mirrors `ensureSessionRoomNullable`) running the
  `ALTER … ADD COLUMN IF NOT EXISTS` for both tables; call it at the top of `start`.
- **`start`**: compute the next number per course and accept an override:
  ```sql
  SELECT COALESCE(MAX(s.session_number), 0) + 1 AS next
  FROM sessions s
  JOIN classes c ON c.id = s.class_id
  WHERE c.course_id = $1   -- course of the class being started
  ```
  Insert `session_number = body.sessionNumber ?? next`. Return it in `mapSessionFromDB`.
- **`nextNumber`** (new) — `GET /api/sessions/next-number?classId=…` returns `{ sessionNumber }`
  so the Start dialog can prefill the suggested number (editable).
- **`update`** (new) — `PATCH /api/sessions/:id` with `{ sessionNumber?, notes? }`, `academy:write`,
  branch-checked. Lets the teacher rename the number after starting. Validate `sessionNumber` is a
  positive integer.
- **`mapSessionFromDB` / `mapSessionWithDetailsFromDB`**: include `sessionNumber: row.session_number`.

### `routes/attendance.ts`
- **`checkinByQr`** — the core change. After resolving the student and finding they are **not**
  enrolled in the scanned session's class, try the substitution path instead of 409-ing:
  1. Load the scanned class's `course_id` + the session's `session_number`.
  2. Find a **sibling enrolled class** — a class the student is enrolled in (via `enrollments` ∪
     `master_class_enrollments`, not dropped/cancelled) where `course_id` = the scanned course and
     `id` ≠ the scanned class. If none → keep returning `409 STUDENT_NOT_IN_CLASS`.
  3. Insert `(session_id, student_id, attendance_type='SUBSTITUTION', home_class_id=<sibling>)`
     `ON CONFLICT DO NOTHING`.
  4. Return `{ …, attendanceType:'SUBSTITUTION', homeClassId, homeClassName, sessionNumber,
     alreadyPresent }` so the scanner UI can say *"Substitution — enrolled in A_1, session 3"*.
     The enrolled path returns `attendanceType:'NORMAL'` and inserts NORMAL as today.
  - (If multiple sibling classes match, pick deterministically — prefer one whose session of that
    number the student is absent from, else first by enrollment date. Documented in code.)
- **`saveForSession`** (the checkbox bulk save) — must **not** wipe substitution rows. Change the
  delete to `DELETE … WHERE session_id=$1 AND attendance_type='NORMAL'` and keep inserting NORMAL only.
  Substitution rows are managed solely through QR (and the dedicated remove control, if added).
- **`getBySession`** — surface substitution attendees too. Today it lists only enrolled students;
  add the students who have a `SUBSTITUTION` row for this session (not enrolled here) and return
  `attendanceType` + `homeClassName` per row so the editor can badge them.
- **`getByStudent`** — return a **status** instead of a bare boolean. For each session of the
  student's enrolled classes:
  - `PRESENT` if a NORMAL row exists for that session;
  - else `SUBSTITUTED` if the student has a `SUBSTITUTION` row on **any** session whose course =
    this session's course and `session_number` = this session's number (also expose
    `substitutedInClassName`);
  - else `ABSENT`.
  Add `sessionNumber` to each record. Keep `isPresent` (= PRESENT **or** SUBSTITUTED) for backward
  compatibility, or migrate callers to `status`.
- **`getByClass`** — unchanged counts, but `presentCount` should count NORMAL rows of enrolled
  students (substitution rows belong to the *other* class's roster); confirm the `COUNT` filters on
  `attendance_type='NORMAL'` so a sub doesn't inflate the host class's present count.

### `routes/public-students.ts`
- Apply the same `PRESENT / ABSENT / SUBSTITUTED` derivation to the public profile attendance block
  (`recent` list + the `presentCount` / `attendanceRate`, where SUBSTITUTED counts as present). Show
  a "substitution" badge so a parent scanning the QR sees it clearly.

### `contract.ts`
- `attendance.getBySession` 200: add `attendanceType: z.enum(['NORMAL','SUBSTITUTION'])`,
  `homeClassName: z.string().nullable().optional()`.
- `attendance.checkinByQr` 200: add `attendanceType`, `homeClassName` (nullable),
  `sessionNumber` (nullable).
- `attendance.getByStudent` 200: add `status: z.enum(['PRESENT','ABSENT','SUBSTITUTED'])`,
  `sessionNumber: z.number().nullable()`, `substitutedInClassName: z.string().nullable()`.
- `sessions.start` body: add `sessionNumber: z.number().int().positive().optional()`.
- **New** `sessions.nextNumber` (GET `/api/sessions/next-number`) and `sessions.update`
  (PATCH `/api/sessions/:id`).
- Public student profile schema (~line 1680): add `status` + substitution fields to `recent`.

### `index.ts`
- Register `sessions.nextNumber` and `sessions.update` alongside the existing `sessions.*` handlers.

---

## 3. Frontend changes (`frontend/src/app`)

### Services
- `services/session.service.ts` **and** `features/rooms/services/session.service.ts`:
  - add `sessionNumber` to the `Session` interface and `sessionNumber?` to `StartSessionDto`;
  - add `nextNumber(classId)` and `update(id, { sessionNumber?, notes? })`.
- `features/rooms/services/attendance.service.ts`:
  - `SessionAttendanceStudent`: add `attendanceType` + `homeClassName?`;
  - `StudentAttendanceRecord`: replace/augment `isPresent` with
    `status: 'PRESENT'|'ABSENT'|'SUBSTITUTED'`, add `sessionNumber`, `substitutedInClassName?`;
  - `QrCheckinResult`: add `attendanceType`, `homeClassName?`, `sessionNumber?`.

### Sessions dashboard (`features/rooms/sessions-dashboard`)
- Start dialog: add a **Session #** numeric input. On class change, call `nextNumber(classId)` and
  prefill it (teacher can edit). Pass `sessionNumber` in `start()`.
- Show the session number on each active/history session card; allow inline edit → `update()`.
- Inline attendance accordion: render substitution attendees with a badge + "from A_1".

### Session attendance page (`features/rooms/session-attendance`)
- Header shows "Session #N" with an edit affordance (`update`).
- Roster: badge substitution rows (`attendanceType==='SUBSTITUTION'` → "Substitution · from A_1").
- **QR scan result panel**: when `attendanceType==='SUBSTITUTION'`, show a distinct message/colour
  ("✔ Substitution — Ahmed (enrolled in A_1) · session 3") and consider a third beep pattern so staff
  hear "substitution" vs "present" vs "already present". Add i18n keys
  `SESSION_QR.SUBSTITUTION*`, `SESSIONS_DASHBOARD.SESSION_NUMBER`, etc. (en + ar).

### Student detail (`features/students/student-detail`)
- Attendance list: render three states — Present / Absent / **Substituted** (badge + "substituted in
  A_2, session 3"). Update `attendancePresentCount` to count `PRESENT` + `SUBSTITUTED`, and
  `attendanceAbsentCount` to count only `ABSENT`, so the rate matches the "counts as present" rule.

---

## 4. Edge cases & notes
- **Bulk-save vs substitution:** `saveForSession` only touches NORMAL rows (see above) — toggling
  the enrolled roster never deletes a substitution check-in.
- **Same student, both classes enrolled (attend twice):** two NORMAL rows on two sessions; no special
  code — both show as PRESENT under the shared number. Correct by construction.
- **Multiple sibling classes:** check-in picks one deterministically for `home_class_id`; display
  derives substitution by `(course, number)` so it stays correct even if the pick is imperfect.
- **Number uniqueness:** intentionally **not** enforced; teachers may reuse numbers.
- **Ending/branch checks:** new `update`/`nextNumber` reuse the existing
  `academy` permission + `canAccessBranch` guards.

---

## 5. File-change checklist
| Area | File | Change |
|------|------|--------|
| Migration | `aws/sql/migrations/030_attendance_magic.sql` | **new** — ALTERs + backfill |
| Schema | `aws/sql/schema.sql` | add cols to `sessions` + `session_attendance` |
| API | `aws/lambda/api/src/routes/sessions.ts` | number on start, `nextNumber`, `update`, runtime guard |
| API | `aws/lambda/api/src/routes/attendance.ts` | substitution check-in, status derivation, safe bulk-save |
| API | `aws/lambda/api/src/routes/public-students.ts` | substitution-aware public attendance |
| API | `aws/lambda/api/src/contract.ts` | schema updates + 2 new endpoints |
| API | `aws/lambda/api/src/index.ts` | register new endpoints |
| FE | `frontend/src/app/services/session.service.ts` + `features/rooms/services/session.service.ts` | number + new calls |
| FE | `frontend/src/app/features/rooms/services/attendance.service.ts` | new fields/status |
| FE | `features/rooms/sessions-dashboard/*` | number input/edit, sub badges |
| FE | `features/rooms/session-attendance/*` | number edit, sub badge, QR result |
| FE | `features/students/student-detail/*` | substituted state + counts |
| i18n | `frontend/src/assets/i18n/{en,ar}.json` | new keys |
