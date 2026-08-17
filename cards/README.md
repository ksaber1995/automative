# cards

A local-only Angular app reporting:

- **Cards generated per active client** — the size of each active client's QR card pool.
- **QR pool split** — how many cards are **linked** (handed out to a student) vs **unlinked** (still free in the pool), both overall and per client.

Only **active (paying)** clients are shown — those with an `ACTIVE` subscription
(`subscriptions.status = 'ACTIVE'`), not trials and not expired/parked tenants.

> Note: "active" here is the **subscription**, not `companies.is_active` — that
> column is `true` for every tenant (deactivating a client only expires the
> subscription), so filtering on it would be a no-op.

> **This app no longer works, and cannot be made to work from localhost.** Two
> things stand in the way, both deliberate:
>
> 1. Every `/api/karim-admin-secret` route requires an admin-portal sign-in (see
>    `admin/README.md`) and nothing here sends a token.
> 2. `http://localhost:4800` was removed from the API's CORS allowlist, and those
>    routes now refuse any request announcing a localhost `Origin`.
>
> The whole of this report was ported into the admin console as its **Cards**
> section, at <https://dione.netrofit.com>. This directory is kept only as the
> source the port was made from.

## What it reads

It calls the same owner endpoint the admin console uses:

```
https://xnbgr057y1.execute-api.eu-west-1.amazonaws.com/prod/api/karim-admin-secret
```

- `GET /karim-admin-secret` → every company (filtered client-side to active ones).
- `GET /karim-admin-secret/companies/:id/qr-cards` → `{ total, linked, qr_cards_enabled }` per client; `unlinked = total − linked`.

Per-client requests are capped at 6 in flight (`environment.poolConcurrency`).
No backend deploy is needed — it uses routes that are already live.

## Running it

*(Historical — port 4800 is no longer in the API's CORS allowlist, so this now
fails at the first request. See the note at the top.)*


```
cd cards
npm install          # first time only
npm start            # ng serve on http://localhost:4800, opens the browser
```

Other scripts:

```
npm run build        # production build into dist/cards
npm run watch        # rebuild on change (development configuration)
```

> `http://localhost:4800` used to be in the API's CORS allowlist
> (`aws/lambda/api/src/index.ts` `ALLOWED_ORIGINS` and `aws/lib/core-stack.ts`
> `allowOrigins`). It was removed once the console moved to dione.netrofit.com,
> so this no longer works even with a token.

## Layout

```
src/
  main.ts                        bootstrap (standalone, provideHttpClient)
  styles.css                     design tokens (light/dark) + shared primitives
  environments/environment.ts    admin endpoint + request concurrency
  app/
    models.ts                    AdminCompany / QrCardStats / ClientRow
    cards.service.ts             fetches companies + per-client pools
    app.component.ts             page shell: filters, KPIs, state
    kpi-tile.component.ts        one headline number
    pool-bar.component.ts        linked/unlinked split bar (compact variant for rows)
    client-table.component.ts    sortable table + footer totals
    client-drawer.component.ts   per-client detail slide-over
```

## Notes

- "Cards generated" is a client's whole QR pool (`qr_cards` rows). A client with the pool
  turned off, or one that's never had a run minted, shows `0`; the **Only clients with cards**
  toggle (on by default) hides them.
- Click any numeric column header to sort. Click a row (or press Enter/Space) for details.
- A single client's pool request failing leaves that client at zeros rather than
  losing the whole report.
