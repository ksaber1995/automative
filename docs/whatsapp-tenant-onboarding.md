# WhatsApp Cloud API — Part 2: Per-Tenant Onboarding (each academy)

The steps **each academy** follows to send WhatsApp from **their own number**.
Run this checklist for every tenant. Companion to `whatsapp-cloud-api-plan.md`;
the one-time platform setup is in `whatsapp-platform-setup.md`.

---

## 1. Prepare a phone number
- [ ] A number **NOT** currently registered on the WhatsApp / WhatsApp Business **app** (if it is, delete that WhatsApp account first). A dedicated business SIM is recommended.
- [ ] The number can receive an **SMS or call** for the OTP.

## 2. Connect WhatsApp (in-app Embedded Signup)
- [ ] Academy admin clicks **"Connect WhatsApp"** → signs into Meta → selects/creates a **Business + WABA** → adds the phone number → **verifies via OTP** → grants Netrofit's app access.
- [ ] The platform stores `waba_id` / `phone_number_id` / token; account status → **ACTIVE**.

## 3. Business verification (Meta)
- [ ] Complete **Business Verification** (Security Center). Required to send beyond **250 business-initiated conversations/day**. Provide business documents (commercial registration, etc.). **~2–7 business days.**

## 4. Display name approval
- [ ] Set the **display name** (what recipients see). Meta reviews it (**1–3 days**); must follow Meta's display-name guidelines.

## 5. Message templates
- [ ] Create + **submit** the templates the academy will use — **Utility** for attendance/absence, **Marketing** for CRM. Wait for approval (**1–24h** each).

## 6. Opt-in / consent
- [ ] **Students:** covered by QR activation (existing paid gate).
- [ ] **Leads:** capture consent — web-form checkbox, first inbound reply, or manual staff confirmation. **Only opted-in contacts get messages.**

## 7. Configure settings (in-app)
- [ ] Toggle **auto-send** on check-in / absence / absence-warning (+ set threshold).
- [ ] (Advanced plan) enable **CRM auto-outreach / drip**.

## 8. Go live
- [ ] App in **Live** mode, **business verified**, **≥1 approved template**, **display name approved**.
- [ ] Test: send to your own number → confirm **delivered**, then reply → confirm it appears in the **inbox**.

---

## Prerequisites (what each academy must have)
- A **Meta Business account** (or willingness to create one).
- A **dedicated phone number** not on the WhatsApp app.
- **Business documents** for verification.
- The **Advanced plan** — only for CRM sending (attendance/absence works on any plan once connected).

## Timeline (per tenant, after connecting)
| Step | Typical time |
|------|--------------|
| Business verification | 2–7 business days |
| Display name approval | 1–3 days |
| Template approval | 1–24 hours |

A tenant can usually start sending within **a few days** of connecting their number.
