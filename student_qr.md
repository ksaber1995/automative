# Feature Plan: Student QR Codes

Each student gets a unique QR code. The QR is used for two things:

1. **Attendance** — staff scan a student's QR during a session to mark them present.
2. **Public profile** — anyone who scans the QR (e.g. a parent, outside the app, no login) lands on a read-only page showing the student's courses, attendance, and payments.

---

## 0. Do I need to buy a QR reader? — Short answer: **No.**

You have three options, cheapest first:

| Option | Hardware | How it works | Best for |
|--------|----------|--------------|----------|
| **Phone/tablet camera (recommended)** | None — staff use the phone/tablet they already have | A web page (`html5-qrcode`) opens the camera in the browser and decodes the QR. No app install. | Most academies. Start here. |
| **Laptop webcam** | None | Same `html5-qrcode` scanner running on the front-desk laptop. | Reception desk check-in. |
| **USB barcode/QR scanner** ("keyboard wedge") | ~$15–40 one-time | The scanner acts like a keyboard: scanning "types" the QR's text into a focused input box. No special drivers, no SDK. | High-volume, fast kiosk check-in. |

**Recommendation:** Build the camera-based web scanner (`html5-qrcode`) — zero hardware cost, works on any staff phone. We can *also* support the USB scanner essentially for free: a USB QR scanner just types the decoded text + Enter into whatever input is focused, so if we add a hidden/visible text input on the attendance page that submits on Enter, the same code path handles both camera scans and USB scans. **No SDK or special integration needed for the USB option.**

So: **don't buy anything to start.** Optionally buy a cheap USB scanner later only if reception wants faster kiosk-style check-in.

---

## 1. What the QR actually contains

The QR encodes a **URL to the public profile page**, e.g.:

```
https://app.netrofit.com/p/s/<opaque-token>
```

