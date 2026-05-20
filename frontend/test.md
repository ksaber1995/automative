 <!-- make payment inside the course itself not on the class -->


<!-- - remove and add first student -->
<!-- - end session -->
<!-- - terminate employee --> done

<!-- domain thing  -->
  One thing to set up before going live: WhatsApp Cloud API credentials. Add WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
  and (optional) WHATSAPP_OTP_TEMPLATE / WHATSAPP_OTP_TEMPLATE_LANG to the Lambda's environment in aws/lib/core-stack.ts
   and redeploy. Until those are set, OTPs are logged to CloudWatch (you'll see [WhatsApp OTP] Credentials not
  configured — would send OTP …) so registration still works end-to-end for testing.
  Record 1 — Dev cert validation (apex)

  - Type: CNAME
  - Host: _8e7862da5a1f081819db1e08cb1287c3.dev
  - Data: _3462f16d3a33497e75446eefc7160ea6.jkddzztszm.acm-validations.aws.

  Record 2 — Dev cert validation (www)

  - Type: CNAME
  - Host: _a18d8168a65ff1ca32ee384080ba921f.www.dev
  - Data: _cd9ad7c4c1c3f01d6e4c3238ea34ace1.jkddzztszm.acm-validations.aws.

  Record 3 — Route http://www.dev to CloudFront

  - Type: CNAME
  - Host: www.dev
  - Data: d23m5rivp3vrdk.cloudfront.net.

  Record 4 — Route http://www.app to CloudFront

  - Type: CNAME
  - Host: www.app
  - Data: d1i2w9qlfyxe1k.cloudfront.net.

  Notes

  - Do not add .netrofit.com to the Host field — Squarespace adds it automatically.
  - Keep the trailing dot on the Data field if Squarespace lets you (some versions auto-add it; either way is fine).
  - TTL: leave at the default (4 hrs is fine).

  After adding all four, save. ACM will validate the new cert within ~5-30 min, the dev deploy will unblock, and
  www.dev.netrofit.com + www.app.netrofit.com will start resolving to the app.











   Fast — verify your test recipient(s) so you can keep testing today:
  aws ses verify-email-identity --email-address karimali201094@gmail.com --profile personal --region eu-west-1
  Then open the verification email AWS sends to that inbox and click the link. After that, registration emails to that address will go through. Repeat for every test address you want to use.

  Right — request production access (no per-recipient ceremony, higher quota):
  aws sesv2 put-account-details --profile personal --region eu-west-1 `
    --mail-type TRANSACTIONAL `
    --website-url https://netrofit.com `
    --use-case-description "Transactional email: account verification OTPs and password resets for SaaS users." `
    --production-access-enabled
  Or do it in the SES console → Account dashboard → "Request production access". Usually approved within a day.
 
  Also worth noting: the code currently swallows this SES error (try { await sendOtpEmail(...) } catch (otpError) { console.error(...) } at auth.ts:322–326), so the API returns a happy 201 to the frontend even when no email actually goes
   out. That's why the frontend gave you no signal. You may want to surface it (return 502/warning) at least in dev, but that's a separate decision.








    Step 1 — Pre-flight (do these first, they make approval near-automatic)

  a) Verify your sender domain with DKIM (you already have netrofit.com as an identity — check DKIM is actually
  verified):

  aws ses get-identity-dkim-attributes --identities netrofit.com --profile personal --region eu-west-1

  If DkimVerificationStatus is not Success, run:

  aws ses verify-domain-dkim --domain netrofit.com --profile personal --region eu-west-1

  It will return 3 CNAME tokens. Add all 3 as CNAMEs in Route 53 (zone Z09915202RRKLGYSVZZTS):
  - Host: <token>._domainkey.netrofit.com
  - Data: <token>.dkim.amazonses.com

  b) Set up a bounce/complaint handler (AWS asks how you handle these). Easiest: subscribe an email to SNS topics for
  bounces/complaints, or just commit to monitoring in the console — for <20/day you can answer "manual monitoring via
  SES dashboard."

  Step 2 — Submit the request

  Console is easier than CLI for this. Open:

  https://eu-west-1.console.aws.amazon.com/ses/home?region=eu-west-1#/account

  → Click "Request production access" (top right banner).

  Fill in the form:

  ┌────────────────────────────┬──────────────────────┐
  │           Field            │     What to put      │
  ├────────────────────────────┼──────────────────────┤
  │ Mail type                  │ Transactional        │
  ├────────────────────────────┼──────────────────────┤
  │ Website URL                │ https://netrofit.com │
  ├────────────────────────────┼──────────────────────┤
  │ Use case description       │ Copy the block below │
  ├────────────────────────────┼──────────────────────┤
  │ Additional contacts        │ leave blank          │
  ├────────────────────────────┼──────────────────────┤
  │ Preferred contact language │ English              │
  ├────────────────────────────┼──────────────────────┤
  │ Compliance with AWS AUP    │ tick yes             │
  └────────────────────────────┴──────────────────────┘

  Use case description (paste this, edit if you want):

  Netrofit is a SaaS platform for multi-branch academy management. We send
  transactional email only:
  1. Account verification OTPs (6-digit code) sent immediately after a user
     registers, to confirm ownership of their email address.
  2. Password reset links, sent on-demand when a user clicks "forgot password".

  Recipients are exclusively users who have just submitted our signup or
  password-reset forms — we never email opt-out lists, marketing lists, or
  purchased lists. Expected volume is under 20 emails per day.

  Bounce/complaint handling: bounces and complaints are monitored via the
  SES console. Hard-bounced addresses are flagged in our database and not
  emailed again. Complaints trigger account review.

  Unsubscribe: not applicable — all email is transactional and triggered
  by an explicit user action on their own account.

  Step 3 — While you wait

  Approval is usually <24h. To unblock your testing today, verify your own inbox:

  aws ses verify-email-identity --email-address karimali201094@gmail.com --profile personal --region eu-west-1

  Then click the link AWS sends to that inbox — registration emails to it will start flowing immediately, even before
  production access is granted.

  Step 4 — After approval

  Nothing to deploy. SES just flips the ProductionAccessEnabled flag and emails to any recipient start going through.
  You can confirm with:

  aws sesv2 get-account --profile personal --region eu-west-1 --query "ProductionAccessEnabled"

  Want me to run step 1a (the DKIM check) now?
