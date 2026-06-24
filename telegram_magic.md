# Feature Plan: Telegram Attendance & Auto-Notifications

Two related capabilities:

1. **Auto-notify (outbound)** — when a student is marked **present** or **absent**, automatically push a Telegram message to the student *and* their parent. Telegram is **automatic**; the existing WhatsApp click-to-chat button **stays** as the manual fallback.
2. **Attendance bot (inbound)** — a Telegram bot where a secretary/teacher types a **student code** (the sequential number from `student_code`); a **queue** listens to the bot, resolves the code, and records attendance for the current session — replying ✓/✗ in the chat.

---

## 0. ⚠️ Read this first — the Telegram constraint that decides the architecture

Telegram has **two different APIs**, and the difference dictates everything below.

| | **Bot API** (a bot: `@YourAcademyBot`) | **Client API / MTProto** (a real user account) |
|---|---|---|
| Can message a person **by phone number**? | ❌ **No.** A bot can only message someone **after that person has pressed "Start"** on the bot. There is no "send to +20100… by phone." | ✅ Yes — a logged-in *user account* can `contacts.importContacts` a phone → resolve to a Telegram user → message them. |
| Messages appear **"from"** | The bot | The **teacher's own Telegram account** |
| Setup per recipient | One-time: student/parent taps a deep link → presses Start (we capture their `chat_id`) | None for the recipient — but the recipient's privacy settings can still block phone resolution |
| Compliance / risk | ✅ Fully supported, intended use, no ban risk | ⚠️ **Against Telegram ToS** for unsolicited/bulk automated messaging; **accounts get banned**; needs the teacher's login code (and 2FA password) and a **persistent connection** (bad fit for Lambda) |
| Runs on our stack (Lambda)? | ✅ Webhook → API Gateway → Lambda is a perfect fit | ❌ MTProto is a long-lived TCP session — needs a always-on worker (Fargate/ECS/EC2), not Lambda |

**What this means for your request:**
- *"Each teacher authenticates his Telegram through us and we send from his Telegram"* and *"send to the student/parent by their phone number"* both describe the **MTProto user-account** path. It is technically possible (GramJS/Telethon) **but** it is ToS-violating, ban-prone, and architecturally heavy on our serverless stack.
- The **robust, supported** way to auto-notify is the **Bot API**: students/parents link once (tap a deep link — exactly like scanning their QR), then we can message them forever, reliably, for free, with delivery confirmation.

