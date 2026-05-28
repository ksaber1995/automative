# Frontend E2E Suite (Playwright)

End-to-end tests for the Angular app. Every test stubs `/api/**` via Playwright
route handlers — **no real backend is ever hit**.

## Run

```bash
# Headless, full suite
npm run e2e

# Headed (watch it click)
npm run e2e:headed

# Interactive runner / debug
npm run e2e:ui

# Single file / pattern
npx playwright test e2e/branches
```

The Playwright config boots `ng serve` on port 4200 automatically and reuses
an already-running dev server when present.

## Layout

```
e2e/
├── auth.setup.ts          # logs in once per role, saves storageState
├── fixtures.ts            # role + apiMock fixtures consumed by every spec
├── helpers/
│   ├── api-mock.ts        # /api/** route handler with sensible defaults
│   └── mock-data.ts       # canned users, branches, courses, etc.
├── auth/                  # login, register, forgot/reset, verify-email
├── layout/                # shell, sidebar, language, logout
├── dashboard/
├── branches/
├── students/
├── academy/               # courses, master-courses, classes, events, rooms…
├── enrollments/
├── people/                # employees + users (RBAC)
├── finance/               # revenues, expenses, refunds, dues, debts, cash
├── products/
├── reports/
├── permissions/           # per-role redirect/visibility gating
└── .auth/                 # saved storage states (gitignored)
```

## Mocking conventions

`installApiMocks(page, user)` registers a single `page.route('**/api/**')`
handler that walks a table of `(method, regex, responder)` entries. Specs
override one or two endpoints per scenario via `apiMock.override(method, re, fn)`.

```ts
apiMock.override('GET', /\/api\/branches$/, () => ({ body: [] }));
```

Default responses live in `helpers/api-mock.ts` and are scoped to the user
returned by the `asUser` fixture, which is keyed off the `role` option.

## Adding tests

Use the shared `test` from `fixtures.ts`, not the bare `@playwright/test`:

```ts
import { test, expect } from '../fixtures';

test.use({ role: 'accountant' });

test('accountant can see revenues', async ({ page }) => {
  await page.goto('/revenues');
  await expect(page.getByRole('heading', { name: /revenues/i })).toBeVisible();
});
```

Selectors should prefer Playwright's user-facing locators (`getByRole`,
`getByLabel`, `getByText`) over CSS classes — PrimeNG class names change
between minor versions.
