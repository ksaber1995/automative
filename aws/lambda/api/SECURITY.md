# API Security — SQL Injection Rules

The backend uses `pg` against PostgreSQL via `src/db/connection.ts`. Every
endpoint must follow these rules. Reviewers: if you see a PR that breaks one
of these, block it.

## 1. Always parameterize values

Use `$1, $2, …` placeholders. Never interpolate values via template
literals or string concat.

```ts
// GOOD
await query(
  'SELECT * FROM students WHERE company_id = $1 AND id = $2',
  [context.companyId, params.id]
);

// BAD — direct interpolation
await query(`SELECT * FROM students WHERE id = '${params.id}'`);
```

This holds even when the value "looks safe" — UUIDs from the JWT,
booleans, numbers. The DB layer must not depend on upstream validation.

## 2. Build dynamic WHERE clauses by pushing to a params array

The standard pattern across the codebase:

```ts
const conditions: string[] = ['company_id = $1'];
const params: any[] = [context.companyId];

if (queryParams.status) {
  params.push(queryParams.status);
  conditions.push(`status = $${params.length}`);
}
if (queryParams.branchId) {
  params.push(queryParams.branchId);
  conditions.push(`branch_id = $${params.length}`);
}

const sql = `SELECT * FROM events WHERE ${conditions.join(' AND ')}`;
await query(sql, params);
```

Note: `${conditions.join(' AND ')}` is safe **only** because every element
of `conditions` is built from developer-controlled SQL fragments with `$N`
placeholders — never from user input.

## 3. Identifiers (table / column / ORDER BY) cannot be parameterized

Postgres only parameterizes values. If you must inject an identifier, use
an explicit allowlist.

```ts
// GOOD — allowlist
const SORTABLE = new Set(['name', 'created_at', 'amount']);
const sortBy = SORTABLE.has(query.sortBy) ? query.sortBy : 'created_at';
const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
sql += ` ORDER BY ${sortBy} ${dir}`;

// BAD — user-controlled identifier
sql += ` ORDER BY ${query.sortBy}`;
```

Existing examples in this repo:
- `validateCompanyOwnership` uses `OWNERSHIP_TABLE_ALLOWLIST`.
- `appendBranchSqlFilter` validates `columnAlias` against `SAFE_IDENT`
  (regex `^[a-zA-Z_][a-zA-Z0-9_.]*$`).

## 4. LIMIT / OFFSET — clamp to integer

If a route accepts pagination from the client, coerce to integer and clamp
before interpolating:

```ts
const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);
sql += ` LIMIT ${limit} OFFSET ${offset}`;
```

Better still — parameterize: `sql += ' LIMIT $N OFFSET $M'`. Postgres
accepts placeholders for LIMIT/OFFSET.

## 5. INTERVAL values must use `make_interval`

`INTERVAL '$1 months'` is a syntax error in postgres — the parameter
substitutes into a string literal, not the interval grammar. Use
`make_interval`:

```ts
// GOOD
`CURRENT_DATE - make_interval(months => $1::int)`

// BAD — interpolation, even with a clamped int
`CURRENT_DATE - INTERVAL '${months} months'`
```

## 6. LIKE / ILIKE patterns

Wrap the value in `%…%` outside the SQL, then pass as a parameter:

```ts
// GOOD
const sql = 'SELECT * FROM x WHERE name ILIKE $1';
await query(sql, [`%${searchTerm}%`]);

// BAD
await query(`SELECT * FROM x WHERE name ILIKE '%${searchTerm}%'`);
```

If users should not be able to use `%` / `_` as wildcards, escape them:

```ts
const escaped = searchTerm.replace(/[%_\\]/g, '\\$&');
await query("SELECT * FROM x WHERE name ILIKE $1 ESCAPE '\\'", [`%${escaped}%`]);
```

## 7. The `insert` / `update` / `findAll` helpers in `db/connection.ts`

These helpers interpolate **object keys as column names** and **the table
name** directly into SQL. They are safe **only** when callers pass
developer-controlled key sets:

```ts
// GOOD — keys come from explicit `if (body.x !== undefined)` chains
const updateData: any = {};
if (body.firstName !== undefined) updateData.first_name = body.firstName;
if (body.lastName !== undefined) updateData.last_name = body.lastName;
await update('employees', params.id, updateData);

// BAD — passing the raw body lets an attacker set arbitrary column names
await update('employees', params.id, body);
```