### Recommendation
Ship the **Bot API** design for **both** sub-features (it covers the attendance bot natively and the auto-notify well). Treat the *"messages literally sent from each teacher's personal account"* requirement as a **separate, optional Phase 2** behind a clear risk warning. The bot messages can still be **branded per teacher/academy** ("📚 From <Academy> — Coach <Teacher>: …"), which satisfies the *intent* (parents know who it's from) without the ToS/ban exposure.

> **Decision needed (Q1):** Accept the bot-based auto-notify (recommended), or do you explicitly want the MTProto "from the teacher's own account" path despite the ban risk and the extra always-on infrastructure? The rest of this plan assumes **bot-first**, and isolates the MTProto path in §9 so it can be added later without rework.

---

## 1. Architecture at a glance (bot-first)

```
                         ┌─────────────────────────────────────────────┐
                         │            Telegram (cloud)                  │
                         │   @AcademyBot  ◀── students/parents/staff    │
                         └───────▲───────────────────────┬──────────────┘
   OUTBOUND (notify)            │ sendMessage             │ updates (webhook)
                                │                         ▼
   attendance write ─► telegram_outbox ─► [SQS send-queue] ─► Sender Lambda ─► Telegram
   (check-in / session end)                                        │
                                                                   │
   INBOUND (attendance bot)                                        │
   Telegram update ─► API GW /telegram/webhook ─► [SQS inbound-queue] ─► Worker Lambda
                       (verify secret_token)                              │  resolve student_code
                                                                          │  mark attendance
                                                                          └─► reply ✓/✗ in chat
```

- **One bot per company** (multi-tenant): each academy registers its own bot token (so messages come from *their* `@Bot`, and chat_ids never collide across tenants). Store the token encrypted.
- **Two SQS queues** (the "queue that listens to the bot"): one for **inbound** updates (decouples the webhook from processing, gives retries + ordering + idempotency), one for **outbound** sends (rate-limit-friendly, retryable).
- Everything reuses the existing **ts-rest contract → route → `index.ts`** pattern and the **`session_attendance`** model. The attendance bot reuses the **`student_code` → `lookupByCode`** path we just shipped.

---

## 2. Data model changes (migration `046_telegram.sql` + `schema.sql`)

Follow the established migration pattern (numbered SQL file **and** an idempotent code-migration in `aws/lambda/api/src/routes/migrations.ts`, e.g. `setupTelegram`). Mirror `044_whatsapp_templates.sql` for the template store.

### 2a. Per-company bot config & settings
```sql
CREATE TABLE telegram_settings (
  company_id        UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  bot_username      VARCHAR(64),            -- e.g. 'MyAcademyBot' (for deep links)
  bot_token_secret  VARCHAR(255),           -- ARN/key of the token in Secrets Manager (NEVER the raw token)
  webhook_secret    VARCHAR(64),            -- random; Telegram echoes it in X-Telegram-Bot-Api-Secret-Token
  enabled           BOOLEAN NOT NULL DEFAULT false,
  notify_on_present BOOLEAN NOT NULL DEFAULT true,
  notify_on_absent  BOOLEAN NOT NULL DEFAULT true,
  notify_target     VARCHAR(16) NOT NULL DEFAULT 'BOTH'   -- STUDENT | PARENT | BOTH
                      CHECK (notify_target IN ('STUDENT','PARENT','BOTH')),
  created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### 2b. Who is linked to which Telegram chat
A bot can only message a `chat_id` it has captured via a Start deep link. One table covers students, parents, and staff operators.
```sql
CREATE TABLE telegram_links (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role         VARCHAR(16) NOT NULL CHECK (role IN ('STUDENT','PARENT','STAFF')),
  student_id   UUID REFERENCES students(id)  ON DELETE CASCADE,   -- for STUDENT/PARENT
  employee_id  UUID REFERENCES employees(id) ON DELETE CASCADE,   -- for STAFF (bot operators)
  chat_id      BIGINT NOT NULL,             -- Telegram chat id we send to
  telegram_username VARCHAR(64),
  linked_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id, role, chat_id),
  CHECK ( (role IN ('STUDENT','PARENT') AND student_id IS NOT NULL)
       OR (role = 'STAFF' AND employee_id IS NOT NULL) )
);
CREATE INDEX idx_tg_links_student ON telegram_links(student_id);
CREATE INDEX idx_tg_links_chat    ON telegram_links(company_id, chat_id);
```

### 2c. Editable message templates (reuse the WhatsApp pattern)
Either extend `whatsapp_templates` with a `channel` column, or add a parallel table. Cleanest is a parallel table so the two channels evolve independently:
```sql
CREATE TABLE telegram_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL CHECK (type IN ('PRESENT','ABSENT','LINK_WELCOME')),
  body        TEXT NOT NULL,              -- supports {{studentName}}, {{className}}, {{date}}, {{sessionNumber}}, {{academyName}}, {{teacherName}}
  UNIQUE (company_id, type)
);
```
Defaults are filled in app code for any type a company hasn't customized — same approach as `WhatsappTemplatesService`.

### 2d. Outbox (delivery tracking + retries)
Auto-notify must be reliable and auditable, so we persist intent before sending:
```sql
CREATE TABLE telegram_outbox (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id      BIGINT NOT NULL,
  student_id   UUID REFERENCES students(id) ON DELETE SET NULL,
  session_id   UUID REFERENCES sessions(id) ON DELETE SET NULL,
  kind         VARCHAR(16) NOT NULL,       -- PRESENT | ABSENT
  body         TEXT NOT NULL,
  status       VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','SKIPPED')),
  error        TEXT,
  attempts     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  sent_at      TIMESTAMPTZ,
  UNIQUE (session_id, student_id, chat_id, kind)   -- idempotent: never double-notify the same fact
);
```

*(Phase 2 / MTProto only — not built in Phase 1):*
```sql
-- Encrypted GramJS/Telethon session per teacher, for "send from my own account".
ALTER TABLE employees ADD COLUMN IF NOT EXISTS telegram_session_secret VARCHAR(255); -- Secrets Manager ref, never the raw string
```

---

## 3. Backend — contract & routes (`aws/lambda/api`)

New route file `routes/telegram.ts`, registered in `index.ts` as `telegram: telegramRoutes`, with contract entries in `contract.ts` (Zod), following the exact pattern of `whatsapp`/`students`.

### 3a. Settings & linking (authenticated, staff)
- `GET /api/telegram/settings` / `PATCH /api/telegram/settings` — toggle enabled, choose present/absent, target, etc. (permission: a new `telegram` resource or reuse `academy` write).
- `POST /api/telegram/bot` — owner saves the bot token (we stash it in Secrets Manager, store the ARN + derive `bot_username`, generate `webhook_secret`, and call Telegram `setWebhook`).
- `GET /api/telegram/link/:role/:id` — returns a **deep link** `https://t.me/<bot>?start=<opaque-payload>` for a student or parent. The payload is a signed token (reuse the same idea as `qr_token`) encoding `{companyId, studentId, role}` so the webhook can attribute the Start press. Surface this as a button/QR on the student detail page (next to the existing QR dialog).
- `DELETE /api/telegram/link/:linkId` — unlink.

