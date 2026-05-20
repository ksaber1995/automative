# Feature Requests & Design Decisions

## ✅ Completed

### Product Inventory & COGS Tracking
**Request:** Buying stock (e.g., 15 units × 15 EGP cost) should be reflected in the dashboard.
**Solution:** Implemented matching principle accounting:
- Inventory purchase = asset (not expense). Stock tracked on `products` table with `cost_price`.
- COGS expense auto-created on sale date: `cost_price × quantity`, category `COGS`, linked to `product_sale_id`.
- DB: Added `product_sale_id`, `product_id` columns to `expenses`; COGS added to category constraint.
- Analytics: `grossProfit = totalRevenue - cogsExpenses`, `inventoryValue = SUM(stock × cost_price)`.
- Dashboard now returns: `grossProfit`, `cogsExpenses`, `capitalExpenses`, `inventoryValue`.

---

### Capital Expenditure (CapEx) for Expenses
**Request:** Assets like laptops, air conditioners, decorations should not be counted as a single month's expense.
**Solution:** Added `CAPITAL` expense type with amortization:
- `assetName` — name of the asset (e.g. "MacBook Pro")
- `amortizationMonths` — number of months to spread the cost over
- `monthlyAmount` — computed as `amount ÷ amortizationMonths`, returned by API
- Analytics should use `monthlyAmount` instead of `amount` for CAPITAL expenses
- Form shows a highlighted capital section when type = CAPITAL, with live monthly cost preview
- DB columns added: `asset_name`, `amortization_months`

---

### Student Acquisition Channel (Source)
**Request:** Add a dropdown on the Add New Student form for "channel" — how the student heard about us.
**Solution:** Added `acquisition_channel` column on `students` (VARCHAR(50), nullable).
- Options: FACEBOOK, INSTAGRAM, TWITTER, TIKTOK, REFERRAL, WALK_IN, OTHER.
- API contract: `acquisitionChannel` on create/update/return payloads, validated via Zod enum.
- Migration: `POST /api/migrations/add-acquisition-channel-to-students` (idempotent — `ADD COLUMN IF NOT EXISTS`).
- Frontend: dropdown on Add/Edit Student form (Student Information section, optional). Detail page shows "Heard via:" when set. EN + AR labels.

---

### Backdated Employee Salary Calculation
**Request:** When registering an employee whose actual hire date is in the past (e.g. hired 20/1/2026 but registered 15/3/2026), automatically calculate and add back-salary expenses.
**Solution:** "Calculate Back Pay" button on the employee detail page (shown only when employee has both `hireDate` and `salary`).
- Generates monthly periods from hire month through the month *before* the registration/current month — the registration month itself is excluded since it's paid normally at month-end.
- First month is pro-rated if hire day > 1 (`salary × daysWorked ÷ daysInMonth`).
- Idempotent: months that already have a SALARIES `expense_payments` row are flagged `alreadyPaid` and skipped on commit.
- Preview (`GET /api/expenses/employee/:id/back-pay-preview?upTo=YYYY-MM-DD`) lists every period (month, dates, days, amount, status) before commit.
- Commit (`POST /api/expenses/employee/:id/back-pay`) writes `expense_payments` rows: `type=FIXED`, `category=SALARIES`, `employee_id=set`, `expense_id=null`, `date=end-of-month`, with pro-rated note when applicable.

---

## 🗺️ Roadmap — Next Plausible Features

Forward-looking plan, ordered by **leverage × effort**. Scope assumed: this
multi-tenant SaaS for learning centers / academies in MENA, admin-facing
today (no parent/student portal yet), Angular + Aurora + Lambda.

### Tier 1 — Revenue-blocking / weekly customer asks

These pay for themselves; everything else is downstream of having them.

#### 1. Online payment collection (Paymob + Stripe)
**Why:** Subscriptions, enrollments, event bookings, and installment plans all
exist as records but money still moves out-of-band. We can't actually take a
card today, which caps SaaS revenue and forces manual cash entry per payment.
**Scope:**
- New `payment_intents` + `payment_transactions` tables, FK'd to whichever
  domain object created them (subscription / master_enrollment / installment
  schedule row / event subscription).
- Paymob first (MENA-native, supports Fawry + Meeza + cards in EGP/SAR/AED) —
  Stripe second for non-MENA tenants.