**Never pass `body`, `req.body`, `params`, or `query` directly as the data
object** to these helpers. Always build an allowlisted object.

## 8. JWT-derived values are not a free pass

`context.companyId`, `context.branchId`, etc. come from a signed JWT — but
the rule still applies: pass them as parameters. JWT signing protects
against forgery; parameterization protects against value-grammar bugs
(e.g., a future migration that changes a column type from UUID to TEXT).

The legacy `getBranchSqlFilter` is `@deprecated` for exactly this reason;
new code should use `appendBranchSqlFilter`.

## Rate Limiting

Defined in `src/middleware/rate-limit.ts`. Counters live **per Lambda
container, in memory** — accepted trade-off: zero infra, but an attacker
spreading load across many containers gets ~N× the limit. Treat these as
the inner ring; API Gateway throttling / WAF is the outer ring.

| Bucket               | Limit | Window | Where it's keyed                  | Where it fires                                    |
| -------------------- | ----- | ------ | --------------------------------- | ------------------------------------------------- |
| `AUTH_IP`            | 20    | 15 min | Client IP                         | login, register, verifyPhone, resendOtp           |
| `AUTH_EMAIL`         | 5     | 15 min | Lowercased email / phone identity | login (identifier), register (email), OTP routes (countryCode:phone) |
| `PUBLIC_FORM_IP`     | 10    | 1 hour | Client IP + submitted email       | demo-leads create                                 |
| `AUTHED_USER`        | 600   | 15 min | JWT user ID                       | every authenticated route (via `extractTenantContext`) |
| `AUTHED_COMPANY`     | 3000  | 15 min | JWT company ID                    | every authenticated route (via `extractTenantContext`) |

### How a block surfaces

`enforce()` throws `TsRestHttpError(429, { message, retryAfter })`. ts-rest
propagates the status straight to API Gateway, so individual routes do
**not** need to declare 429 in their contract entries. The body the client
sees is:

```json
{ "message": "Too many requests. Please slow down and try again later.", "retryAfter": 42 }
```

### Adding a new rate-limited endpoint

1. **Public endpoint?** Call `enforceByIp(RATE_LIMITS.PUBLIC_FORM_IP)` (or
   `AUTH_IP` for auth flows) at the top of the route. If the endpoint
   takes an identifier (email/phone), also call
   `enforce(RATE_LIMITS.AUTH_EMAIL, normalizedIdentifier)`.
2. **Authenticated endpoint?** No action needed — calling
   `extractTenantContext` already runs `AUTHED_USER` and `AUTHED_COMPANY`.
   Add a tighter bucket only if the endpoint is unusually expensive (heavy
   report, file upload).
3. **Tighter bucket needed?** Add an entry to `RATE_LIMITS` in
   `rate-limit.ts`. Don't reuse an existing bucket for a different purpose
   — separate buckets so unrelated traffic can't starve each other.

### What this does NOT cover

- **Cross-container collusion.** An attacker who can force fan-out across
  many warm Lambdas evades the per-container counter. Mitigate with API
  Gateway usage plans or AWS WAF rate rules if abuse is observed.
- **Account enumeration via response timing.** Already partially handled
  in `resendOtp` (generic response). Keep response shapes uniform for
  auth-failure paths.
- **Cost-based attacks** on expensive reports. The `AUTHED_USER` cap is
  the only backstop; consider adding a per-route bucket if a report is
  >500 ms.

### Local testing

`__resetForTests()` in `rate-limit.ts` clears all counters between tests.
Never call from production code.

## Quick review checklist

When you review a route, scan for these in order:

- [ ] Every `query(text, params)` / `pool.query(...)` uses `$N`
  placeholders for **all** values that came from `body`, `params`,
  `query`, or `headers`.
- [ ] Any `${…}` inside a SQL string is either a `$N` placeholder or a
  fragment built from internal constants / allowlist.
- [ ] `ORDER BY`, `LIMIT`, `OFFSET`, table names, column names — all
  validated against an allowlist if user-influenced.
- [ ] `LIKE` / `ILIKE` operands are passed as parameters, not concatenated.
- [ ] `insert` / `update` calls pass an explicit object, never a raw
  request payload.

If anything in a PR violates the above, link this file in the review
comment.