### 3b. Webhook (public, no JWT — verified by secret token)
- `POST /api/telegram/webhook/:companyKey` — **no `extractTenantContext`** (Telegram calls it). Instead:
  1. Verify the `X-Telegram-Bot-Api-Secret-Token` header equals the company's `webhook_secret` (reject otherwise — this is the auth).
  2. Resolve `companyKey` → `telegram_settings` row.
  3. **Enqueue the raw update to the inbound SQS queue** and return `200` immediately (Telegram retries on non-200; keep the handler tiny). This is the "queue that listens to the bot."
- Mirrors the established **public-endpoint pattern** (`routes/demo-leads.ts`, `routes/public-students.ts`) — declares no `authorization` header in the contract.

---

## 4. Inbound: the attendance bot (the "type a code → mark present" flow)

**Worker Lambda** (SQS consumer on the inbound queue). For each update:

1. **Identify the sender.** Look up `telegram_links (role=STAFF, chat_id)`. If the chat isn't a linked staff member → reply *"You're not authorised. Ask your admin to link your Telegram."* and stop. (Linking staff: same deep-link Start flow, but the link is generated from the user-management screen and marks `role=STAFF`.)
2. **Parse the message.** Accept either a bare number (`5`) or a command (`/present 5`, `/absent 5`). The bare-number default = mark present (your described flow: "secretary adds number for student → I take attendance").
3. **Resolve the code.** Reuse the exact logic of `studentsRoutes.lookupByCode` — `SELECT … WHERE student_code = $1 AND company_id = $2 AND is_active = true`. Not found → reply *"❌ No student with code 5."* (your required warning).
4. **Pick the session.** Which session does the code check into? Options:
   - **(Recommended)** the staff member's **currently-running session** (there's already `sessionService.activeForStudent` and an `ActiveSessionInfo` concept; add an `activeForStaff`/"current open session in this branch" resolver). If none is open → reply *"No session is currently running — open one first."*
   - Or let the operator set context first: `/session <n>` then codes.
5. **Mark attendance.** Reuse the idempotent insert from `attendanceRoutes.checkinByQr` (`INSERT … ON CONFLICT (session_id, student_id) DO NOTHING`), including the NORMAL-vs-SUBSTITUTION logic that already exists.
6. **Reply** in-chat: *"✅ Ahmed Ali (code 5) marked present in Robotics L2 — session #7"* or the already-present / not-enrolled messages, reusing the existing translation keys.
7. **Idempotency & ordering:** SQS + the `UNIQUE(session_id, student_id)` constraint make double-sends harmless; process the queue with a small batch size to keep replies in order.

This sub-feature is **bot-only** and fully ToS-compliant — no phone numbers involved, the operator just types codes.

---

## 5. Outbound: auto-notify present / absent

