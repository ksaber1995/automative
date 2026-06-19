# Messaging Feature Plan (WhatsApp via Meta Cloud API)

## Overview

Teachers can send WhatsApp messages to students/parents automatically or manually, using customizable templates and their own Meta (WhatsApp Business) API credentials. Each company configures its own WABA (WhatsApp Business Account) credentials.

---

## 1. Message Types

| Type | Trigger | Recipient | Template Variables |
|------|---------|-----------|-------------------|
| **Absence** | Manual or auto after session attendance | Parent (`parent_phone`) | `{studentName}`, `{className}`, `{courseName}`, `{date}`, `{sessionNumber}` |
| **Payment Delay** | Manual or auto on overdue installment | Student (`phone`) | `{studentName}`, `{amount}`, `{dueDate}`, `{courseName}`, `{installmentNumber}` |
| **Absence Warning** | Auto after N continuous absences | Parent (`parent_phone`) | `{studentName}`, `{className}`, `{courseName}`, `{absenceCount}`, `{lastAttendedDate}` |
| **Exam Results** | Auto after recording exam result | Parent (`parent_phone`) | `{studentName}`, `{examName}`, `{courseName}`, `{grade}`, `{maxGrade}`, `{percentage}` |

---

## 2. Database Schema

### 2.1 `messaging_credentials` -- WABA credentials per company

```sql
CREATE TABLE messaging_credentials (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider        VARCHAR(20) NOT NULL DEFAULT 'META',
    waba_id         VARCHAR(100),          -- WhatsApp Business Account ID
    phone_number_id VARCHAR(100) NOT NULL,  -- Meta phone number ID (sender)
    access_token    TEXT NOT NULL,           -- Permanent or long-lived token
    display_phone   VARCHAR(50),            -- Display: +20 123 456 7890
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id)
);
```

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
    absence_warning_threshold   INTEGER NOT NULL DEFAULT 3,   -- after N continuous absences
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

CREATE INDEX idx_message_log_company ON message_log(company_id);
CREATE INDEX idx_message_log_student ON message_log(student_id);
CREATE INDEX idx_message_log_type    ON message_log(type);
CREATE INDEX idx_message_log_status  ON message_log(status);
```

---

## 3. API Endpoints

### 3.1 Credentials

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/messaging/credentials` | Get company's WABA credentials (token masked) |
| `PUT`  | `/api/messaging/credentials` | Create or update WABA credentials |
| `DELETE` | `/api/messaging/credentials` | Remove credentials |
| `POST` | `/api/messaging/credentials/test` | Send a test message to verify credentials work |

### 3.2 Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/messaging/templates` | List all templates for the company |
| `PUT`  | `/api/messaging/templates/:type` | Create or update a template by type |
| `POST` | `/api/messaging/templates/:type/preview` | Preview with sample data |

### 3.3 Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/messaging/settings` | Get messaging settings |
| `PUT`  | `/api/messaging/settings` | Update settings (thresholds, auto-send toggles) |

### 3.4 Sending

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/messaging/send` | Send a message manually (type + studentId) |
| `POST` | `/api/messaging/send-bulk` | Send to multiple students (type + studentIds[]) |

### 3.5 Log

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/messaging/log` | List sent messages (paginated, filterable by type/status/date) |

### 3.6 Webhook (public, no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/public/messaging/webhook` | Meta webhook verification (challenge) |
| `POST` | `/api/public/messaging/webhook` | Receive delivery status updates from Meta |

---

## 4. Meta Cloud API Integration

### 4.1 Sending a Message

```
POST https://graph.facebook.com/v21.0/{phone_number_id}/messages
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "to": "20XXXXXXXXXX",
  "type": "text",
  "text": { "body": "Rendered template text here" }
}
```

### 4.2 Phone Number Formatting

- Strip leading `0` from Egyptian numbers, prepend `20`
- Store normalized E.164 in the send call: `20XXXXXXXXXX`
- Validate phone exists before sending; skip + log if missing

### 4.3 Webhook for Delivery Status

Meta sends `POST` to our webhook with status updates (`sent`, `delivered`, `read`, `failed`). We update `message_log.status` accordingly.

---

## 5. Auto-Send Triggers (Backend Logic)

### 5.1 Absence (after attendance save)

In `attendance.ts` `saveForSession` handler:
- After saving attendance, for each student marked absent:
  - If `auto_send_absence` is ON, queue an absence message to `parent_phone`

### 5.2 Absence Warning (continuous absence check)

In `attendance.ts` `saveForSession` handler:
- After saving, for each absent student:
  - Count their continuous absences (last N sessions of that class)
  - If count >= `absence_warning_threshold`, send absence warning to `parent_phone`
  - Only send once per threshold breach (check `message_log` for recent warning)

### 5.3 Payment Delay (overdue installments)

In `installments.ts` or via a scheduled check:
- When an installment passes its due date without payment
- If `auto_send_payment_delay` is ON, send to student's `phone`

### 5.4 Exam Results (after recording)

In `exams.ts` `saveResult` / `recordByQr` handler:
- After saving a result, if `auto_send_exam_results` is ON:
  - Send exam result message to `parent_phone`

---

## 6. Frontend Structure

### 6.1 Sidebar

Add under a new group or standalone item:
```
Messages (pi-comments)  -->  /messaging
```

### 6.2 Pages / Tabs

