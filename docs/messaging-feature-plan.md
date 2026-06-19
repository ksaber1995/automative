# Messaging Feature Plan (WhatsApp via Meta Cloud API)

## Overview

Netrofit sends WhatsApp messages to students/parents on behalf of teachers using a **single Netrofit-owned WABA**. Teachers pay nothing for messaging — students pay 25 EGP/year which covers the cost. Teachers only configure templates and toggle auto-send settings.

---

## Business Model

### Pricing
- **Students pay**: 25 EGP/year for messaging service
- **Teachers pay**: nothing (included in platform)
- **Netrofit cost**: ~0.22 EGP per message (Meta utility rate for Egypt)

### Quota: Pooled per Company
- **Formula**: `3 x active_student_count` messages per month per company
- Example: 100 students = 300 messages/month pool
- Cost: 300 x 0.22 = 66 EGP/month = 792 EGP/year
- Revenue: 100 x 25 = 2,500 EGP/year
- **Profit: ~1,700 EGP/year (68% margin)**

The pool model means students who attend well "donate" their unused quota to cover heavy-absence students. No individual student goes unnotified.

### Cost Control Gates
1. **Messaging OFF by default — requires admin approval** — every company starts with `messaging_enabled = 'DISABLED'`. When a teacher toggles messaging ON, the status changes to `'PENDING'` (a request). You (Netrofit admin) review and approve it from the admin project, changing status to `'ACTIVE'`. Until approved, zero messages are sent. You can also reject or revoke at any time.
2. **QR activation = payment gate** — messages are only sent for students who have activated their QR code (`qr_activated = true`). No QR activation = student hasn't paid the 25 EGP = no messages = no cost. This naturally limits the audience to paying students only.
3. **Pooled monthly cap** — hard limit at `3 x activated_student_count` (only QR-activated students count toward quota), API rejects after cap.

### Abuse Safeguards
1. **Fixed templates only** — teachers pick from predefined message types, no free-text messages
2. **Per-recipient cooldown** — same message type to same number max once per 24h
3. **Rate limiting** — max 50 messages per session save, max 100 per hour per company
4. **Audit log** — every message logged with company, type, recipient, timestamp
5. **Kill switch** — admin can disable messaging for any company instantly
6. **Single sender** — all messages go from Netrofit's WABA, teachers cannot access credentials

---

## 1. Message Types

| Type | Trigger | Recipient | Template Variables |
|------|---------|-----------|-------------------|
| **Absence** | Auto/manual after session attendance | Parent (`parent_phone`) | `{studentName}`, `{className}`, `{courseName}`, `{date}`, `{sessionNumber}`, `{academyName}` |
| **Payment Delay** | Auto/manual on overdue installment | Student (`phone`) | `{studentName}`, `{amount}`, `{dueDate}`, `{courseName}`, `{academyName}` |
| **Absence Warning** | Auto after N continuous absences | Parent (`parent_phone`) | `{studentName}`, `{className}`, `{courseName}`, `{absenceCount}`, `{lastAttendedDate}`, `{academyName}` |
| **Exam Results** | Auto/manual after recording result | Parent (`parent_phone`) | `{studentName}`, `{examName}`, `{courseName}`, `{grade}`, `{maxGrade}`, `{percentage}`, `{academyName}` |

All messages include `{academyName}` so parents know which academy is contacting them (since the sender number is Netrofit's, not the teacher's).

---

## 2. Database Schema

### 2.1 `messaging_config` -- Netrofit's WABA credentials (admin-only, single row)

```sql
-- Stored in AWS Secrets Manager, NOT in DB.
-- Secret: /prod/automate-magic/whatsapp-credentials
-- Keys: phone_number_id, access_token, waba_id, webhook_verify_token
```

No per-company credentials table needed. Netrofit owns the single WABA.

### 2.2 `message_templates` -- per-company editable templates

```sql
CREATE TABLE message_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL
                  CHECK (type IN ('ABSENCE', 'PAYMENT_DELAY', 'ABSENCE_WARNING', 'EXAM_RESULTS')),
    body        TEXT NOT NULL,             -- Template text with {placeholders}
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, type)
);
```

### 2.3 `message_settings` -- company-level messaging config

