# Feature Plan: Send QR + Attendance Notifications via WhatsApp

Two related capabilities:

1. **Manual** — a button that sends a student's QR / profile to the student or parent **from the center's own WhatsApp number**.
2. **Automated** — when a student is marked **present** or **absent**, auto-send a WhatsApp notification, controlled by a **per-student setting**.

These two have *different technical constraints*, so the plan splits them into phases. Read §1 first — the WhatsApp provider choice drives everything in Phase 2.

---

## 1. The decision that drives everything: how do we send WhatsApp? ⚠️

WhatsApp does **not** let arbitrary servers send messages from any number. The realistic options, with the tradeoff that matters here — *"each center sends from its own number"* + *can it be automated*:

| Option | "From the center's own number"? | Automated (no human tap)? | Media (QR image)? | Onboarding per center | Cost | ToS / ban risk |
|--------|-------------------------------|---------------------------|-------------------|----------------------|------|----------------|
| **A. Click-to-chat** (`wa.me` deep link) | ✅ Yes — opens WhatsApp on the staff phone logged into the center's number; staff taps Send | ❌ No — needs a manual tap | ❌ Link only (no attached image) | None | Free | None |
| **B. WhatsApp Cloud API** (Meta, direct) | ✅ A dedicated WABA number per center | ✅ Yes (template messages) | ✅ Yes | Heavy (business verification + template approval) | Per-conversation | Low (official) |
| **C. Cloud API via BSP** (Twilio / 360dialog / MessageBird) | ✅ Per-center sender | ✅ Yes (templates) | ✅ Yes | Medium (BSP-assisted) | Per-msg + BSP fee | Low (official) |
| **D. Unofficial lib** (Baileys / whatsapp-web.js) | ✅ The center's real WhatsApp (QR pairing) | ✅ Yes, freeform | ✅ Yes | Low (scan a pairing QR) | Free-ish | **High — number ban risk; against ToS** |

**Two hard facts about the official APIs (B/C):**
- **Business-initiated messages must be pre-approved *template* messages.** Attendance/absence alerts are business-initiated, so they must be templates (approved by Meta, ~1–2 days). Free-form text only works within 24h of a parent messaging the center first.
- The API number is **dedicated** — it can't also be used as a normal WhatsApp app on someone's phone.

**Recommendation — phased:**
- **Phase 1 (manual button): Option A, click-to-chat.** Zero cost, zero onboarding, genuinely sends from the center's own number, ships in days. It satisfies "send the QR from my phone" *today*.
- **Phase 2 (automated notifications): Option C, a BSP (Twilio or 360dialog).** Automation requires an official API; a BSP is far less painful than raw Cloud API for per-center onboarding and template management, and avoids the ToS/ban risk of Option D. (Option B is the same code path if you'd rather contract Meta directly later — the BSP is swappable.)

> ❗ **This is the one thing I need you to confirm before building Phase 2** — it determines cost, onboarding flow, and how much we build. Phase 1 needs no decision; I can start it immediately.

---

## 2. Phase 1 — Manual "Send via WhatsApp" button (click-to-chat)

The cheapest, fastest win. No backend messaging, no API keys.

### How it works
- On the **student detail** page (next to the existing "QR Code" button) and inside the **QR dialog**, add a **"Send via WhatsApp"** button.
- It opens: `https://wa.me/<recipientPhoneE164>?text=<prefilled message>` in a new tab.
- WhatsApp Web/app opens on the staff device — **already logged into the center's number** — with the message pre-filled to the parent/student. Staff taps send.
- The message text contains the **public profile link** (`https://dev.netrofit.com/p/s/<qrToken>`), which shows the student's QR + details. (Click-to-chat can't attach a PNG, but the link opens the page that *has* the QR — and we add a public QR-image endpoint in §4 so the link can even be a direct image.)

### What's needed
- **Phone normalization to E.164.** Students store local phones (e.g. `01012345678`). `wa.me` needs `201012345678` (country code, no `+`, no spaces). Add a small helper that prefixes the company's country dial code (default Egypt `+20`, strip leading `0`). Store/confirm `companies.country` → dial code map. *(This same helper is reused in Phase 2.)*
- **Recipient choice**: default to `parent_phone`, fall back to `phone`. A small dropdown/toggle on the button ("send to parent / student").
- **Bilingual message text** (EN/AR) — reuse the i18n setup; build the text from a translation key with the student name + link interpolated.

### Effort: small. Frontend-only + one tiny helper. No infra, no cost.

---

## 3. Phase 2 — Automated attendance / absence notifications

