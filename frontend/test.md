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