```sql
CREATE TABLE message_settings (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id                  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    messaging_status             VARCHAR(20) NOT NULL DEFAULT 'DISABLED'
                                   CHECK (messaging_status IN ('DISABLED', 'PENDING', 'ACTIVE', 'REJECTED', 'REVOKED')),
    absence_warning_threshold   INTEGER NOT NULL DEFAULT 3,      -- after N continuous absences
    auto_send_absence           BOOLEAN NOT NULL DEFAULT false,
    auto_send_payment_delay     BOOLEAN NOT NULL DEFAULT false,
    auto_send_absence_warning   BOOLEAN NOT NULL DEFAULT true,
    auto_send_exam_results      BOOLEAN NOT NULL DEFAULT false,
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id)
);
```

### 2.4 `message_log` -- audit trail of every sent message

```sql
CREATE TABLE message_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type            VARCHAR(30) NOT NULL,
    recipient_phone VARCHAR(50) NOT NULL,
    recipient_name  VARCHAR(200),
    student_id      UUID REFERENCES students(id) ON DELETE SET NULL,
    body            TEXT NOT NULL,          -- Final rendered message
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
    meta_message_id VARCHAR(100),          -- WhatsApp message ID from Meta
    error_message   TEXT,
    sent_at         TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_message_log_company    ON message_log(company_id);
CREATE INDEX idx_message_log_student    ON message_log(student_id);
CREATE INDEX idx_message_log_type       ON message_log(type);
CREATE INDEX idx_message_log_status     ON message_log(status);
CREATE INDEX idx_message_log_created_at ON message_log(created_at);
```

### 2.5 `messaging_quota` -- track monthly usage per company

```sql
CREATE TABLE messaging_quota (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    month           VARCHAR(7) NOT NULL,    -- '2026-06'
    messages_sent   INTEGER NOT NULL DEFAULT 0,
    quota_limit     INTEGER NOT NULL,        -- 3 x active_student_count at month start
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, month)
);
```

---

## 3. API Endpoints

### 3.1 Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/messaging/templates` | List all templates for the company |
| `PUT`  | `/api/messaging/templates/:type` | Create or update a template by type |
| `POST` | `/api/messaging/templates/:type/preview` | Preview with sample data |

### 3.2 Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/messaging/settings` | Get messaging settings (includes status) |
| `PUT`  | `/api/messaging/settings` | Update settings (thresholds, auto-send toggles) |
| `POST` | `/api/messaging/settings/request` | Teacher requests to enable messaging (DISABLED → PENDING) |

### 3.3 Admin (Netrofit admin project only)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/admin/messaging/requests` | List all companies with PENDING messaging requests |
| `PUT`  | `/api/admin/messaging/:companyId/approve` | Approve request (PENDING → ACTIVE) |
| `PUT`  | `/api/admin/messaging/:companyId/reject` | Reject request (PENDING → REJECTED) |
| `PUT`  | `/api/admin/messaging/:companyId/revoke` | Revoke access (ACTIVE → REVOKED) |

### 3.3 Quota

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/messaging/quota` | Get current month usage & remaining |

### 3.4 Sending

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/messaging/send` | Send a message (type + studentId) — checks quota |
| `POST` | `/api/messaging/send-bulk` | Send to multiple students (type + studentIds[]) |

### 3.5 Log

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/messaging/log` | List sent messages (paginated, filterable by type/status/date) |

### 3.6 Webhook (public, no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/public/messaging/webhook` | Meta webhook verification (challenge) |
| `POST` | `/api/public/messaging/webhook` | Receive delivery status updates from Meta |

---

## 4. Meta Cloud API Integration

### 4.1 Sending a Message

Netrofit's backend reads WABA credentials from AWS Secrets Manager (cached in Lambda memory), then:

```
POST https://graph.facebook.com/v21.0/{phone_number_id}/messages
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "to": "20XXXXXXXXXX",
  "type": "text",
  "text": { "body": "Message from [Academy Name]:\n\nRendered template text here" }
}
```

### 4.2 Phone Number Formatting

- Strip leading `0` from Egyptian numbers, prepend `20`
- Store normalized E.164 in the send call: `20XXXXXXXXXX`
- Validate phone exists before sending; skip + log as FAILED with reason if missing

