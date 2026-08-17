# Netrofit Admin (superadmin console)

A tool **for you only** — every tenant in the system, their card pools, their
user accounts, and the Telegram bot pool.

- **Deployed:** <https://dione.netrofit.com>
- **Local:** `npm start` → <http://localhost:4300>

## How it works

The Angular app calls the **production API** under one prefix:

```
/api/karim-admin-secret          # deployed — CloudFront proxies it same-origin
https://xnbgr057y1.execute-api.eu-west-1.amazonaws.com/prod/api/karim-admin-secret   # local
```

Which one is compiled in comes from `src/environments/` (`environment.prod.ts`
replaces `environment.ts` in the production configuration). The deployed build
therefore needs no CORS entry and never names the API host.

**Everything on that prefix needs a sign-in.** It used to be gated by nothing but
the obscure path, which was defensible when the payload was aggregate counts. It
now returns every tenant's owner email, mobile and postal address, and sits next
to routes that delete a company outright — so the path is no longer treated as a
credential. See `aws/lambda/api/src/routes/admin-portal.ts`.

No AWS keys, no local server, no `.env`.

## Run locally

```bash
cd admin
npm install      # first time only
npm start        # → http://localhost:4300
```

> **`npm start` no longer reaches the production API.** Now that the console has
> a home of its own, localhost is not a place it is served from: `localhost:4300`
> and `localhost:4800` were removed from the API's CORS allowlist, and the
> `karim-admin-secret` routes additionally refuse any request announcing a
> localhost `Origin` — so the customer app's `:4200` dev server cannot reach them
> either. Expect `403 ADMIN_PORTAL.LOCAL_ORIGIN`.
>
> That is a browser-path control, not a security boundary: `Origin` is just a
> header, absent on curl and forgeable by anything that is not a browser. The
> portal sign-in is what actually protects these routes. What it buys is that the
> only *browser* that can drive this console is one on dione.netrofit.com.
>
> To work on the UI locally, either point `environment.ts` at a dev API, or add
> `http://localhost:4300` back to `ALLOWED_ORIGINS`
> (`aws/lambda/api/src/index.ts` **and** `aws/lib/core-stack.ts`), relax
> `isLocalOrigin` in `routes/admin-portal.ts`, and redeploy the API — then put
> both back.

Sign in with a portal account (below). Use the search box to filter by company
name or subscription type.

## Deploy

```bash
cd admin;  npm run build        # production configuration is the default
cd ../aws; npx cdk deploy NetrofitAdminStack-prod --profile personal --require-approval never
```

`NetrofitAdminStack-prod` (defined in `aws/bin/core.ts`, built from the shared
`LandingStack`) is S3 + CloudFront + an ACM cert, in **us-east-1** — CloudFront
certs must live there, so it will not appear in `aws cloudformation` calls that
default to eu-west-1. It uploads `admin/dist/admin/browser`; CDK only ships the
prebuilt output, it does not build for you.

### DNS

**Fully managed by CDK — nothing to add at a registrar.** `netrofit.com` is a
Route 53 zone in this same account (`Z09915202RRKLGYSVZZTS`) and the registrar's
nameservers are delegated to it, so the stack writes both records itself:

| Record | Purpose |
|---|---|
| `_<hash>.dione.netrofit.com` CNAME → `_<hash>.acm-validations.aws` | proves domain ownership so ACM issues the cert |
| `_<hash>.www.dione.netrofit.com` CNAME → `_<hash>.acm-validations.aws` | same, for the www SAN |
| `dione.netrofit.com` A + AAAA (alias) → the CloudFront distribution | the site itself |
| `www.dione.netrofit.com` A + AAAA (alias) → the same distribution | the www alias |

Both names serve the console; neither redirects to the other.

Adding or removing a name is **not** a DNS change — it is a certificate change,
and ACM cannot extend an issued cert, so CloudFormation replaces it. Change
`domainName`/`wwwDomain` on the stack and redeploy; do not point DNS at a name
the certificate does not cover, or browsers get a TLS mismatch instead of a
clean NXDOMAIN.

The validation half is what `certValidationInZone: true` on this stack buys.
**Do not set it on the other three stacks** — handing ACM the zone changes a
CloudFormation property on the certificate, which replaces an already-issued one.

If the zone ever moves off Route 53 (Cloudflare, or the registrar's own DNS),
those two rows become manual: add the CNAME exactly as ACM prints it, and point
the host at the distribution — a CNAME to `<id>.cloudfront.net`, or an ALIAS /
flattened record if the provider offers one.

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

Each one is a route, so a reload, a bookmark or a pasted link comes back to the
same screen — the sidebar used to be a `view` signal, which meant every refresh
landed on Companies.

| URL | Section | Permission |
|---|---|---|
| `/companies` | Companies & Subscriptions | `companies.read` |
| `/users` | tenant user accounts | `tenant_users.read` |
| `/cards` | card-pool report (`?client=<id>` opens a client sheet) | `cards.read` |
| `/bots` | Telegram bot pool | `bots.read` |
| `/qr` | QR generator | none |
| `/portal-users` | console sign-ins | `portal_users.read` |

`/` redirects to `/companies`, and the route guard bounces anyone without that
permission on to the first section they DO hold — so an account granted only
Cards lands on `/cards` rather than a page it cannot open.

Searches and filters are in the URL too, so a filtered table survives a reload
and can be sent to someone as a link:

| Page | Keys |
|---|---|
| `/companies` | `q`, `status` |
| `/users` | `q`, `tenant` |
| `/cards` | `q`, `type`, `withCards`, `needsPrinting`, `exhausted`, `client` |

A key is written only when it differs from the default, so the common case stays
a clean `/cards` — `withCards` defaults on and appears only when switched off.
The plumbing is `shared/query-sync.ts`; writes `merge` (so the Cards sheet's
`client` and the filters can share a URL) and `replaceUrl` (so typing in a search
box does not push a history entry per keystroke).

Sorting is deliberately **not** in the URL — it is a way of reading a table
rather than a way of choosing what is in it.

Deep links survive a reload because CloudFront rewrites anything that is not
`/api/*` and has no file extension to `/index.html` (the SPA fallback function in
`aws/lib/landing-stack.ts`).

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

### Where the code lives

- `app.component.ts` — the shell only: sidebar, session, the outlet.
- `app.routes.ts` — the route table, the `SECTIONS` list the sidebar renders
  from, and the permission guard.
- `admin-store.service.ts` — the data more than one screen needs (tenants, tenant
  users, bots). Loads are idempotent, so moving between sections does not
  re-fetch; the Refresh buttons pass `force`.
- `shared/admin-ui.css` — the common chrome, pulled in per page via `styleUrls`
  rather than dropped in the global stylesheet, so it stays scoped and cannot
  leak into the Cards section's own palette.

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
