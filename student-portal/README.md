# Netrofit Student Exam Portal

The student-facing site at **exams.netrofit.com** (online_exams.md §0.5). Students claim their
card by scanning it with the phone camera, set a username (or phone) + password, and sign in.
Forgot the password → scan the card again. Phase 6 adds the actual exam sitting; until then the
signed-in home is an empty exam list.

Deliberately a separate, tiny Angular app: it contains none of the staff app's code
(`AuthService`, permissions, branch machinery), so no routing mistake can expose a staff screen
and no staff bundle ships to students. Scaffolded from `admin/` (same build/deploy shape).

## Dev

```bash
npm install
npm start          # ng serve on http://localhost:4400
```

`ng serve` proxies `/api/*` to the production API through `proxy.conf.json`, so the app always
calls a relative `/api` — same as production, where CloudFront's apiProxy behaviour does the
proxying. The execute-api hostname never ships in the bundle and the API's CORS allowlist needs
no entry for this app.

Camera note: `localhost` counts as a secure context, so the scan screen's camera works in dev.
On a phone it needs HTTPS — test the scan flow against the deployed site.

## Deploy

Two steps, same as `admin/` — CDK uploads the prebuilt bundle, it does **not** build the app:

```bash
cd student-portal && npm run build     # production is the default configuration
cd ../aws && npx cdk deploy NetrofitExamsStack-prod --profile personal --require-approval never
```

The stack (`NetrofitExamsStack-prod` in `aws/bin/core.ts`) lives in **us-east-1** (CloudFront
certs must). First deploy issues the ACM cert and creates the Route 53 A/AAAA records itself
(`certValidationInZone: true` — safe only because the stack is brand-new); if anyone has pointed
`exams.netrofit.com` somewhere by hand, delete those records first or the deploy fails with
"record already exists".

## i18n

Arabic-first with an English toggle, hand-rolled in `src/app/i18n.service.ts` — one dictionary,
two languages, no library. API error codes (`ERRORS.*`) are dictionary keys too. The stylesheet
uses only logical properties, so RTL/LTR is one attribute flip.