### 4.3 Message Prefix

Every message starts with: `"Message from {academyName}:"` so the parent knows which academy is contacting them via Netrofit's shared number.

### 4.4 Webhook for Delivery Status

Meta sends `POST` to our webhook with status updates (`sent`, `delivered`, `read`, `failed`). We update `message_log.status` accordingly.

---

## 5. Quota Enforcement

### Flow on every send:

```
1. Get or create messaging_quota row for (company_id, current_month)
2. If row doesn't exist, calculate quota_limit = 3 x active_student_count
3. Check: messages_sent < quota_limit
4. If over limit → reject with ERRORS.MESSAGING.QUOTA_EXCEEDED
5. If under → send message, increment messages_sent
```

### Quota calculation:
- `quota_limit = 3 x COUNT(students WHERE qr_activated = true AND company_id = X)`
- Only QR-activated students count — non-activated students don't inflate the quota
- Quota resets automatically each month (new row created on first send)
- Admin can manually adjust `quota_limit` for specific companies

---

## 6. Auto-Send Triggers (Backend Logic)

All auto-send triggers check:
1. `messaging_status` = `'ACTIVE'` (admin-approved — teacher requests, you approve)
2. The specific `auto_send_*` toggle is ON
3. Student has `qr_activated = true` (no QR = hasn't paid = skipped entirely)
4. Quota not exceeded
5. Recipient phone exists and is valid
6. Cooldown: same type + same recipient not sent in last 24h

### 6.1 Absence (after attendance save)

In `attendance.ts` `saveForSession` handler:
- After saving attendance, for each student marked absent:
  - If `auto_send_absence` is ON, send absence message to `parent_phone`

### 6.2 Absence Warning (continuous absence check)

In `attendance.ts` `saveForSession` handler:
- After saving, for each absent student:
  - Count continuous absences (last N sessions of that class, ordered by date)
  - If count >= `absence_warning_threshold`, send warning to `parent_phone`
  - Only send once per threshold breach (check `message_log` — skip if warning sent in last 7 days for same student+class)

### 6.3 Payment Delay (overdue installments)

In `installments.ts` or via a scheduled check:
- When an installment passes its due date without payment
- If `auto_send_payment_delay` is ON, send to student's `phone`

### 6.4 Exam Results (after recording)

In `exams.ts` `saveResult` / `recordByQr` handler:
- After saving a result, if `auto_send_exam_results` is ON:
  - Send exam result message to `parent_phone`

---

## 7. Frontend Structure

### 7.1 Sidebar

Add under academic group:
```
Messages (pi-comments)  -->  /messaging
```

### 7.2 Pages / Tabs

**`/messaging`** -- Main messaging page with tabs:

| Tab | Content |
|-----|---------|
| **Templates** | Edit templates for each message type. Each has a textarea with placeholder guide, live preview, save button. Teachers can only edit body text within the fixed template structure. |
| **Settings** | Messaging status banner (DISABLED → "Request Activation" button, PENDING → "Awaiting Approval" badge, ACTIVE → green "Active", REJECTED/REVOKED → red with reason). Continuous absence threshold (number input, 2-10). Auto-send toggles per type (switches, disabled until ACTIVE). |
| **Usage** | Monthly quota bar (used/total). Message log table with filters: type, status, date range. Columns: date, student, type, recipient, status, body preview. |

No credentials tab — Netrofit manages the WABA centrally.

### 7.3 Manual Send Buttons (contextual)

- **Session attendance page**: "Notify Absent" button after saving attendance
- **Exam results page**: "Send Results" button after recording grades
- **Installments/dues page**: "Send Reminder" for overdue items

### 7.4 Frontend Files

```
frontend/src/app/features/messaging/
  services/
    messaging.service.ts          -- API calls (templates, settings, quota, send, log)
  messaging-page/
    messaging-page.component.ts   -- Main page with tabs
    messaging-page.component.html
```

### 7.5 Route

```typescript
{ path: 'messaging', loadComponent: () => import('./features/messaging/messaging-page/messaging-page.component').then(m => m.MessagingPageComponent) }
```

---

## 8. Backend Files

```
aws/lambda/api/src/routes/messaging.ts       -- All messaging route handlers
aws/lambda/api/src/utils/whatsapp.ts          -- Meta Cloud API client (send, format phone, quota check)
aws/lambda/api/src/utils/message-renderer.ts  -- Template placeholder renderer
aws/sql/migrations/044_messaging.sql          -- All tables (templates, settings, log, quota)
```

Contract additions in `contract.ts`:
```typescript
messaging: {
  listTemplates:     GET    /api/messaging/templates
  putTemplate:       PUT    /api/messaging/templates/:type
  previewTemplate:   POST   /api/messaging/templates/:type/preview
  getSettings:       GET    /api/messaging/settings
  putSettings:       PUT    /api/messaging/settings
  getQuota:          GET    /api/messaging/quota
  send:              POST   /api/messaging/send
  sendBulk:          POST   /api/messaging/send-bulk
  listLog:           GET    /api/messaging/log
  webhookVerify:     GET    /api/public/messaging/webhook
  webhookReceive:    POST   /api/public/messaging/webhook
}
```

---

## 9. Default Templates

### Absence (to parent)
```
Message from {academyName}:

Dear {parentName}, your child {studentName} was absent today from {className} ({courseName}) - Session #{sessionNumber} on {date}. Please ensure regular attendance.
```

### Payment Delay (to student)
```
Message from {academyName}:

Dear {studentName}, your payment of {amount} {currency} for {courseName} was due on {dueDate}. Please settle at your earliest convenience.
```

### Absence Warning (to parent)
```
Message from {academyName}:

Dear {parentName}, your child {studentName} has been absent for {absenceCount} consecutive sessions in {className} ({courseName}). Last attended: {lastAttendedDate}. Please contact us to discuss.
```

### Exam Results (to parent)
```
Message from {academyName}:

Dear {parentName}, {studentName} scored {grade}/{maxGrade} ({percentage}%) in {examName} for {courseName}.
```

---

## 10. Implementation Order

### Phase 1 -- Foundation
1. Migration `044_messaging.sql` (all tables)
2. Store Netrofit WABA credentials in AWS Secrets Manager
3. Backend: `messaging.ts` routes (templates CRUD, settings CRUD, quota GET)
4. Backend: `whatsapp.ts` utility (Meta API client, phone formatter)
5. Backend: `message-renderer.ts` (placeholder replacement)
6. Frontend: `messaging.service.ts`
7. Frontend: Messaging page with Templates + Settings tabs
8. Sidebar menu item

### Phase 2 -- Sending & Log
9. Backend: `send` and `send-bulk` endpoints with quota enforcement
10. Backend: `message_log` insert on every send
11. Frontend: Usage tab (quota bar + log table)
12. Frontend: Manual "Notify Absent" / "Send Results" buttons

### Phase 3 -- Auto-Send
13. Backend: Hook into `attendance.ts` for absence + absence warning auto-send
14. Backend: Hook into `exams.ts` for exam results auto-send
15. Backend: Payment delay check (on installment overdue)

### Phase 4 -- Webhook & Polish
16. Public webhook endpoint for Meta delivery status updates
17. Update `message_log.status` on webhook events
18. Admin dashboard: view all companies' usage, kill switch

---

## 11. Security & Safeguards

- **Single WABA** — Netrofit owns the only WhatsApp sender; teachers never see credentials
- **Credentials in Secrets Manager** — not in DB, cached in Lambda memory
- **Fixed templates** — teachers can only edit body text, cannot send arbitrary messages
- **Pooled quota** — `3 x student_count` per month, hard-rejected after limit
- **24h cooldown** — same message type to same number max once per 24 hours
- **Rate limiting** — max 50 msgs per attendance save, max 100/hour per company
- **Admin approval flow** — teacher requests → status `PENDING` → admin approves → `ACTIVE`. No messages until you approve.
- **QR = payment gate** — only QR-activated (paid) students receive messages; non-activated = zero cost
- **Phone validation** — skip + log FAILED if phone missing/invalid
- **Kill switch** — admin can disable any company's messaging instantly
- **Webhook signature** — validates `X-Hub-Signature-256` from Meta
- **Audit trail** — every message logged in `message_log` with full details
