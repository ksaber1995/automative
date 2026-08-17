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

## Sections

The sidebar switches between:

- **Companies** — every tenant, with activate / deactivate / extend / change-type /
  delete, and the per-row QR-card enable + quick mint.
- **Cards** — the per-client card-pool report (see below).
- **Users** — every account in every tenant; create, and move the debug login
  between tenants.
- **Telegram bots** — the platform-owned bot pool.
- **QR generator** — throwaway QR images for anything; nothing is saved.

## Cards

A port of the standalone `cards/` app, which reads the same
`karim-admin-secret` endpoint. It reports **cards generated per active (paying)
client** and the **linked vs unlinked** split of each pool, and clicking a client
opens a full-screen sheet for the whole print workflow:

- shipping address (the tenant's own `companies.address`),
- mint a run — count, type, price per card, and the printed number to start at,
- the card list per state (to print / printed / linked / all),
- download the run as a zip of QR PNGs, then mark it printed.

> "Active client" is the **subscription** (`subscriptions.status = 'ACTIVE'`),
> not `companies.is_active` — that column is `true` for every tenant, so
> filtering on it would be a no-op.

Differences from the standalone app, both structural:

- `cards/` routes the client sheet at `/client/:id`, so it can be linked to and
  reloaded. This console has no router — its sections are a signal on the
  sidebar — so the sheet opens over the report instead and there is no URL for
  one client.
- Its design tokens are scoped to `.cards-scope` in `src/styles.css` rather than
  `:root`, and light-only, so the rest of the console keeps its own palette.

Both apps still exist and both still work; nothing was removed from `cards/`.

## Changing what's shown

- **Data / columns:** edit the SQL in `aws/lambda/api/src/routes/admin-secret.ts`,
  then redeploy the prod API (`AutomateMagicStack-prod`).
- **API location:** the endpoint URL is `ADMIN_ENDPOINT` in
  `src/app/subscriptions.service.ts` — the Cards section imports the same
  constant, so there is one URL to change.
- **CORS:** `http://localhost:4300` must stay in the API's allowlist
  (`aws/lambda/api/src/index.ts` and `aws/lib/core-stack.ts`); a change there
  only takes effect after the prod API is redeployed.

> The zip export pulls in `jszip` + `file-saver`, which pushes the production
> bundle past the old 500 kB warning budget (raised to 800 kB in `angular.json`;
> the 1 MB error budget is untouched). They are also CommonJS, hence the
> `allowedCommonJsDependencies` entry next to it.
