# Netrofit Admin (local-only superadmin console)

A tool **for you only** — every tenant in the system, their card pools, their
user accounts, and the Telegram bot pool. You run it on your laptop; it is **not
deployed**.

## How it works

The Angular app calls the **production API** under one prefix:

```
https://xnbgr057y1.execute-api.eu-west-1.amazonaws.com/prod/api/karim-admin-secret
```

**Everything on that prefix needs a sign-in.** It used to be gated by nothing but
the obscure path, which was defensible when the payload was aggregate counts. It
now returns every tenant's owner email, mobile and postal address, and sits next
to routes that delete a company outright — so the path is no longer treated as a
credential. See `aws/lambda/api/src/routes/admin-portal.ts`.

No AWS keys, no local server, no `.env`.

## Run

```bash
cd admin
npm install      # first time only
npm start        # → http://localhost:4300
```

Sign in with a portal account (below). Use the search box to filter by company
name or subscription type.

## Signing in

Accounts live in `admin_secret_users` in the production database. There is
**deliberately no registration** — accounts are created by an existing portal
user in **Portal users**, or by hand in the database.

- **Token**: a JWT signed with the API's existing JWT secret, carrying
  `typ: "admin-portal"`. That claim is what stops an ordinary customer's app
  token from working here (the two share a signing key). Valid for **12 hours** —
  short, because this console can delete a tenant.
- **Sessions** are kept in `localStorage` and re-validated against
  `GET /portal/me` on every page load, so a revoked permission or a disabled
  account takes effect on the next refresh rather than at token expiry.
- **Login is rate-limited** per IP (20 / 15 min) and per email (10 / 15 min), and
  every failure returns the same message so the page cannot be used to find out
  who has access.

### Roles and permissions

| Role | Meaning |
|---|---|
| `OWNER` | Every permission, including ones added in future. Only an owner can create or demote another owner, and the last active owner cannot be demoted, disabled or deleted. |
| `MEMBER` | Exactly the permissions ticked against them. |

Permission keys, granted per user in **Portal users**:

`companies.read` · `companies.write` · `companies.delete` · `cards.read` ·
`cards.write` · `tenant_users.read` · `tenant_users.write` · `bots.read` ·
`bots.write` · `portal_users.read` · `portal_users.write`

The sidebar and the row buttons hide what you cannot use, but that is a
courtesy — the API re-checks every call, so hiding a button is never the
security boundary. The QR generator needs no permission: it renders images from
text typed into the page and reads nothing.

### Seeding the first account

A fresh database has no portal users, and there is no way to make one through the
UI. Create it directly — generate the hash with the API's own bcrypt so the cost
factor matches:

```bash
cd aws/lambda/api
node -e "console.log(require('bcryptjs').hashSync(process.env.PW, 10))"   # PW set in the environment
```

then insert it (the table is created on first use by `ensureAdminPortalSchema`,
or run the same `CREATE TABLE IF NOT EXISTS` by hand):

```sql
INSERT INTO admin_secret_users (email, password_hash, name, role)
VALUES ('you@example.com', '<hash>', 'Your Name', 'OWNER');
```

Never put a plaintext password — or the hash of one — in this repository.

## Sections

The sidebar switches between:

- **Companies** — every tenant, with activate / deactivate / extend / change-type /
  delete, and the per-row QR-card enable + quick mint.
- **Cards** — the per-client card-pool report (see below).
- **Users** — every account in every tenant; create, and move the debug login
  between tenants.
- **Telegram bots** — the platform-owned bot pool.
- **QR generator** — throwaway QR images for anything; nothing is saved.
- **Portal users** — who may sign in to this console, and what each of them may
  do. Not the same thing as **Users**: that one creates accounts inside a
  customer's tenant, this one hands out keys to the console that can delete those
  customers.

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
