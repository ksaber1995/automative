# Netrofit Admin (local-only superadmin console)

A tiny tool **for you only** — it lists every company/tenant in the system with
their subscription type, employee count, branch count, and start/end dates. You
run it on your laptop; it is **not deployed**.

## How it works

The Angular app calls one obscure, read-only endpoint on the **production API**:

```
GET https://xnbgr057y1.execute-api.eu-west-1.amazonaws.com/prod/api/karim-admin-secret
```

That endpoint runs a single cross-tenant `SELECT` and returns aggregate numbers
+ company names (no credentials/PII). It is unauthenticated — the obscure path
is the only gate. No AWS keys, no local server, no `.env`.

## Run

```bash
cd admin
npm install      # first time only
npm start        # → http://localhost:4300
```

Use the search box to filter by company name or subscription type.

## Changing what's shown

- **Data / columns:** edit the SQL in `aws/lambda/api/src/routes/admin-secret.ts`,
  then redeploy the prod API (`AutomateMagicStack-prod`).
- **API location:** the endpoint URL is `ADMIN_ENDPOINT` in
  `src/app/subscriptions.service.ts`.