**When to send (avoid spam — attendance auto-saves on every checkbox toggle!):**
- **Present →** at the moment of check-in (real-time "your child has arrived"). Hook `checkinByQr` *and* the manual `submitManualCode` path *and* `saveForSession` transitions (absent→present).
- **Absent →** at **session end** only (when attendance is finalised), reusing the existing "absent students" computation already done in `session-attendance.component.ts` (`endSession()` builds the absent list for the WhatsApp dialog) and the backend session-end path.
- Both gated by `telegram_settings.notify_on_present/absent` and `notify_target`.

**How to send (reliable):**
1. On the trigger, for each target (student/parent) that has a `telegram_links` row, **insert a `telegram_outbox` row** (status `PENDING`) — the `UNIQUE` constraint guarantees we never double-notify the same (session, student, kind).
2. A DB-insert → **enqueue to the outbound SQS queue** (or a 1-min EventBridge sweep of `PENDING` rows — simpler, also fine).
3. **Sender Lambda** renders the template (`telegram_templates` + defaults, via a `renderTemplate` util mirroring `renderWhatsappTemplate`), calls Telegram `sendMessage`, and flips the row to `SENT`/`FAILED` (+ `error`, `attempts`). Respect Telegram's ~30 msg/sec global and per-chat limits; back off on `429`.

**WhatsApp stays as-is** — the manual click-to-chat buttons remain. Telegram is the automatic channel layered alongside.

---

## 6. Frontend (Angular 21, standalone)

- **Settings page** `features/telegram/telegram-settings/` (or a tab in existing settings):
  - Paste **bot token**, show connection status (calls `setWebhook`), bot username.
  - Toggles: enabled, notify-on-present, notify-on-absent, target (student/parent/both).
  - Edit **templates** (PRESENT / ABSENT / LINK_WELCOME) — reuse the WhatsApp templates editor UI.
- **Student detail page** (`features/students/student-detail/`): a **"Connect Telegram"** action next to the existing QR button — shows the `t.me/<bot>?start=…` deep link as a tappable link **and a QR** (reuse the `qrcode` lib already used by `student-qr-dialog`), so a parent scans it, presses Start, and is linked. Show per-student link status (student linked? parent linked?).
- **User/staff management** (`features/users/…`): a "Link Telegram for attendance bot" deep link per staff member, so secretaries/teachers can drive the inbound bot.
- **Session attendance page**: optional small indicator that Telegram auto-notify is on, and (nice-to-have) a per-session "resend notifications" button reading from `telegram_outbox`.
- i18n: add keys to `en.json` + `ar.json` (the app is bilingual/RTL), mirroring the `SESSION_QR` / `MONTHLY_SUBSCRIPTIONS` / `STUDENT_QR` sections.

---

## 7. Infrastructure (CDK, `aws/`)

Add to `AutomateMagicStack`:
- **2 × SQS queues** (`telegram-inbound`, `telegram-outbound`) + **dead-letter queues**.
- **2 × Lambda** consumers (inbound worker, outbound sender) with SQS event sources, or reuse the main API Lambda with separate handlers.
- **Secrets Manager** entries for bot tokens (one per company) — granted to the relevant Lambdas only.
- API Gateway route for the webhook (public).
- IAM: least-privilege (SQS send/consume, Secrets read, RDS Data/connection).
- The webhook is registered with Telegram via `setWebhook` (done in the `POST /api/telegram/bot` handler), pointing at the API custom domain `prod.api.netrofit.net`.

---

## 8. Security

- **Bot tokens & MTProto sessions are credentials** → Secrets Manager, encrypted; **never** returned to the browser or logged.
- **Webhook auth** = the `secret_token` Telegram echoes back; reject mismatches. Optionally allow-list Telegram's IP ranges.
- **Inbound authorisation:** only `telegram_links(role=STAFF)` chats with attendance permission can mark attendance; ignore everyone else.
- **Tenant isolation:** every link/outbox/lookup is scoped by `company_id`; a chat_id resolves within one company only.
- **Privacy:** linking is **opt-in** (the person presses Start) — clean consent trail, unlike phone-number messaging.

---

## 9. Phase 2 (optional) — "send from the teacher's own Telegram account" (MTProto)

