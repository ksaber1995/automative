# WhatsApp Cloud API — Integration Plan (per-teacher number + two-way chat)

> **Status: plan only — nothing here is built yet.**
> This document supersedes the single-WABA model in `messaging-feature-plan.md`
> for the parts that differ. The big change requested: **each teacher/academy
> sends from their OWN WhatsApp number** (not one shared Netrofit number), plus
> **two-way chat history** (see replies), and **auto-send settings** for
> attendance/absence and for the CRM.

---

## 1. Goal

Turn today's manual "click-to-chat" (opening `wa.me` links a human taps) into
real server-side sending through the **Meta WhatsApp Cloud API**, so the platform can:

1. **Send from each tenant's own number** — messages show the academy's/teacher's
   own WhatsApp Business number, not a shared Netrofit number.
2. **Auto-send notifications** on attendance events (present check-in, absence).
3. **Auto-send / drip for the CRM** (lead outreach, follow-ups) — Advanced plan.
4. **Two-way chat history** — when a parent/student/lead **replies**, staff can
   read the conversation inside the platform and reply back.

---

## 2. The key decision: per-tenant sender numbers

The existing notification plan uses **one Netrofit-owned WABA**. This plan
requires **one number per tenant**. That changes onboarding and credentials.

### 2.1 How each tenant gets a number

- **Meta Embedded Signup (recommended).** The academy connects their own
  Meta Business Account + WhatsApp number through an in-app "Connect WhatsApp"
  flow. Netrofit's Meta App acts as the Tech Provider / Solution Partner. Each
  tenant ends up with **their own WABA + phone number**, and Netrofit holds a
  scoped access token per tenant. This is the only way messages truly come
  "from the teacher's own number".

> A tenant that never connects a number falls back to today's manual
> click-to-chat. No number = no automated sending, but the app still works.

### 2.2 Credentials, per tenant

```
Per tenant we store (in AWS Secrets Manager, keyed by company_id — NOT in the DB):
  - phone_number_id
  - waba_id
  - access_token           (scoped to that tenant's WABA)
  - display_phone_number

DB table `whatsapp_accounts` holds only non-secret status + linkage:
  company_id, waba_id, phone_number_id, display_phone_number,
  status (NOT_CONNECTED | CONNECTING | ACTIVE | ERROR),
  quality_rating, verified_name, connected_at, updated_at
```

The webhook needs to route an inbound message to the right tenant: look up by
`phone_number_id` (present on every webhook event) → `company_id`.

---

## 3. What changes vs today

