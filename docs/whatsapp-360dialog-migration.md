# Switching to 360dialog — Karim's checklist

> **Decision (2026-08-14):** moving from "we're our own Meta Tech Provider" to
> a BSP (360dialog). Supersedes §2 + §5 of `whatsapp-meta-setup.md` — §1
> (Business Verification) and §7 (templates) there are still correct, a BSP
> doesn't remove Meta's own rules, only our Tech Provider burden.

Everything below in **§A is yours to do** — it needs a 360dialog login or a
decision only you can make. **§B is mine** — code changes that follow once
you've answered the open questions in §A by actually being in the Hub.

Work §A top to bottom; nothing in §B can start for real until §A.1–§A.3 are done,
since the exact API shape/onboarding UX 360dialog gives you isn't fully knowable
from outside their dashboard.

---

## §A — Your steps

### 1. Sign up as a 360dialog **Partner** (not a single business)
- [ ] Go to [hub.360dialog.com](https://hub.360dialog.com) and sign up on the
      **Partner / ISV** track specifically — the one for platforms serving many
      end-clients (each teacher/academy), not the single-business track.
- [ ] If the signup flow doesn't clearly offer a Partner track, this is a
      "talk to sales" conversation with 360dialog before anything else — flag it
      back to me if that's what you hit.

### 2. Get Partner API credentials + confirm billing
- [ ] From the Hub, generate **Partner API credentials** (used to provision a
      WhatsApp channel per tenant, or to generate a per-tenant onboarding link).
- [ ] Add a **payment method** with 360dialog. Note: this is **on top of**
      Meta's own conversation pricing, not instead of it — 360dialog charges
      their own per-channel fee.

### 3. Confirm the onboarding shape (answers I can't get without you being logged in)
Once inside the Hub, check and report back:
- [ ] Do they offer a **hosted onboarding link** (you send the teacher a
      360dialog-branded page, no frontend work for us) or only an **API-driven**
      flow (we build our own UI calling their Partner API)? Start with hosted
      if both exist — it's the fastest way to validate before we invest in a
      fully embedded flow.
- [ ] When/how does 360dialog surface **Meta Business Verification** to the
      teacher during onboarding? (Still required for scale — just want to know
      whose UI asks for it.)
- [ ] Do they call the "keep using the WhatsApp Business app on your phone
      while also connected" feature "Coexistence," or something else? (Same
      feature as §7.5 in `whatsapp-meta-setup.md`, just confirming their term
      for it so we don't miss it in their docs.)

### 4. Templates — resubmit through the Hub
- [ ] Same list as before, draft in **AR + EN**, submit via the 360dialog Hub
      instead of Meta Business Manager directly:

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

- [ ] Get the category right at submission — Meta can recategorise a "utility"
      template it judges promotional, and it then bills at the marketing rate,
      same as before, regardless of provider.

### 5. Per teacher, once §A.1–§A.4 are done
- [ ] Business Verification still applies **per teacher's business**, same as
      the direct-Meta path — 360dialog doesn't waive this, only its own
      Tech Provider role is gone from our side. Expect the same ~2–7 business
      day wait, just triggered from inside 360dialog's flow instead of ours.
- [ ] Same phone-number rule as before: not currently registered on the
      consumer WhatsApp/Business app (unless you're using whatever 360dialog
      calls Coexistence — confirm in §A.3).

### 6. Hand me what I need once you're through §A.1–§A.3
- [ ] Partner API credentials (or tell me which onboarding mode you picked).
- [ ] Answers to the three questions in §A.3.

That's what unblocks §B — I can start the provider-abstraction groundwork
before this (see §B.1), but the connect-flow rewrite needs your answers first.

---

## §B — What I'll do in code (for tracking, not your action items)

1. **Provider abstraction** — wrap send/receive behind an interface so
   attendance hooks, the inbox, and CRM mirroring don't care which BSP is
   behind it. Can start immediately, no 360dialog account needed.
2. **Swap `utils/meta-graph.ts`** for 360dialog's Cloud API (their request/
   response shapes closely mirror Meta's own — smallest-risk part of the
   rewrite) using their channel API key instead of a per-tenant OAuth token.
3. **Secrets shape change** — `{ access_token, waba_id, phone_number_id }` per
   tenant becomes whatever 360dialog issues per channel (likely an API key +
   channel id); migrate `whatsapp_accounts`' non-secret columns to match.
4. **Rebuild the connect flow** — `wa-connect.component.ts`'s `FB.login`
   Embedded Signup popup gets replaced with whichever onboarding mode you
   confirm in §A.3.
5. **Webhook handler** (`routes/wa-cloud.ts`) — URL + verify-token swap, plus a
   real diff against 360dialog's actual payload shape (don't assume identical
   to Meta's).
6. **Signature verification** — built in from the start this time (it was
   flagged as missing on the Meta-direct version).

### What doesn't change either way
Data model (`whatsapp_conversations`, `whatsapp_messages`, `whatsapp_templates`,
`whatsapp_settings`), the 24h free-form reply window, opt-in rules, and the
Utility/Marketing cost split — all Meta policy, unaffected by which BSP fronts it.

---

*Related: `whatsapp-meta-setup.md` (superseded for §2/§5, §1/§7 still correct),
`whatsapp-cloud-api-plan.md` (data model + phased rollout, provider-agnostic).*