This is the substantial part. It needs an official API (per §1), message templates, per-student settings, phone normalization, and — importantly — **async infrastructure we don't have yet**.

### 3a. When do we send?

| Trigger | Where it fires | How "who" is determined |
|---------|----------------|--------------------------|
| **Present** | The moment attendance is committed — `attendance.checkinByQr` and `attendance.saveForSession` (`routes/attendance.ts`) | The students just marked present, whose `notify_attendance` is on |
| **Absent** | **Session end** — `sessions.end` (`routes/sessions.ts`) | Absence = *no row* in `session_attendance` (sparse table). Only at session end do we know who's absent: `enrolled − present`. Enqueue for those whose `notify_absence` is on. |

> Key insight: we **cannot** know absence until the session ends, because absence is the absence of a row. So absence notifications hang off the existing `sessions.end` handler, not off attendance writes.

### 3b. Why we need a queue (not inline sends)

The API runs in a **single Lambda, 30s timeout, no SQS/EventBridge today** (confirmed in `core-stack.ts`). Sending WhatsApp messages to a 100-student class inline in the attendance/session-end request would:
- risk the 30s timeout,
- make a transient WhatsApp outage **fail the attendance save itself**.

**Design:** decouple sending from the request.
- Add an **SQS queue** (`whatsapp-outbox`) + a small **sender Lambda** (CDK addition).
- The attendance/session-end handlers do their normal DB work, then **enqueue** one message per recipient (fast, fire-and-forget) and return.
- The sender Lambda drains the queue, calls the BSP API, retries on failure (SQS redrive + DLQ), and records delivery status.

This is a modest, well-contained CDK change (queue + lambda + IAM), and it makes the whole thing resilient.

### 3c. Per-center WhatsApp credentials

Each center needs its own sender. Following the existing **Secrets Manager** pattern (`utils/secrets.ts`):
- Store per company at `/{stage}/company/{companyId}/whatsapp` → `{ provider, phoneNumberId, accessToken, ... }`.
- Add `getWhatsAppConfig(companyId)` (cached, like `getDBCredentials`).
- A row flag `companies.whatsapp_enabled` + an **onboarding/settings screen** where an admin connects the center's number (BSP embedded signup or pastes credentials).

### 3d. Message templates (bilingual)

Business-initiated → must be **approved templates**. Define and submit, in EN + AR:
- `attendance_present`: "{{student}} has arrived at {{academy}} — {{class}} at {{time}}."
- `attendance_absent`: "{{student}} was marked absent from {{class}} on {{date}}."

Store template IDs in the WhatsApp config. The sender Lambda picks the template + language per the recipient/company.

---

## 4. Data model changes

### Migration (next number, e.g. `030_whatsapp.sql`)

```sql
-- Per-student notification preferences (default OFF — opt-in, for consent).
ALTER TABLE students ADD COLUMN IF NOT EXISTS notify_attendance BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS notify_absence    BOOLEAN NOT NULL DEFAULT false;
-- Where to send: PARENT (default) or STUDENT.
ALTER TABLE students ADD COLUMN IF NOT EXISTS notify_recipient  VARCHAR(10) NOT NULL DEFAULT 'PARENT';

-- Per-company WhatsApp enablement (token itself lives in Secrets Manager).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN NOT NULL DEFAULT false;

-- Outbound log: audit, dedupe (don't double-send), and delivery status.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  student_id    UUID REFERENCES students(id) ON DELETE SET NULL,
  session_id    UUID REFERENCES sessions(id) ON DELETE SET NULL,
  to_phone      VARCHAR(32) NOT NULL,
  kind          VARCHAR(20) NOT NULL,   -- PRESENT | ABSENT | QR_SHARE
  status        VARCHAR(20) NOT NULL DEFAULT 'QUEUED', -- QUEUED|SENT|DELIVERED|FAILED
  provider_id   VARCHAR(128),           -- BSP message id
  error         TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, student_id, kind)  -- idempotency: one present/absent per student per session
);
```

The `UNIQUE (session_id, student_id, kind)` is the dedupe guard — re-running session-end or re-scanning won't double-message a parent.

---

## 5. Backend changes