| | Today (click-to-chat) | After Cloud API |
|---|---|---|
| Sender | `wa.me` — staff's personal WhatsApp | **Tenant's own connected number**, server-sent |
| Attendance / absence | manual, or nothing | **auto-send** when enabled (utility template) |
| CRM outreach / drips | manual, one tap per lead | server-sent campaigns + scheduled drips |
| Replies | invisible (in staff's phone) | **stored + shown in an in-app inbox** |
| Delivery status | unknown | sent → delivered → read → failed on the record |

---

## 4. Data model

Reuses `message_templates` / `message_log` ideas from `messaging-feature-plan.md`,
adds per-tenant account + **two-way conversation** tables.

### 4.1 `whatsapp_accounts` — per-tenant connected number (non-secret)
```sql
CREATE TABLE whatsapp_accounts (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  waba_id              VARCHAR(64),
  phone_number_id      VARCHAR(64) UNIQUE,       -- routes inbound webhooks → tenant
  display_phone_number VARCHAR(32),
  verified_name        VARCHAR(200),
  status               VARCHAR(20) NOT NULL DEFAULT 'NOT_CONNECTED',
  quality_rating       VARCHAR(16),
  connected_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
```

### 4.2 `whatsapp_settings` — auto-send toggles (per company)
```sql
CREATE TABLE whatsapp_settings (
  company_id                 UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  -- Attendance notifications (utility)
  auto_send_on_checkin       BOOLEAN NOT NULL DEFAULT false,  -- "present" confirmation
  auto_send_on_absence       BOOLEAN NOT NULL DEFAULT false,  -- absent this session
  absence_warning_threshold  INTEGER NOT NULL DEFAULT 3,      -- N continuous absences
  auto_send_absence_warning  BOOLEAN NOT NULL DEFAULT false,
  -- CRM (Advanced plan, marketing)
  crm_auto_outreach          BOOLEAN NOT NULL DEFAULT false,  -- new lead → template
  crm_auto_drip              BOOLEAN NOT NULL DEFAULT false,  -- run drip sequences
  crm_stop_on_reply          BOOLEAN NOT NULL DEFAULT true,
  updated_at                 TIMESTAMPTZ DEFAULT now()
);
```

### 4.3 `whatsapp_templates` — per-company template bodies mapped to Meta templates
```sql
CREATE TABLE whatsapp_templates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key           VARCHAR(40) NOT NULL,      -- CHECKIN, ABSENCE, ABSENCE_WARNING,
                                           -- PAYMENT_DELAY, EXAM_RESULTS,
                                           -- CRM_OUTREACH, CRM_FOLLOWUP, CRM_REENGAGE
  meta_template_name VARCHAR(120),         -- the approved Meta template name
  category      VARCHAR(16) NOT NULL,      -- UTILITY | MARKETING
  language      VARCHAR(10) NOT NULL DEFAULT 'ar',
  body          TEXT NOT NULL,             -- rendered preview with {placeholders}
  is_active     BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, key)
);
```

### 4.4 Two-way chat — `whatsapp_conversations` + `whatsapp_messages`
```sql
-- One thread per (company, contact phone).
CREATE TABLE whatsapp_conversations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_phone    VARCHAR(32) NOT NULL,        -- E.164, e.g. 20XXXXXXXXXX
  contact_name     VARCHAR(200),
  student_id       UUID REFERENCES students(id) ON DELETE SET NULL,
  lead_id          UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
  last_message_at  TIMESTAMPTZ,
  last_inbound_at  TIMESTAMPTZ,                 -- drives the 24h free-form window
  unread_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, contact_phone)
);

-- Every message, both directions.
CREATE TABLE whatsapp_messages (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  direction        VARCHAR(4) NOT NULL CHECK (direction IN ('OUT','IN')),
  type             VARCHAR(20) NOT NULL DEFAULT 'text', -- text|template|image|...
  template_key     VARCHAR(40),                 -- for OUT template sends
  body             TEXT,
  meta_message_id  VARCHAR(120),                -- WhatsApp wamid
  status           VARCHAR(16),                 -- SENT|DELIVERED|READ|FAILED (OUT)
  error_message    TEXT,
  student_id       UUID REFERENCES students(id) ON DELETE SET NULL,
  lead_id          UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
  sent_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_wa_msg_conversation ON whatsapp_messages(conversation_id);
CREATE INDEX idx_wa_msg_company_created ON whatsapp_messages(company_id, created_at DESC);
```

`whatsapp_messages` also links back to the CRM: an OUT/IN row with a `lead_id`
mirrors onto that lead's `crm_activities` timeline (type WHATSAPP) so the CRM
history and the chat inbox stay in sync.

---

## 5. Auto-send settings (attendance & absence)

Driven by `whatsapp_settings`. Every auto-send checks: number **ACTIVE**, the
toggle **on**, recipient phone valid, **cooldown** (same type + number ≤ once/24h),
and (for students) the opt-in/QR gate.

- **On check-in (`auto_send_on_checkin`)** — hooked in `attendance.ts`
  `saveForSession` / `checkinByQr`: for each student marked **present**, send the
  `CHECKIN` utility template to `parent_phone`.
- **On absence (`auto_send_on_absence`)** — same hook: for each enrolled student
  **not** present when the session is finalized, send the `ABSENCE` template.
- **Absence warning (`auto_send_absence_warning` + threshold)** — after N
  continuous absences, send `ABSENCE_WARNING` once per breach (dedupe via
  `whatsapp_messages` in the last 7 days).

Settings UI: `/messaging` (or `/settings/whatsapp`) → **Auto-send** tab with a
switch per event, disabled until a number is connected.

---

## 6. CRM settings (Advanced plan)

Also in `whatsapp_settings`:

- **`crm_auto_outreach`** — a new lead with a phone + consent gets the
  `CRM_OUTREACH` marketing template automatically.
- **`crm_auto_drip`** — enrolled leads step through a drip sequence
  (Day 0 / 2 / 7) via the scheduler (§9).
- **`crm_stop_on_reply`** — if the lead replies, pause the sequence (a human
  takes over in the inbox).

These extend the Phase-3 CRM automation from "create a task" to "send a template".
Marketing category → opt-in required, higher cost (§8).

---

## 7. Two-way chat history (the inbox)

### 7.1 Inbound (replies)
- The **webhook** (`POST /api/public/whatsapp/webhook`) receives inbound
  messages. Route to tenant by `phone_number_id`.
- Upsert `whatsapp_conversations` (by company + contact phone), insert an
  `IN` `whatsapp_messages` row, bump `unread_count` + `last_inbound_at`.
- Try to match the contact to a `student` (by phone/parent_phone) or a
  `crm_lead`; link the conversation/message and mirror onto the CRM timeline.

### 7.2 The 24-hour window
- `last_inbound_at` sets a **24h free-form window**. Inside it, staff can reply
  with **any text**. Outside it, only an **approved template** can be sent
  (this is why drips/cold outreach are templates).

### 7.3 UI — a WhatsApp inbox
- **`/messaging/chats`** (and a shortcut from a lead/student): a two-pane inbox —
  conversation list (name, last message, unread badge) + thread view with
  OUT/IN bubbles and delivery ticks.
- A composer that's **enabled (free text)** when inside the 24h window, and
  **template-only** when outside it.

### 7.4 Delivery status
- Status callbacks (`sent`/`delivered`/`read`/`failed`) update the matching
  `whatsapp_messages.status` by `meta_message_id` (wamid).

---

## 8. Compliance & cost

- **Opt-in** — students opt in via QR activation (existing gate); leads opt in
  via form / inbound / manual before any marketing message.
- **Categories** — attendance/absence = **Utility**; CRM outreach = **Marketing**.
- **Cost (Egypt, approx per 24h conversation):** Utility ~0.22 EGP, Marketing
  ~2.20 EGP, user-initiated Service free (first 1,000/mo). Give the CRM its own
  **marketing budget/credits** per tenant, separate from the utility volume.
- **Quality rating** — poor sends throttle the number; keep cooldown + opt-in +
  utility-first, and expose the tenant's quality rating in settings.

---

## 9. Scheduler (new infra)

Drips and time-based nudges need a runner the app doesn't have yet:
**EventBridge rule (every ~15 min) → Lambda** that:
- fires due CRM drip steps (`crm_sequence_enrollments.next_run_at <= now`),
- runs idle-lead / retention nudges,
- retries transient send failures.

This single addition also unlocks the CRM's idle-lead and retention automations.

---

## 10. API endpoints (sketch)

```
Onboarding
  POST /api/whatsapp/connect/start        -> Embedded Signup session
  POST /api/whatsapp/connect/complete     -> store waba/phone/token
  GET  /api/whatsapp/account              -> status, number, quality
  POST /api/whatsapp/account/disconnect

Settings & templates
  GET/PUT /api/whatsapp/settings          -> auto-send + CRM toggles
  GET     /api/whatsapp/templates
  PUT     /api/whatsapp/templates/:key

Sending
  POST /api/whatsapp/send                 -> { to, templateKey|text, studentId|leadId }
  POST /api/whatsapp/send-bulk

Chat (two-way)
  GET  /api/whatsapp/conversations        -> inbox list (unread first)
  GET  /api/whatsapp/conversations/:id/messages
  POST /api/whatsapp/conversations/:id/reply   -> text (24h window) or template
  POST /api/whatsapp/conversations/:id/read

Webhook (public, no auth)
  GET  /api/public/whatsapp/webhook       -> Meta verify challenge
  POST /api/public/whatsapp/webhook       -> inbound messages + status callbacks
```

---

## 11. Frontend

```
frontend/src/app/features/messaging/
  services/whatsapp.service.ts
  connect/        -> "Connect your WhatsApp number" (Embedded Signup)
  settings/       -> Auto-send tab (attendance/absence) + CRM tab
  templates/      -> edit template bodies (within approved structure)
  chats/          -> two-pane inbox (conversation list + thread + composer)
```
Sidebar: a **Messaging** group (or under Client Management for the CRM chat)
with **Connect / Settings / Inbox**. Contextual "Chat" buttons on student and
lead records deep-link into the relevant conversation.

---

## 12. Phased rollout

1. **Connect & send core** — `whatsapp_accounts` + Secrets Manager per tenant,
   Embedded Signup, Graph client, single send endpoint, `message`/`conversation`
   tables, delivery + inbound webhook. Manual sends work end-to-end from the
   tenant's own number.
2. **Inbox (two-way)** — conversation list + thread + composer (24h window aware),
   unread badges, student/lead matching, CRM-timeline mirroring.
3. **Auto-send (attendance/absence)** — settings tab + hooks in `attendance.ts`,
   utility templates, cooldown.
4. **CRM sending + scheduler + drips** — marketing templates, opt-in, campaigns,
   EventBridge scheduler, drip sequences, marketing budget meter.

---

## 13. Prerequisites & decisions

- **Meta setup (external, slow):** a Meta App configured as Tech Provider for
  Embedded Signup; per-tenant WABA verification & template approval (1–24h each).
  See `docs/meta-whatsapp-setup-guide.md` for the base steps.
- **Own number vs numbers-under-Netrofit-WABA** — recommend **Embedded Signup**
  (true own number) since that's the explicit requirement.
- **Who pays marketing cost** — recommend per-tenant marketing credits with a
  hard cap + visible balance.
- **Opt-in capture for leads** — form / inbound / manual; only message opted-in.
- **Inbox staffing** — who watches replies; unread routing per branch/owner.

---

*Draft plan. Complements `docs/messaging-feature-plan.md` (single-WABA utility
notifications) and `docs/meta-whatsapp-setup-guide.md` (Meta account setup).*
