# cards

A local-only, single-page report:

- **Cards generated per active client** — the size of each active client's QR card pool.
- **QR pool split** — how many cards are **linked** (handed out to a student) vs **unlinked** (still free in the pool), both overall and per client.

Only **active (paying)** clients are shown — those with an `ACTIVE` subscription
(`subscriptions.status = 'ACTIVE'`), not trials and not expired/parked tenants.

## What it reads

It calls the same unauthenticated owner endpoint the admin console uses:

```
https://xnbgr057y1.execute-api.eu-west-1.amazonaws.com/prod/api/karim-admin-secret
```

- `GET /karim-admin-secret` → every company (filtered client-side to active ones).
- `GET /karim-admin-secret/companies/:id/qr-cards` → `{ total, linked, qr_cards_enabled }` per client; `unlinked = total − linked`.

No backend deploy is needed — it uses routes that are already live.

## Running it

The API's CORS allowlist only permits a few origins, so the page **must be served from
`http://localhost:4800`** (opening `index.html` as a `file://` will be blocked by CORS).

```
cd cards
npm start            # serves on http://localhost:4800 and opens the browser
```

No Node? Any static server on port 4800 works, e.g.:

```
python -m http.server 4800
```

then open <http://localhost:4800>.

> Note: `http://localhost:4800` must be in the API's CORS allowlist for this to work.
> It's in `aws/lambda/api/src/index.ts` (`ALLOWED_ORIGINS`) and `aws/lib/core-stack.ts`
> (`allowOrigins`); a change there only takes effect after the prod API is redeployed.
> (The admin console uses a different port, `4300`.)

## Notes

- "Cards generated" is a client's whole QR pool (`qr_cards` rows). A client with the pool
  turned off, or one that's never had a run minted, shows `0`; the **Only clients with cards**
  toggle (on by default) hides them.
- Click any numeric column header to sort.