Where `<opaque-token>` is a **random, unguessable** string (not the student's UUID).

Why a URL and not just the ID:
- Scanning with **any** phone camera app (outside our platform) opens the browser straight to the public profile — that satisfies your "scan outside my platform → student details page" requirement with no app.
- Our **in-app attendance scanner** reads the same URL, extracts the token from the end, and uses it to mark attendance.

Why an **opaque random token** and not the student UUID:
- The page is **unauthenticated**, so the token is the only thing protecting the student's data. A sequential/guessable ID would let anyone enumerate `/p/s/1, /p/s/2, …` and scrape every student. A 22+ char random token (≈128 bits) is not guessable.
- The token can be **rotated** (regenerated) if a student's QR leaks, without changing the student record.

---

## 2. Data model changes

### Migration `028`-style file: `aws/sql/migrations/0XX_student_qr.sql`

Add a token column to `students` (table is at `aws/sql/schema.sql` ~line 352):

```sql
ALTER TABLE students ADD COLUMN IF NOT EXISTS qr_token VARCHAR(32) UNIQUE;

-- Backfill existing students with a random token.
-- gen_random_uuid() text (hex, no dashes) gives a 32-char unguessable token.
UPDATE students
SET qr_token = REPLACE(gen_random_uuid()::text, '-', '')
WHERE qr_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_students_qr_token ON students(qr_token);
```

> Note: `gen_random_uuid()` needs `pgcrypto` (or `uuid-ossp` already used in schema). If unavailable, generate the token in app code on insert instead.

Also update `aws/sql/schema.sql` so fresh DBs include the column, and set it on student **create** in `aws/lambda/api/src/routes/students.ts` (generate a token in the `insert('students', {...})` call).

**Decision — store nothing more.** We do *not* need a separate `student_qr_codes` table; one nullable-then-unique column on `students` is enough. A separate table only earns its keep if you later want multiple active codes per student or an audit log of rotations — out of scope for v1.

---

## 3. Backend changes (AWS Lambda API, `ts-rest`)

The API uses a contract-driven router: define the endpoint in `contract.ts`, implement it in a `routes/*.ts` file, and register it in `index.ts`. Auth is enforced *per handler* by calling `extractTenantContext(headers.authorization)`. **Public endpoints simply don't call it** and don't declare an `authorization` header in the contract (see existing `routes/demo-leads.ts` for the established public-endpoint pattern).

### 3a. Public profile endpoint (NO auth)

`GET /api/public/students/:qrToken`

- New file `aws/lambda/api/src/routes/public-students.ts`.
- **Does NOT call `extractTenantContext`.** Instead call `enforceByIp(RATE_LIMITS.PUBLIC_...)` for rate limiting (same as demo-leads) to prevent token brute-forcing.
- Look up the student by `qr_token` only: `SELECT ... FROM students WHERE qr_token = $1 AND is_active = true`. The token itself scopes the result — `company_id`/`branch_id` come *from* the found student, we don't need them from a JWT.
- Reuse the same aggregation the authenticated student-detail screen uses, but return a **curated, read-only DTO** (see §5 on what to expose).
- Return `404` (generic) if the token doesn't match — never reveal whether a token "exists but is inactive" vs "never existed".

Contract entry (mirroring `demoLeads.create`, no `headers`):

```typescript
publicStudents: {
  profile: {
    method: 'GET',
    path: '/api/public/students/:qrToken',
    pathParams: z.object({ qrToken: z.string().min(16).max(64) }),
    responses: { 200: PublicStudentProfileSchema, 404: ApiErrorSchema, 429: ApiErrorSchema },
  },
}
```

### 3b. Attendance check-in by QR (auth required — staff only)

`POST /api/attendance/session/:sessionId/checkin`  body: `{ qrToken: string }`

- Add to existing `aws/lambda/api/src/routes/attendance.ts`.
- **Requires auth** (`extractTenantContext`) + `attendance` write permission — only staff mark attendance.
- Steps:
  1. Resolve `student` by `qr_token`, scoped to `context.companyId` (a token from another tenant must not work).
  2. Verify the student is **enrolled in the class** that this `sessionId` belongs to (reject "student scanned at wrong class").
  3. `INSERT INTO session_attendance (session_id, student_id) ... ON CONFLICT (session_id, student_id) DO NOTHING` — idempotent, so double-scans are harmless (the table is already sparse "present = row exists, absent = no row" with a `UNIQUE(session_id, student_id)` constraint).
  4. Return the student's name + present status so the scanner UI can show a green "✓ Ahmed marked present" toast.
- Errors: `404` unknown token, `409`/`400` student not enrolled in this class, `403` no permission.

This reuses the existing attendance model — no schema change to `session_attendance`.

---

## 4. Frontend changes (Angular 21, standalone components)

### 4a. Library

Install **one** package:
```
npm i html5-qrcode
```
`html5-qrcode` does **both** camera scanning *and* QR image rendering, so a single dependency covers the scanner. (Alternatively `angularx-qrcode` purely for *rendering* the printable QR + `html5-qrcode` for *scanning* — but html5-qrcode alone is enough.)

### 4b. Display / print a student's QR

On the existing **student detail page** (`features/students/student-detail/`):
- Add a "QR Code" section/button that renders the QR (encoding the public URL) and a **Print** / **Download PNG** action so the academy can print badges/cards.
- Add a "Regenerate QR" action (calls a small authenticated endpoint that rotates `qr_token`) for when a code is lost/leaked. *(Optional for v1 but cheap.)*

### 4c. Scanner for attendance

On the existing session attendance page (`features/rooms/session-attendance/`):
- Add a **"Scan QR"** button that opens an `html5-qrcode` camera view.
- On decode: extract the token from the scanned URL, call `POST /attendance/session/:id/checkin`, show a success/already-present/error toast, keep the camera open for the next student (continuous scanning).
- Add a focused **text input** on the same screen that submits on Enter → same `checkin` call. This transparently supports a **USB keyboard-wedge scanner** with zero extra code.
- The existing checkbox grid stays as the manual fallback.

### 4d. Public profile page (NO auth)

- New **standalone, unguarded** route registered at the **root** of `app.routes.ts`, *outside* the `LayoutComponent`/`authGuard` wrapper — exactly how `/auth/*` routes are mounted today:
  ```typescript
  { path: 'p/s/:qrToken',
    loadComponent: () => import('./features/public/public-student/public-student.component')
      .then(m => m.PublicStudentComponent) }
  ```
- New folder `features/public/public-student/`. The component:
  - Reads `qrToken` from the route, calls `GET /api/public/students/:qrToken` via a service that does **not** attach a JWT.
  - Renders a clean, mobile-first, read-only view (no app chrome/sidebar) showing the curated profile.
- **Auth interceptor caveat:** the global `auth.interceptor.ts` attaches the JWT to all requests. Make sure the public call either uses a path the interceptor skips, or have the interceptor skip `/api/public/*`. Verify during implementation.

---

## 5. What the public page shows — privacy decision ⚠️

You asked for the public page to be "very similar to student details (course / attendances / payments)". **Be deliberate here:** this page has **no login**, so anyone with the QR (or the URL) sees everything we put on it. A printed QR badge can be photographed.

Recommended split:

| Data | Public page? | Reasoning |
|------|-------------|-----------|
| Student name, photo (if any), active courses/bundles | ✅ Yes | Low sensitivity; useful for parents. |
| Attendance summary (rate, present/absent counts, recent sessions) | ✅ Yes | This is arguably the main value for a parent. |
| Payment **status** (paid / due / next installment date + amount) | ⚠️ Your call | Useful, but financial. |
| Full payment **history**, refunds, exact balances, internal notes, phone/email, address | ❌ Recommend **No** | Sensitive PII/financial detail; should stay behind staff login. |

**My recommendation:** show name + courses + attendance + a *minimal* payment status (e.g. "1 installment due"), and keep full payment ledger, contact info, and notes off the public page. The authenticated `student-detail` page keeps showing everything.

> If you *do* want full payments public, we can still ship it — but consider adding a lightweight gate (e.g. the page asks for the student's date of birth or last-4 of phone before revealing financial detail). **This needs your decision before building §3a/§4d.**

---

## 6. Build order (suggested)

1. **Migration + schema** — add `qr_token`, backfill, set on create. *(Backend, no user-visible change.)*
2. **Public profile endpoint** `GET /api/public/students/:qrToken` + curated DTO (per §5 decision).
3. **Public profile page** (Angular unguarded route) — now scanning a QR with any phone works end-to-end.
4. **QR display/print** on student detail page.
5. **Attendance check-in endpoint** + **scanner UI** on session attendance page.
6. **(Optional)** Regenerate-token endpoint + button; USB-scanner input box.

Steps 1–4 deliver the "scan → public page" requirement. Steps 5–6 deliver QR attendance.

---

## 7. Open questions for you

1. **Payments on the public page** — full history, payment *status* only, or none? (Drives §5.) My recommendation: status only.
2. **Token rotation** — do you want a "regenerate QR" button in v1, or defer it?
3. **Domain/path** for the public URL — confirm the public base URL (e.g. `app.netrofit.com/p/s/...`) so the QR encodes the right host.
4. **Attendance scope check** — should a scan auto-pick the student's *currently active* session if staff scan from a general kiosk, or always require staff to first open the specific session screen? (v1 plan assumes the latter — staff open the session, then scan.)

---

### Key files this feature touches

| Area | Path |
|------|------|
| Schema | `aws/sql/schema.sql` (students ~L352) |
| Migration | `aws/sql/migrations/0XX_student_qr.sql` (new) |
| Student create/routes | `aws/lambda/api/src/routes/students.ts` |
| Public endpoint | `aws/lambda/api/src/routes/public-students.ts` (new) |
| Attendance check-in | `aws/lambda/api/src/routes/attendance.ts` |
| Contract | `aws/lambda/api/src/contract.ts` |
| Router registration | `aws/lambda/api/src/index.ts` |
| Public-endpoint reference | `aws/lambda/api/src/routes/demo-leads.ts` |
| Frontend routes | `frontend/src/app/app.routes.ts` |
| Student detail (QR display) | `frontend/src/app/features/students/student-detail/` |
| Session attendance (scanner) | `frontend/src/app/features/rooms/session-attendance/` |
| Public page (new) | `frontend/src/app/features/public/public-student/` |
| Auth interceptor (skip /public) | `frontend/src/app/core/interceptors/auth.interceptor.ts` |
