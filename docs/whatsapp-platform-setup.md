# WhatsApp Cloud API — Part 1: Platform Setup (Netrofit, one-time)

The one-time setup **you (Netrofit)** do so tenants can connect their own WhatsApp
numbers. Companion to `whatsapp-cloud-api-plan.md`; the per-academy steps are in
`whatsapp-tenant-onboarding.md`.

---

## 1. Meta Business + Developer App (Tech Provider)
- [ ] Create & **verify** a Meta Business Account — [business.facebook.com](https://business.facebook.com).
- [ ] Create a Meta **App** (type: Business) — [developers.facebook.com](https://developers.facebook.com) → add the **WhatsApp** product.
- [ ] Set up **Embedded Signup**: create a *Facebook Login for Business* configuration with scopes `whatsapp_business_management` + `whatsapp_business_messaging`. Record the **App ID**, **App Secret**, and **Config ID**.
- [ ] Submit for **App Review / Advanced Access** on `whatsapp_business_messaging` so it works for real tenants (not just test numbers). **Allow several days.**
- [ ] Register as a **Tech Provider / Solution Partner** if Meta requires it for your use case.

## 2. AWS infrastructure
- [ ] **Secrets Manager** — per-tenant secret path `/prod/automate-magic/whatsapp/{company_id}` holding `phone_number_id`, `waba_id`, `access_token`, `display_phone_number`. Grant the API Lambda read/write.
- [ ] **Webhook** — public route `POST/GET /api/public/wa/webhook` (`/wa/`, not `/whatsapp/` — that path does not exist); the **verify token** is generated into the platform secret by the CDK stack, no need to invent one; subscribe the app to the `messages` webhook field (inbound messages **and** delivery statuses).
- [ ] **Scheduler** — EventBridge rule (~every 15 min) → Lambda for CRM drips, retries, and idle-lead/retention nudges (needed in Phase 4).

## 3. Billing & cost model
- [ ] Add a **payment method** for WhatsApp conversations (Meta bills per 24h conversation).
- [ ] Decide who pays: **tenant's own Meta billing** vs **Netrofit-fronted marketing credits** with a per-tenant cap + visible balance.

## 4. Build (per the plan's phases)
- [ ] P1 Connect & send core → [ ] P2 Inbox (two-way) → [ ] P3 Auto-send (attendance/absence) → [ ] P4 CRM sending + scheduler + drips.

## 5. Default templates (draft once, reuse)
- [ ] Draft standard templates in **AR + EN** so tenants can submit them fast:
  `CHECKIN`, `ABSENCE`, `ABSENCE_WARNING`, `PAYMENT_DELAY`, `EXAM_RESULTS`,
  `CRM_OUTREACH`, `CRM_FOLLOWUP`, `CRM_REENGAGE`.