- Webhook handler under `routes/payments.ts` that flips status and writes a
  matching `expense_payments` (negative) or `revenues` row so reports stay
  consistent.
- Frontend: a `<pay-now>` widget reusable across enrollment / installment /
  subscription pages; Stripe Elements / Paymob iframe.
- Refund path piggybacks on existing refund tables.

**Estimate:** 2 weeks (Paymob first), +3 days for Stripe.

---

#### 2. WhatsApp + SMS reminders (Wati / Twilio / Vonage)
**Why:** Academies live and die on attendance and on-time fee collection.
Emails get ignored in MENA; WhatsApp is the channel customers actually read.
**Scope:**
- `notification_templates` table (slug, channel, locale, body).
- `notification_jobs` queue table; Lambda cron sweeps every 5 min.
- Triggers (no UI needed v1, just config):
  - Class starts in 1 h → WhatsApp to enrolled students.
  - Installment due in 3 days → WhatsApp to payer.
  - Subscription expires in 7 days → WhatsApp + email to GLOBAL_ADMIN.
  - Absence streak ≥ 3 sessions → WhatsApp to parent/guardian.
- Settings page: opt-in per template + sender number.
- Provider abstraction so we can swap Wati ↔ Twilio ↔ Vonage.

**Estimate:** 1 week for the queue + email path, +3 days per provider.

---

#### 3. PDF invoices & receipts
**Why:** Every paid enrollment / installment / event today produces no
shareable artifact. Customers ask for an invoice for school records and
employer reimbursement; tax authorities will eventually mandate it.
**Scope:**
- Server-side via `pdfkit` or `puppeteer-core` (latter handles RTL Arabic
  fonts cleanly — important).
- Template per type: enrollment receipt, installment receipt, subscription
  invoice, refund credit note.
- Store rendered PDFs in S3 under `s3://<bucket>/<companyId>/receipts/`;
  signed URL returned by `GET /api/<resource>/:id/receipt`.