- **`utils/whatsapp.ts`** (new) — mirrors `utils/email.ts`. `sendTemplate(companyId, toPhone, template, lang, params)` calling the BSP; `getWhatsAppConfig(companyId)` from Secrets Manager.
- **`utils/phone.ts`** (new) — `toE164(localPhone, countryCode)` (used by Phase 1 button too).
- **`routes/attendance.ts`** — after a successful present-mark (both `checkinByQr` and `saveForSession`), enqueue PRESENT notifications for opted-in students.
- **`routes/sessions.ts` `end`** — compute absentees (`enrolled − present`), enqueue ABSENT notifications for opted-in students.
- **`routes/companies.ts`** — extend settings with WhatsApp connect/disconnect + status endpoints.
- **`routes/students.ts`** — accept the new `notify_attendance` / `notify_absence` / `notify_recipient` on create/update; expose in the DTO.
- **New sender Lambda** (`lambda/whatsapp-sender/`) — SQS-triggered; sends + updates `whatsapp_messages`.
- **Public QR image endpoint** — `GET /api/public/students/:qrToken/qr.png` (renders the QR as PNG) so messages/links can point straight at the image. Reuses the public, no-auth pattern from `public-students.ts`.

## 6. Infra (CDK — `core-stack.ts`)

- SQS `whatsapp-outbox` + DLQ.
- Sender Lambda with SQS event source, Secrets Manager read, DB access (same VPC/secret pattern as the API Lambda).
- Grant the API Lambda `sqs:SendMessage` to the outbox.

## 7. Frontend changes

- **Phase 1**: "Send via WhatsApp" button on student detail + QR dialog (with parent/student recipient toggle). Bilingual text. *(No backend.)*
- **Phase 2**:
  - **Per-student toggles** on the student form/detail: "Notify on attendance", "Notify on absence", recipient (parent/student). *(Default off — opt-in.)*
  - **Center settings screen** (extend `features/settings`): connect/disconnect WhatsApp, show connection status, optional company-wide default for the per-student toggles.
  - Optional: a "delivery log" view from `whatsapp_messages`.

---

## 8. Build order

**Phase 1 (no decision needed — can start now):**
1. `utils/phone.ts` E.164 helper (backend) or a frontend equivalent.
2. "Send via WhatsApp" button (student detail + QR dialog), bilingual, recipient toggle.
3. Public QR image endpoint (so the shared link can be the image).

**Phase 2 (after you pick the provider in §1):**
4. Migration `030` (settings columns + `whatsapp_messages`).
5. Secrets storage + `getWhatsAppConfig`; center connect/settings UI.
6. Approve EN/AR templates with the chosen BSP.
7. SQS queue + sender Lambda (CDK).
8. Enqueue hooks in `attendance` (present) and `sessions.end` (absent).
9. Per-student notification toggles UI.
10. Delivery-status webhook (BSP → updates `whatsapp_messages`).

---

## 9. Open questions for you

1. **Provider for Phase 2 (§1).** Twilio, 360dialog, raw Meta Cloud API, or the unofficial route? My recommendation: a BSP (Twilio/360dialog). *This is the blocker for Phase 2.*
2. **Phase 1 scope** — is click-to-chat (staff taps Send) acceptable for the manual QR-share button, or do you want even the manual send to be fully automatic (which forces the official API immediately)?
3. **Recipient default** — parent phone, student phone, or per-student (planned default: parent)?
4. **Consent** — parents must opt in for business-initiated WhatsApp. OK to default the per-student toggles **off** and turn on per student? (Recommended for compliance.)
5. **Present notifications volume** — notify on *every* present mark could be a lot of messages (and cost). Want present-notify limited (e.g. first arrival only), or absence-only to start?

---

### Key files this feature touches

| Area | Path |
|------|------|
| Schema / migration | `aws/sql/schema.sql`, `aws/sql/migrations/030_whatsapp.sql` (new) |
| WhatsApp send util | `aws/lambda/api/src/utils/whatsapp.ts` (new), mirror of `utils/email.ts` |
| Phone E.164 util | `aws/lambda/api/src/utils/phone.ts` (new) |
| Secrets | `aws/lambda/api/src/utils/secrets.ts` (add `getWhatsAppConfig`) |
| Attendance hooks | `aws/lambda/api/src/routes/attendance.ts` |
| Absence hook | `aws/lambda/api/src/routes/sessions.ts` (`end`) |
| Settings endpoints | `aws/lambda/api/src/routes/companies.ts` |
| Student prefs | `aws/lambda/api/src/routes/students.ts`, `shared/interfaces/student.interface.ts` |
| Public QR image | `aws/lambda/api/src/routes/public-students.ts` |
| Sender Lambda + SQS | `aws/lambda/whatsapp-sender/` (new), `aws/lib/core-stack.ts` |
| Manual button | `frontend/.../students/student-detail/`, `students/student-qr/` |
| Settings UI | `frontend/src/app/features/settings/` |