Only if §0/Q1 says you truly need it. Self-contained so it bolts on later:
- Use **GramJS** (Node) on an **always-on worker** (Fargate/ECS) — *not* Lambda.
- Teacher auth flow we proxy: phone → Telegram sends a login code → teacher enters it in our UI → (optional 2FA password) → we get a **session string** → store **encrypted** (`employees.telegram_session_secret`).
- Send present/absent by resolving the student/parent phone via `contacts.importContacts` then `sendMessage` **from the teacher's session**.
- ⚠️ **Risks to accept in writing:** Telegram ToS prohibits automated/unsolicited messaging; **accounts can be banned**; phone resolution fails if the recipient restricts "find me by number"; flood limits; the teacher must trust us with their session. Mitigate: per-teacher rate caps, only message existing contacts/opted-in numbers, human-like pacing.

---

## 10. Build order (suggested)

1. **Migration `046` + `schema.sql`** — `telegram_settings`, `telegram_links`, `telegram_templates`, `telegram_outbox`. *(No user-visible change.)*
2. **Bot registration + webhook plumbing** — `POST /api/telegram/bot`, `setWebhook`, secret-token verification, inbound SQS enqueue. Echo-test with a dummy `/ping`.
3. **Inbound attendance bot** — worker Lambda: parse code → reuse `lookupByCode` + `checkinByQr` insert → reply. *(Delivers your "type code in bot → attendance" flow.)*
4. **Linking UX** — deep-link + QR on student detail and staff pages; capture `chat_id` on Start.
5. **Outbound auto-notify** — outbox + sender Lambda + templates; wire present (check-in) and absent (session end) triggers + settings toggles.
6. **Settings UI + templates editor + i18n.**
7. **(Optional) Phase 2 MTProto** worker.

Steps 1–3 already deliver a working attendance bot. Steps 4–6 deliver the automatic present/absent notifications.

---

## 11. Open questions

1. **Q1 (architecture):** Bot-based auto-notify (recommended) vs MTProto "from each teacher's own account" (ToS/ban risk + always-on worker)? — see §0.
2. **One bot per company** (each academy brings its own `@Bot` token) vs **one shared platform bot**? Recommended: per-company (cleaner branding + isolation).
3. **Absent timing:** only at session end (recommended) or also a manual "notify absentees" button?
4. **Who gets notified:** student, parent, or both by default? (`notify_target`.)
5. **Inbound session selection:** auto-use the operator's currently-open session (recommended) or require `/session <n>` first?
6. **Linking reach:** parents must press Start once. Acceptable, or is that friction a blocker (which would push toward the risky MTProto path)?

---

## 12. Key files this feature touches

| Area | Path |
|------|------|
| Schema | `aws/sql/schema.sql` |
| Migration | `aws/sql/migrations/046_telegram.sql` (new) + `setupTelegram` in `aws/lambda/api/src/routes/migrations.ts` |
| Routes | `aws/lambda/api/src/routes/telegram.ts` (new) |
| Webhook worker / sender | new Lambda handlers (SQS consumers) under `aws/lambda/` |
| Contract | `aws/lambda/api/src/contract.ts` |
| Router registration | `aws/lambda/api/src/index.ts` |
| Reuse: attendance insert | `aws/lambda/api/src/routes/attendance.ts` (`checkinByQr`) |
| Reuse: code lookup | `aws/lambda/api/src/routes/students.ts` (`lookupByCode`) |
| Reuse: public-endpoint pattern | `aws/lambda/api/src/routes/public-students.ts`, `routes/demo-leads.ts` |
| Reuse: templates pattern | `whatsapp_templates` (migration 044), `WhatsappTemplatesService`, `renderWhatsappTemplate` |
| Frontend settings | `frontend/src/app/features/telegram/` (new) |
| Frontend linking | `frontend/src/app/features/students/student-detail/`, `.../student-qr/` (QR render) |
| Attendance triggers | `frontend/src/app/features/rooms/session-attendance/session-attendance.component.ts` (session-end absent list) |
| i18n | `frontend/src/assets/i18n/en.json`, `ar.json` |
| Infra | `aws/` CDK stack (SQS, DLQ, Secrets, Lambda event sources, webhook route) |