- Branding: company name + logo (need a one-time logo upload — see #6).
- Auto-attach to the corresponding WhatsApp/email reminder (depends on #2).

**Estimate:** 1 week (Puppeteer Lambda layer is the longest part).

---

### Tier 2 — Big operational unlocks (build right after Tier 1)

#### 4. Parent / student portal (read-only first)
**Why:** Today the admin is the bottleneck for "did my kid attend?", "how
much do I still owe?", "when's the next class?". A read-only portal kills
80% of those calls without exposing write surface.
**Scope:**
- New auth role `STUDENT` / `PARENT` linked via `students.guardian_user_id`.
- Login via phone + OTP (WhatsApp, free with #2) rather than email/password.
- 4 read-only pages: schedule, attendance history, payment history,
  outstanding balance with **Pay now** button (depends on #1).
- New route prefix `/portal/` in the Angular app; separate router config so
  the admin shell doesn't leak in.
- Backend: scoped read endpoints that filter by `student_id` from JWT, never
  by `company_id` from the URL.

**Estimate:** 2 weeks v1 (read-only), +1 week to add Pay-now and
guardian-managed multi-child accounts.

---

#### 5. Bulk import (Excel / CSV)
**Why:** Onboarding a new academy currently means typing 200 students by
hand. Sales blocker.
**Scope:**
- Generic CSV ingester behind `POST /api/import/<entity>` for `students`,
  `employees`, `branches`, `products`, `master_courses`.
- Two-pass: validate-and-preview (returns row-by-row errors with line
  numbers + a download-fixed-template link), then commit.
- Frontend: drag-drop dialog with sticky-header preview table; per-column
  field mapping for non-template files.
- Idempotency via an optional `external_id` column.

**Estimate:** 1 week.

---

#### 6. File/document storage per entity
**Why:** Required by #3 (logo), enables student contracts, employee IDs,
certificates, attendance photos.
**Scope:**
- `attachments` table: `id, company_id, owner_type, owner_id, key, mime,
  size, uploaded_by`.
- S3 bucket with `companyId/` prefix + signed PUT URLs from the Lambda (no
  multipart, ≤25 MB).
- Frontend: PrimeNG `p-fileupload` driven by `<app-attachments>` component
  reusable per entity (drop into student detail, employee detail, expense
  for receipt photos, etc.).

**Estimate:** 4 days.

---

### Tier 3 — Academic depth (do once Tier 1+2 stabilise)

#### 7. Grading & report cards
**Why:** Today we track attendance but not learning. Academies that aren't
pure tutoring (K-12, language schools, music) need it.
**Scope:**
- `grading_scales` (per company), `assessments` (per class/session),
  `grades` (per student × assessment).
- Report-card PDF generator reusing #3.
- Optional: weighted final grade per master-course.

**Estimate:** 1.5 weeks.

#### 8. Certificate generation
**Why:** Completion of a master-course should produce a printable
certificate with student name + course + date + signature. Trivially
upsellable as a paid add-on.
**Scope:** Template editor (or 2–3 stock templates) + PDF render via #3
infrastructure. Auto-trigger when `master_enrollment.status → COMPLETED`.
**Estimate:** 4 days after #3.

#### 9. Calendar sync (Google / Outlook / iCal)
**Why:** Teachers and students want classes in their personal calendars.
**Scope:**
- Public iCal feed per user: `GET /api/calendar/:userToken/feed.ics`.
- Optional full OAuth-based two-way sync later — start with the read-only
  feed since it covers 90% of demand at 10% of effort.

**Estimate:** 3 days for iCal feed.

---

### Tier 4 — Platform & quality (background work)

#### 10. Audit log
**Why:** Compliance + "who deleted that enrollment?" debugging.
**Scope:** `audit_log` table (actor_user_id, action, target_type, target_id,
diff_json, ip, at). Wrap every `INSERT/UPDATE/DELETE` in the connection
helper so it's automatic, not per-route. Admin UI: filterable log table on
`/audit`.
**Estimate:** 4 days; biggest risk is making the wrapper opt-out for
high-volume tables (attendance writes).

#### 11. CRM / lead pipeline
**Why:** `demo-leads` exists but is just a capture form. The sales workflow
(contacted → demo booked → trial → enrolled) is run in WhatsApp today.
**Scope:** `leads` table extension (stage enum, owner_user_id,
next_followup_at, notes timeline). Kanban view on `/leads`. WhatsApp
template integration via #2 for follow-up nudges.
**Estimate:** 1 week.

#### 12. Webhooks for tenants
**Why:** Larger customers will want to push enrollment / payment events into
their own Zapier / n8n / data warehouse.
**Scope:** `webhook_subscriptions` table, signed HMAC delivery, retry with
exponential backoff via SQS DLQ. Settings UI to manage endpoints + view
delivery log.
**Estimate:** 1 week.

#### 13. Mobile app (Capacitor wrapper of the portal)
**Why:** Push notifications + home-screen icon for the parent portal (#4),
without writing a separate app.
**Scope:** Wrap the `/portal/` routes only with Capacitor; native push via
Firebase. Skip Tier-3 admin features — mobile admins can use the web.
**Estimate:** 1 week once #4 is stable.

---

### Explicitly *not* on the roadmap (and why)

- **Custom report builder / BI dashboards** — existing reports cover the
  questions customers actually ask; adding a query builder is a big surface
  with niche demand. Revisit if 3+ customers request it.
- **HR/payroll module** — `employees` + `expense_payments` already handle
  salary tracking and back-pay. Going further (tax filings, end-of-service
  benefits per country) is its own product.
- **Library / asset checkout** — only relevant for libraries; not worth the
  abstraction for general academies.
- **Public-facing course catalog / shopping cart** — would compete with the
  customers' own marketing sites. Better to expose an embeddable widget once
  #1 ships.

---

### Suggested sequencing

```
Week  1–2 : #1 Payments (Paymob)
Week  3   : #2 WhatsApp reminders (queue + Wati)
Week  4   : #3 PDF receipts
Week  5–6 : #4 Parent portal (read-only)
Week  7   : #5 Bulk import
Week  7   : #6 Attachments (parallel, small)
Week  8+  : Tier 3 + Tier 4 as customer demand pulls them in
```

Two months from now we'd have payments + automation + parent visibility live
— which is the bundle that turns "good internal tool" into "product anyone
can sell to a school".

---

## 🕐 Pending (ad-hoc requests)

_None right now — add new one-off requests below the roadmap._
