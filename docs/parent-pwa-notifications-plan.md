# Parent PWA + Push Notifications — plan

> **Status: not started.** This is an alternative/complement to the WhatsApp
> plans (`whatsapp-meta-setup.md`, `whatsapp-360dialog-migration.md`) — not a
> replacement. Click-to-chat stays as the zero-setup manual fallback; this
> adds a free, ban-proof automated channel for parents who install it.

---

## 1. Why this instead of (or alongside) WhatsApp

No Meta review, no BSP cost, no bans, no templates, no 250/day cap. The
trade-off is adoption: WhatsApp is already on every parent's phone; this
requires them to install something. See §7 for how we hedge that risk instead
of betting the whole notification system on it.

## 2. What already exists to build on

The public student page (`aws/lambda/api/src/routes/public-students.ts`,
frontend `features/public/public-student/`, route `/p/s/:qrToken`) is the
foundation:
- **Auth model already solved.** No login — the QR token *is* the credential,
  scoped to exactly one student, already rate-limited by IP
  (`RATE_LIMITS.PUBLIC_PROFILE_IP`). The PWA reuses this exact page/token —
  no new parent account system needed for v1.
- **Content already there.** Attendance (present/absent/substituted, by
  class), exam/homework grades (`exams` array, rating-aware via
  `isRatingCompany`), and full payment state. Push notifications just need to
  announce "something changed here," not duplicate the data.
- **Nothing PWA-related exists yet** — no `manifest.json`, no service worker,
  confirmed absent from `frontend/src/`. This is greenfield on top of an
  existing page, not a new app.

## 3. Architecture

### 3.1 Make the existing public page installable
- Add `manifest.json` (name, icons, `start_url: /p/s/:qrToken`,
  `display: standalone`) linked from `public-student.component`'s page, and a
  service worker registered only on that route (no need to make the whole
  authenticated app a PWA for this).
- Show an **"Install for notifications"** prompt on the page itself — this is
  the page parents already reach via the QR code / shared link, so no new
  distribution channel needed.
- **iOS caveat to design around:** push only works after the page is added to
  the Home Screen (Share → Add to Home Screen) on iOS 16.4+, and only from
  inside that installed shortcut, not Safari itself. Show an iOS-specific
  instructional banner ("On iPhone: tap Share, then Add to Home Screen, then
  open it from there to enable notifications") rather than a plain "Enable"
  button that silently fails in the Safari tab.

### 3.2 Subscribe flow
1. Parent taps "Enable notifications" (from the installed PWA).
2. Browser Push API + a **VAPID key pair** (generate once, store the private
   key in Secrets Manager next to the WhatsApp platform secret) produces a
   push subscription object (`endpoint`, `keys.p256dh`, `keys.auth`).
3. POST it to a new endpoint, keyed by the **same qrToken already in the URL**
   — same security model as the page itself, no new auth to design.

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  last_sent_at  TIMESTAMPTZ,
  UNIQUE (endpoint)
);
```

A student can have more than one subscription row (both parents install it,
or a parent's phone + tablet) — send to all of a student's rows, don't
collapse to one.

### 3.3 Sending
- Backend uses the `web-push` npm package (or equivalent) with the VAPID keys
  to POST to each subscription's `endpoint` — no per-message cost, no
  external API to authenticate against per tenant.
- Unlike the WhatsApp plan, this **probably doesn't need SQS.** A push send is
  a single fast HTTPS call per subscription, not a multi-second Graph API
  round trip — inline sending from the existing attendance/session/exam
  handlers is likely fine even for a large class. Revisit only if real class
  sizes make this measurably slow.
- Reuse the same trigger points already scoped in the WhatsApp plan
  (`whatsapp-cloud-api-plan.md` §5), pointed at a `sendPush` util instead of
  (or alongside) `sendWhatsApp`:
  - **Present** — `attendance.ts` `checkinByQr` / `saveForSession`.
  - **Absent** — `sessions.ts` `end` (enrolled minus present).
  - **Exam results published** — wherever `exams.ts` marks a result as
    released to the feed `studentExamFeedSql` reads from.
- Notification content: title + body per event type, same copy the WhatsApp
  templates already drafted (`whatsapp-meta-setup.md` §7: CHECKIN, ABSENCE,
  EXAM_RESULTS) — one shared copy source, two delivery channels.

## 4. Data model additions

```sql
-- Per-student channel preference. Reuses the shape from the WhatsApp plan
-- rather than inventing a second opt-in model.
ALTER TABLE students ADD COLUMN IF NOT EXISTS notify_attendance BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS notify_absence    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS notify_exam       BOOLEAN NOT NULL DEFAULT false;
-- push_subscriptions table from §3.2
```

No `notify_recipient` (parent vs student) distinction needed here the way the
WhatsApp plan has it — the subscription is tied to whichever device installed
it, not to a phone number choice.

## 5. Security notes

- The qrToken is already the sole credential on this page today (see the
  privacy note at the top of `public-students.ts`) — subscribing to push
  doesn't lower that bar, it's the same token, same rate limit.
- VAPID private key in Secrets Manager, never in the frontend bundle (only the
  public key ships to the browser).
- A stored subscription is inert without the backend choosing to send to it —
  no new way to read data, only a new way to be notified that data changed.

## 6. What doesn't need building

- No app store submission, no review wait, no binary signing/distribution.
- No parent login/account system for v1 — the existing qrToken model covers
  single-child parents completely. Multi-child aggregation (one parent, many
  kids, one notification feed) is a real gap this doesn't solve — see §8.

## 7. Adoption hedge

Don't remove or hide click-to-chat. Ship this as an *additional* channel:
- Parents who install the PWA and enable push: automated, free, no tap needed.
- Parents who don't: unchanged — the manual "Send via WhatsApp" button still
  works exactly as today.
- No student/parent is worse off than before this ships; the win is purely
  additive for whoever opts in.

## 8. Known gaps / future work

- **Multi-child parents** get one installable page per child (one per
  qrToken) rather than a single combined feed. Fine for v1; a real parent
  account (phone-number login aggregating all their children) is the fix,
  deferred until it's clear this channel gets enough adoption to justify it.
- **Exam lockdown/proctoring**, if ever needed, is out of scope for a PWA —
  see the native-wrapper note below.
- If native-only capabilities are ever needed (exam lockdown, deeper OS
  integration), the upgrade path is wrapping this same Angular app with
  **Capacitor** rather than rewriting — noted here so the PWA choice doesn't
  read as a dead end later.

## 9. Build order

1. VAPID keypair + Secrets Manager entry.
2. `manifest.json` + service worker + install prompt on `/p/s/:qrToken`
   (iOS-aware messaging per §3.1).
3. `push_subscriptions` table + subscribe endpoint.
4. `sendPush` util (`web-push` package) + wire into attendance/absence hooks.
5. Wire into exam-result publish.
6. Per-student notify toggles UI (reuse the pattern from the WhatsApp plan's
   student form additions — same three checkboxes, new backend target).

---

*Related: `whatsapp-cloud-api-plan.md` (shared trigger points + template
copy), `public-students.ts` (the page and data this builds on).*
