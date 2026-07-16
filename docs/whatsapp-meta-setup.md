# WhatsApp — the Meta steps (Karim's checklist)

Everything on this list is work only you can do: it needs a Meta login, a company
document, or a decision. The code side is built and deployed — connecting a
number and sending are waiting on **§3** below and nothing else.

Work top to bottom. §1 gates almost everything, so start it today; most of the
elapsed time here is Meta reviewing things, not you typing.

> Companion docs: `whatsapp-platform-setup.md` (the original vendor checklist),
> `whatsapp-tenant-onboarding.md` (per-academy steps),
> `whatsapp-cloud-api-plan.md` (the architecture and phase plan).

---

## 1. Meta Business Account + Business Verification

- [ ] Create a Meta Business Account — [business.facebook.com](https://business.facebook.com).
- [ ] Start **Business Verification** (Security Center). You will need the
      commercial registration / tax card in the business's legal name, and the
      business name on the documents must match the account name.
- [ ] **Wait: ~2–7 business days.**

**Why it gates everything:** unverified, a number is capped at **250
business-initiated conversations/day** and display names stay unapproved. Fine
for a trial, useless for 3,000 students.

## 2. Meta App (Tech Provider)

- [ ] [developers.facebook.com](https://developers.facebook.com) → create an app,
      type **Business** → add the **WhatsApp** product.
- [ ] Create a **Facebook Login for Business** configuration with **exactly**
      these scopes — the code asks for both, and a missing one fails at connect
      time, not at setup time:
      - `whatsapp_business_management`
      - `whatsapp_business_messaging`
- [ ] Set the login configuration's redirect/allowed domain to `app.netrofit.com`.
- [ ] **Write down three values** — App ID, App Secret, Config ID. These go into §3.

## 3. Hand me the credentials ← *this unblocks the code*

Put the three values into the AWS secret. Nothing else in the app reads them, and
a redeploy will not overwrite them.

```bash
aws secretsmanager put-secret-value \
  --secret-id /prod/automate-magic/whatsapp/platform \
  --profile personal --region eu-west-1 \
  --secret-string '{
    "meta_app_id": "PASTE_APP_ID",
    "meta_app_secret": "PASTE_APP_SECRET",
    "meta_config_id": "PASTE_CONFIG_ID",
    "webhook_verify_token": "KEEP_THE_EXISTING_VALUE"
  }'
```

**Read the existing secret first** and copy `webhook_verify_token` across
verbatim — `put-secret-value` replaces the whole JSON, and overwriting that token
breaks the webhook subscription from §4:

```bash
aws secretsmanager get-secret-value \
  --secret-id /prod/automate-magic/whatsapp/platform \
  --profile personal --region eu-west-1 --query SecretString --output text
```

Or just send me the three values and I'll do it. No deploy is needed afterwards —
the API reads the secret at runtime (within ~5 minutes, or immediately on a cold
start).

## 4. Webhook

In the Meta app → WhatsApp → Configuration → Webhooks:

- [ ] **Callback URL:** `https://app.netrofit.com/api/public/wa/webhook`
      ⚠️ Note `/wa/`, **not** `/whatsapp/`. The older docs say `/whatsapp/`; that
      path 404s.
- [ ] **Verify token:** the `webhook_verify_token` value from the secret in §3.
- [ ] Subscribe to the **`messages`** field — this covers both inbound replies
      *and* delivery receipts (sent/delivered/read/failed).

This is already tested and working: Meta's verification GET returns the challenge
correctly. If it fails, the token in the dialog doesn't match the secret.

## 5. App Review — Advanced Access

- [ ] Submit for **Advanced Access** on `whatsapp_business_messaging`.
- [ ] **Wait: several days.**

Without it, Embedded Signup only works with Meta test numbers. Real tenants
cannot connect. This is the second long pole after §1 — submit as soon as §2 is
done, don't wait for anything else.

## 6. Billing — needs a decision from you

- [ ] Add a payment method for WhatsApp conversations.
- [ ] **Decide who pays.** This one changes what I build next, so tell me before
      the CRM sending phase:
      - **Tenant-billed** — each academy adds their own Meta payment method.
        Nothing to build; they may balk at the setup.
      - **Netrofit-fronted** — you pay Meta, bill it on. Needs per-tenant credits,
        a hard cap, and a visible balance, or a runaway drip campaign lands on
        your card.

Rough Egyptian rates per 24h conversation: **Utility ~0.22 EGP** (attendance,
absence), **Marketing ~2.20 EGP** (CRM outreach), **Service free** for the first
1,000/month. The gap between utility and marketing is ~10×, which is why the CRM
needs its own budget rather than sharing the attendance volume.

## 7. Templates

- [ ] Draft these in **Arabic and English**, then submit each in the Meta
      dashboard. Approval is **1–24h each**, so submit them in one sitting:

| Key | Category | Used for |
|---|---|---|
| `CHECKIN` | Utility | student marked present |
| `ABSENCE` | Utility | student missed a session |
| `ABSENCE_WARNING` | Utility | N absences in a row |
| `PAYMENT_DELAY` | Utility | overdue payment |
| `EXAM_RESULTS` | Utility | results published |
| `CRM_OUTREACH` | Marketing | new lead |
| `CRM_FOLLOWUP` | Marketing | follow-up |
| `CRM_REENGAGE` | Marketing | idle lead |

- [ ] Once approved, put each **approved template name** into
      Settings → WhatsApp → Templates in the app. The body stored there is only a
      preview for staff — **Meta sends by the approved name**, so a template with
      no name set will refuse to send.
- [ ] Get the category right at submission. Meta can recategorise a "utility"
      template it judges promotional, and it then bills at the marketing rate.

## 8. Per number (netrofit + Karim tenants)

For each of the two trial tenants:

- [ ] A phone number **not currently registered on the WhatsApp or WhatsApp
      Business app**. If it is, delete that WhatsApp account first and wait. A
      dedicated business SIM is easiest.
- [ ] The number must receive an **SMS or voice OTP**.
- [ ] In the app: **WhatsApp → Connect → Connect WhatsApp**. Meta's dialog opens;
      sign in, pick/create the Business + WABA, add the number, verify the OTP,
      grant access. The app stores the token and marks the number active.
- [ ] Set the **display name** (what recipients see) → Meta reviews it, **1–3 days**.
- [ ] Test: send a message from the inbox, reply from the recipient's phone, and
      check the reply appears in the app.

**Order matters:** §5 must be approved before this works with a real number.

## 9. Opt-in

- [ ] **Students** — covered by the existing QR activation gate.
- [ ] **Leads** — capture consent before any marketing message: a form checkbox,
      their first inbound reply, or a staff member confirming manually. Meta
      polices this through user blocks and quality rating; enough of them and the
      number gets throttled or barred.

---

## What's built vs what isn't

Built and deployed:

- Connect (Embedded Signup, both ends), token storage per tenant in Secrets
  Manager, send (text + template), the 24h free-form window rule, the inbox,
  inbound messages, delivery receipts, webhook verification.

Not built yet — tell me when you want these:

- **Webhook signature verification.** The webhook currently accepts unsigned
  POSTs. Nobody can exploit it usefully today (no connected numbers), but it must
  land before real traffic — anyone who guesses a `phone_number_id` could inject
  fake inbound messages.
- **Auto-send on attendance/absence.** The toggles in Settings persist, but no
  code reads them yet — they are decorative until this is built.
- **CRM drips.** Needs an EventBridge scheduler; none exists in the stack.

## Timing

§1 (2–7 days) and §5 (several days) are the long poles and can overlap. Realistic
total before a first real message: **2–4 weeks**, almost all of it waiting on
Meta. Start §1 and §2 today; the rest is quick once they clear.