**`/messaging`** -- Main messaging page with tabs:

| Tab | Content |
|-----|---------|
| **Templates** | Edit templates for each message type (ABSENCE, PAYMENT_DELAY, ABSENCE_WARNING, EXAM_RESULTS). Each has a textarea with placeholder guide, live preview, save button. |
| **Settings** | Continuous absence threshold (number input). Auto-send toggles per type (switches). |
| **Credentials** | WhatsApp Business API setup: Phone Number ID, Access Token, WABA ID (optional). Test button to verify. Status indicator (connected/not configured). |
| **Log** | Table of sent messages with filters: type, status, date range. Columns: date, student, type, recipient, status, body preview. |

### 6.3 Manual Send Buttons (contextual)

- **Student detail page**: "Send Message" dropdown with message types
- **Session attendance page**: "Notify Absent" button after saving attendance
- **Exam results page**: "Send Results" button after recording grades
- **Installments/dues page**: "Send Reminder" for overdue items

### 6.4 Frontend Files

```
frontend/src/app/features/messaging/
  services/
    messaging.service.ts          -- API calls (credentials, templates, settings, send, log)
  messaging-page/
    messaging-page.component.ts   -- Main page with tabs
    messaging-page.component.html
  components/
    template-editor/              -- Reusable template editor with placeholder chips
    credentials-form/             -- WABA credentials form + test
    message-log-table/            -- Log table with filters
```

### 6.5 Route

```typescript
{ path: 'messaging', loadComponent: () => import('./features/messaging/messaging-page/messaging-page.component').then(m => m.MessagingPageComponent) }
```

---

## 7. Backend Files

```
aws/lambda/api/src/routes/messaging.ts       -- All messaging route handlers
aws/lambda/api/src/utils/whatsapp.ts          -- Meta Cloud API client (send, format phone)
aws/lambda/api/src/utils/message-renderer.ts  -- Template placeholder renderer
aws/sql/migrations/044_messaging.sql          -- All 4 tables
```

Contract additions in `contract.ts`:
```typescript
messaging: {
  getCredentials:    GET    /api/messaging/credentials
  putCredentials:    PUT    /api/messaging/credentials
  deleteCredentials: DELETE /api/messaging/credentials
  testCredentials:   POST   /api/messaging/credentials/test
  listTemplates:     GET    /api/messaging/templates
  putTemplate:       PUT    /api/messaging/templates/:type
  previewTemplate:   POST   /api/messaging/templates/:type/preview
  getSettings:       GET    /api/messaging/settings
  putSettings:       PUT    /api/messaging/settings
  send:              POST   /api/messaging/send
  sendBulk:          POST   /api/messaging/send-bulk
  listLog:           GET    /api/messaging/log
  webhookVerify:     GET    /api/public/messaging/webhook
  webhookReceive:    POST   /api/public/messaging/webhook
}
```

---

## 8. Default Templates

### Absence (to parent)
```
Dear {parentName}, your child {studentName} was absent today from {className} ({courseName}) - Session #{sessionNumber} on {date}. Please ensure regular attendance.
```

### Payment Delay (to student)
```
Dear {studentName}, your payment of {amount} {currency} for {courseName} was due on {dueDate}. Please settle at your earliest convenience.
```

### Absence Warning (to parent)
```
Dear {parentName}, your child {studentName} has been absent for {absenceCount} consecutive sessions in {className} ({courseName}). Last attended: {lastAttendedDate}. Please contact us to discuss.
```

### Exam Results (to parent)
```
Dear {parentName}, {studentName} scored {grade}/{maxGrade} ({percentage}%) in {examName} for {courseName}.
```

---

## 9. Implementation Order

### Phase 1 -- Foundation
1. Migration `044_messaging.sql` (all 4 tables)
2. Backend: `messaging.ts` routes (credentials CRUD, templates CRUD, settings CRUD)
3. Backend: `whatsapp.ts` utility (Meta API client)
4. Backend: `message-renderer.ts` (placeholder replacement)
5. Frontend: `messaging.service.ts`
6. Frontend: Messaging page with 3 tabs (Templates, Settings, Credentials)
7. Sidebar menu item

### Phase 2 -- Sending
8. Backend: `send` and `send-bulk` endpoints
9. Backend: `message_log` insert on every send
10. Frontend: Log tab on messaging page
11. Frontend: Manual "Send Message" buttons on student detail / attendance / exams

### Phase 3 -- Auto-Send
12. Backend: Hook into `attendance.ts` for absence + absence warning auto-send
13. Backend: Hook into `exams.ts` for exam results auto-send
14. Backend: Payment delay check (on installment overdue)

### Phase 4 -- Webhook
15. Public webhook endpoint for Meta delivery status updates
16. Update `message_log.status` on webhook events

---

## 10. Security Considerations

- **Access tokens** are stored encrypted or in Secrets Manager (phase 2 improvement); initially stored in DB (simpler, behind VPC + RDS encryption at rest)
- **Webhook** endpoint validates `X-Hub-Signature-256` header from Meta
- **Rate limiting**: Meta allows 80 messages/second for business accounts; batch sends with delays if needed
- **Phone validation**: Skip send if phone is empty/invalid; log as FAILED with reason
- **RBAC**: Messaging routes gated by `canRead('messaging')` / `canWrite('messaging')` -- new permission added to RBAC system
