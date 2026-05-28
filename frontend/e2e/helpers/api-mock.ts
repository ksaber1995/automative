import { Page, Route } from '@playwright/test';
import {
  BRANCHES,
  CLASSES,
  COMPANY,
  COURSES,
  DASHBOARD_STATS,
  EMPLOYEES,
  EVENTS,
  EXPENSES,
  MASTER_COURSES,
  PRODUCTS,
  REVENUES,
  ROOMS,
  STUDENTS,
  TOKEN,
  USERS,
  type MockUser,
} from './mock-data';

// In-test API stub layer. Each test (or test group) calls `installApiMocks(page)`
// — that registers a single page.route('**/api/**') handler that walks a table
// of [method, regex, responder] entries. Specs can then override or extend the
// table per scenario via the returned `overrides` helper.

type Responder = (
  url: URL,
  request: { method: string; postDataJSON?: () => unknown },
) => { status?: number; body?: unknown; headers?: Record<string, string> } | Promise<{ status?: number; body?: unknown; headers?: Record<string, string> }>;

type Entry = { method: string; pattern: RegExp; respond: Responder };

export interface ApiMockHandle {
  /** Add a one-off or overriding entry. More-recent entries win. */
  override(method: string, pattern: RegExp, respond: Responder): void;
  /** Reset to defaults (called automatically at test end via fixture). */
  reset(): void;
  /** Drop all entries — useful when a test wants only a specific subset. */
  clear(): void;
}

export async function installApiMocks(
  page: Page,
  user: MockUser = USERS.admin,
): Promise<ApiMockHandle> {
  const overrides: Entry[] = [];
  const defaults: Entry[] = buildDefaults(user);

  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());

    const matcher = [...overrides].reverse().concat(defaults).find(
      (e) => e.method === method && e.pattern.test(url.pathname),
    );

    if (!matcher) {
      // No match — return 404 so the test sees a clear failure rather than
      // a hanging request waiting for the real API.
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'E2E.UNMATCHED', message: `No mock for ${method} ${url.pathname}` }),
      });
      return;
    }

    const result = await matcher.respond(url, {
      method,
      postDataJSON: () => {
        try {
          return request.postDataJSON();
        } catch {
          return undefined;
        }
      },
    });

    await route.fulfill({
      status: result.status ?? 200,
      contentType: 'application/json',
      headers: result.headers,
      body: JSON.stringify(result.body ?? {}),
    });
  });

  return {
    override(method, pattern, respond) {
      overrides.push({ method, pattern, respond });
    },
    reset() {
      overrides.length = 0;
    },
    clear() {
      defaults.length = 0;
      overrides.length = 0;
    },
  };
}

function authResponse(user: MockUser) {
  return {
    accessToken: TOKEN,
    refreshToken: TOKEN + '-r',
    user,
    company: COMPANY,
  };
}

function buildDefaults(user: MockUser): Entry[] {
  return [
    // ─── Auth ────────────────────────────────────────────────────────────
    { method: 'POST', pattern: /\/api\/auth\/login$/, respond: () => ({ body: authResponse(user) }) },
    { method: 'POST', pattern: /\/api\/auth\/register$/, respond: () => ({ status: 201, body: { email: 'new@acme.test', message: 'Verification email sent' } }) },
    { method: 'POST', pattern: /\/api\/auth\/verify-email$/, respond: () => ({ body: authResponse(user) }) },
    { method: 'POST', pattern: /\/api\/auth\/resend-email-otp$/, respond: () => ({ body: { message: 'OTP sent' } }) },
    { method: 'POST', pattern: /\/api\/auth\/forgot-password$/, respond: () => ({ body: { message: 'If this account exists, an OTP has been sent.' } }) },
    { method: 'POST', pattern: /\/api\/auth\/reset-password$/, respond: () => ({ body: { message: 'Password reset.' } }) },
    { method: 'GET',  pattern: /\/api\/auth\/profile$/, respond: () => ({ body: user }) },

    // ─── Subscriptions / Company ────────────────────────────────────────
    { method: 'GET',  pattern: /\/api\/subscriptions\/current$/, respond: () => ({ body: { status: 'ACTIVE', tier: 'PRO', endsAt: '2099-01-01', daysRemaining: 9999 } }) },
    { method: 'GET',  pattern: /\/api\/companies\/me$/, respond: () => ({ body: COMPANY }) },
    { method: 'PATCH', pattern: /\/api\/companies\/me$/, respond: (_, req) => ({ body: { ...COMPANY, ...(req.postDataJSON() as object) } }) },

    // ─── Branches ───────────────────────────────────────────────────────
    { method: 'GET',  pattern: /\/api\/branches$/, respond: () => ({ body: BRANCHES }) },
    { method: 'GET',  pattern: /\/api\/branches\/active$/, respond: () => ({ body: BRANCHES.filter(b => b.isActive) }) },
    { method: 'GET',  pattern: /\/api\/branches\/[^/]+\/stats$/, respond: () => ({ body: { courseCount: 4, studentCount: 25, classCount: 3, employeeCount: 8, totalRevenue: 50000, totalExpenses: 18000, netProfit: 32000, activeEnrollments: 22 } }) },
    { method: 'GET',  pattern: /\/api\/branches\/[^/]+\/deletion-impact$/, respond: (url) => {
      const id = url.pathname.split('/')[3];
      const b = BRANCHES.find(x => x.id === id);
      const hasFinancials = b?.hasFinancials ?? false;
      return { body: { hasFinancials, counts: { revenues: hasFinancials ? 5 : 0, expenses: hasFinancials ? 3 : 0, expensePayments: hasFinancials ? 2 : 0, students: 4, employees: 2, products: 1 } } };
    }},
    { method: 'GET',  pattern: /\/api\/branches\/[^/]+$/, respond: (url) => {
      const id = url.pathname.split('/').pop();
      const b = BRANCHES.find(x => x.id === id);
      return b ? { body: b } : { status: 404, body: { code: 'ERRORS.BRANCHES.NOT_FOUND', message: 'Not found' } };
    }},
    { method: 'POST', pattern: /\/api\/branches$/, respond: (_, req) => ({ status: 201, body: { id: 'b-new', ...(req.postDataJSON() as object), companyId: COMPANY.id, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }) },
    { method: 'PATCH', pattern: /\/api\/branches\/[^/]+$/, respond: (url, req) => {
      const id = url.pathname.split('/').pop();
      const b = BRANCHES.find(x => x.id === id);
      return { body: { ...b, ...(req.postDataJSON() as object), updatedAt: new Date().toISOString() } };
    }},
    { method: 'DELETE', pattern: /\/api\/branches\/[^/]+$/, respond: (url) => {
      const id = url.pathname.split('/').pop();
      const b = BRANCHES.find(x => x.id === id);
      const hasFinancials = b?.hasFinancials ?? false;
      return { body: { message: hasFinancials ? 'Deactivated' : 'Deleted', code: hasFinancials ? 'BRANCHES.DEACTIVATED_WITH_FINANCIALS' : 'BRANCHES.DELETED', deactivated: hasFinancials, counts: { revenues: 0, expenses: 0, expensePayments: 0, students: 0, employees: 0, products: 0 } } };
    }},

    // ─── Students ───────────────────────────────────────────────────────
    { method: 'GET',  pattern: /\/api\/students$/, respond: () => ({ body: STUDENTS }) },
    { method: 'GET',  pattern: /\/api\/students\/[^/]+$/, respond: (url) => {
      const id = url.pathname.split('/').pop();
      const s = STUDENTS.find(x => x.id === id);
      return s ? { body: s } : { status: 404, body: { code: 'ERRORS.STUDENTS.NOT_FOUND', message: 'Not found' } };
    }},
    { method: 'POST', pattern: /\/api\/students$/, respond: (_, req) => ({ status: 201, body: { id: 's-new', ...(req.postDataJSON() as object), companyId: COMPANY.id, isActive: true } }) },
    { method: 'PATCH', pattern: /\/api\/students\/[^/]+$/, respond: (url, req) => {
      const id = url.pathname.split('/').pop();
      return { body: { ...STUDENTS.find(x => x.id === id), ...(req.postDataJSON() as object) } };
    }},
    { method: 'DELETE', pattern: /\/api\/students\/[^/]+$/, respond: () => ({ body: { message: 'Deleted' } }) },

    // ─── Courses / Master Courses / Classes ────────────────────────────
    { method: 'GET',  pattern: /\/api\/courses$/, respond: () => ({ body: COURSES }) },
    { method: 'GET',  pattern: /\/api\/courses\/active$/, respond: () => ({ body: COURSES.filter(c => c.isActive) }) },
    { method: 'GET',  pattern: /\/api\/courses\/[^/]+$/, respond: (url) => {
      const id = url.pathname.split('/').pop();
      return { body: COURSES.find(x => x.id === id) || COURSES[0] };
    }},
    { method: 'POST', pattern: /\/api\/courses$/, respond: (_, req) => ({ status: 201, body: { id: 'c-new', ...(req.postDataJSON() as object) } }) },
    { method: 'PATCH', pattern: /\/api\/courses\/[^/]+$/, respond: (_, req) => ({ body: { ...COURSES[0], ...(req.postDataJSON() as object) } }) },
    { method: 'DELETE', pattern: /\/api\/courses\/[^/]+$/, respond: () => ({ body: { message: 'Deleted' } }) },

    { method: 'GET',  pattern: /\/api\/master-courses$/, respond: () => ({ body: MASTER_COURSES }) },
    { method: 'GET',  pattern: /\/api\/master-courses\/[^/]+\/enrollments$/, respond: () => ({ body: [] }) },
    { method: 'GET',  pattern: /\/api\/master-courses\/[^/]+$/, respond: () => ({ body: MASTER_COURSES[0] }) },
    { method: 'POST', pattern: /\/api\/master-courses$/, respond: (_, req) => ({ status: 201, body: { id: 'mc-new', ...(req.postDataJSON() as object) } }) },
    { method: 'PATCH', pattern: /\/api\/master-courses\/[^/]+$/, respond: () => ({ body: MASTER_COURSES[0] }) },
    { method: 'DELETE', pattern: /\/api\/master-courses\/[^/]+$/, respond: () => ({ body: { message: 'Deleted' } }) },

    { method: 'GET',  pattern: /\/api\/classes$/, respond: () => ({ body: CLASSES }) },
    { method: 'GET',  pattern: /\/api\/classes\/active$/, respond: () => ({ body: CLASSES }) },
    { method: 'GET',  pattern: /\/api\/classes\/[^/]+\/enrollments$/, respond: () => ({ body: [] }) },
    { method: 'GET',  pattern: /\/api\/classes\/[^/]+$/, respond: () => ({ body: CLASSES[0] }) },
    { method: 'GET',  pattern: /\/api\/classes\/check-teacher-availability\/?.*/, respond: () => ({ body: { available: true } }) },
    { method: 'POST', pattern: /\/api\/classes$/, respond: (_, req) => ({ status: 201, body: { id: 'cls-new', ...(req.postDataJSON() as object) } }) },
    { method: 'PATCH', pattern: /\/api\/classes\/[^/]+$/, respond: () => ({ body: CLASSES[0] }) },
    { method: 'POST', pattern: /\/api\/classes\/[^/]+\/finish$/, respond: () => ({ body: { ...CLASSES[0], status: 'COMPLETED' } }) },
    { method: 'DELETE', pattern: /\/api\/classes\/[^/]+$/, respond: () => ({ body: { message: 'Deleted' } }) },

    // ─── Events ─────────────────────────────────────────────────────────
    { method: 'GET',  pattern: /\/api\/events$/, respond: () => ({ body: EVENTS }) },
    { method: 'GET',  pattern: /\/api\/events\/[^/]+\/subscriptions$/, respond: () => ({ body: [] }) },
    { method: 'GET',  pattern: /\/api\/events\/[^/]+\/expenses$/, respond: () => ({ body: [] }) },
    { method: 'GET',  pattern: /\/api\/events\/[^/]+\/refunds$/, respond: () => ({ body: [] }) },
    { method: 'GET',  pattern: /\/api\/events\/[^/]+$/, respond: () => ({ body: EVENTS[0] }) },
    { method: 'POST', pattern: /\/api\/events$/, respond: (_, req) => ({ status: 201, body: { id: 'ev-new', ...(req.postDataJSON() as object) } }) },
    { method: 'PATCH', pattern: /\/api\/events\/[^/]+$/, respond: () => ({ body: EVENTS[0] }) },
    { method: 'DELETE', pattern: /\/api\/events\/[^/]+$/, respond: () => ({ body: { message: 'Deleted' } }) },

    // ─── Enrollments ────────────────────────────────────────────────────
    { method: 'GET',  pattern: /\/api\/enrollments$/, respond: () => ({ body: [] }) },
    { method: 'POST', pattern: /\/api\/enrollments$/, respond: (_, req) => ({ status: 201, body: { id: 'en-new', ...(req.postDataJSON() as object) } }) },
    { method: 'GET',  pattern: /\/api\/master-enrollments$/, respond: () => ({ body: [] }) },
    { method: 'POST', pattern: /\/api\/master-enrollments$/, respond: (_, req) => ({ status: 201, body: { id: 'me-new', ...(req.postDataJSON() as object) } }) },
    { method: 'GET',  pattern: /\/api\/master-enrollments\/coverage-check/, respond: () => ({ body: { covered: false, conflicts: [] } }) },

    // ─── Employees ──────────────────────────────────────────────────────
    { method: 'GET',  pattern: /\/api\/employees$/, respond: () => ({ body: EMPLOYEES }) },
    { method: 'GET',  pattern: /\/api\/employees\/active$/, respond: () => ({ body: EMPLOYEES }) },
    { method: 'GET',  pattern: /\/api\/employees\/teachers$/, respond: () => ({ body: EMPLOYEES.filter(e => e.role === 'TEACHER') }) },
    { method: 'GET',  pattern: /\/api\/employees\/[^/]+$/, respond: () => ({ body: EMPLOYEES[0] }) },
    { method: 'POST', pattern: /\/api\/employees$/, respond: (_, req) => ({ status: 201, body: { id: 'e-new', ...(req.postDataJSON() as object) } }) },
    { method: 'PATCH', pattern: /\/api\/employees\/[^/]+$/, respond: () => ({ body: EMPLOYEES[0] }) },
    { method: 'DELETE', pattern: /\/api\/employees\/[^/]+$/, respond: () => ({ body: { message: 'Deleted' } }) },

    // ─── Users ──────────────────────────────────────────────────────────
    { method: 'GET',  pattern: /\/api\/users$/, respond: () => ({ body: Object.values(USERS) }) },
    { method: 'GET',  pattern: /\/api\/users\/[^/]+$/, respond: () => ({ body: USERS.admin }) },
    { method: 'POST', pattern: /\/api\/users$/, respond: (_, req) => ({ status: 201, body: { id: 'u-new', ...(req.postDataJSON() as object) } }) },
    { method: 'PATCH', pattern: /\/api\/users\/[^/]+$/, respond: () => ({ body: USERS.admin }) },
    { method: 'DELETE', pattern: /\/api\/users\/[^/]+$/, respond: () => ({ body: { message: 'Deleted' } }) },

    // ─── Revenues / Expenses / Refunds / Cash / Debts / Dues ───────────
    { method: 'GET',  pattern: /\/api\/revenues$/, respond: () => ({ body: REVENUES }) },
    { method: 'GET',  pattern: /\/api\/revenues\/[^/]+$/, respond: () => ({ body: REVENUES[0] }) },
    { method: 'POST', pattern: /\/api\/revenues$/, respond: (_, req) => ({ status: 201, body: { id: 'rev-new', ...(req.postDataJSON() as object) } }) },
    { method: 'PATCH', pattern: /\/api\/revenues\/[^/]+$/, respond: () => ({ body: REVENUES[0] }) },
    { method: 'DELETE', pattern: /\/api\/revenues\/[^/]+$/, respond: () => ({ body: { message: 'Deleted' } }) },

    { method: 'GET',  pattern: /\/api\/expenses$/, respond: () => ({ body: EXPENSES }) },
    { method: 'GET',  pattern: /\/api\/expenses\/[^/]+\/payments$/, respond: () => ({ body: [] }) },
    { method: 'GET',  pattern: /\/api\/expenses\/[^/]+$/, respond: () => ({ body: EXPENSES[0] }) },
    { method: 'POST', pattern: /\/api\/expenses$/, respond: (_, req) => ({ status: 201, body: { id: 'exp-new', ...(req.postDataJSON() as object) } }) },
    { method: 'PATCH', pattern: /\/api\/expenses\/[^/]+$/, respond: () => ({ body: EXPENSES[0] }) },
    { method: 'DELETE', pattern: /\/api\/expenses\/[^/]+$/, respond: () => ({ body: { message: 'Deleted' } }) },
    { method: 'POST', pattern: /\/api\/expense-payments$/, respond: (_, req) => ({ status: 201, body: { id: 'ep-new', ...(req.postDataJSON() as object) } }) },

    { method: 'GET',  pattern: /\/api\/refunds$/, respond: () => ({ body: [] }) },
    { method: 'GET',  pattern: /\/api\/refunds\/[^/]+$/, respond: () => ({ body: { id: 'rf-0001', amount: 100, reason: 'Test', date: '2025-05-01' } }) },

    { method: 'GET',  pattern: /\/api\/debts$/, respond: () => ({ body: [] }) },
    { method: 'GET',  pattern: /\/api\/dues\/?.*/, respond: () => ({ body: [] }) },

    { method: 'GET',  pattern: /\/api\/cash\/?.*/, respond: () => ({ body: { balance: 0, ledger: [] } }) },
    { method: 'GET',  pattern: /\/api\/withdrawals$/, respond: () => ({ body: [] }) },

    // ─── Products / Product Sales ───────────────────────────────────────
    { method: 'GET',  pattern: /\/api\/products$/, respond: () => ({ body: PRODUCTS }) },
    { method: 'GET',  pattern: /\/api\/products\/[^/]+$/, respond: () => ({ body: PRODUCTS[0] }) },
    { method: 'POST', pattern: /\/api\/products$/, respond: (_, req) => ({ status: 201, body: { id: 'p-new', ...(req.postDataJSON() as object) } }) },
    { method: 'PATCH', pattern: /\/api\/products\/[^/]+$/, respond: () => ({ body: PRODUCTS[0] }) },
    { method: 'DELETE', pattern: /\/api\/products\/[^/]+$/, respond: () => ({ body: { message: 'Deleted' } }) },
    { method: 'GET',  pattern: /\/api\/product-sales$/, respond: () => ({ body: [] }) },
    { method: 'POST', pattern: /\/api\/product-sales$/, respond: (_, req) => ({ status: 201, body: { id: 'ps-new', ...(req.postDataJSON() as object) } }) },

    // ─── Rooms / Sessions / Timetable / Attendance ─────────────────────
    { method: 'GET',  pattern: /\/api\/rooms$/, respond: () => ({ body: ROOMS }) },
    { method: 'POST', pattern: /\/api\/rooms$/, respond: (_, req) => ({ status: 201, body: { id: 'r-new', ...(req.postDataJSON() as object) } }) },
    { method: 'GET',  pattern: /\/api\/sessions$/, respond: () => ({ body: [] }) },
    { method: 'GET',  pattern: /\/api\/sessions\/active$/, respond: () => ({ body: [] }) },
    { method: 'GET',  pattern: /\/api\/timetable\/.*/, respond: () => ({ body: { day: 'monday', slots: [] } }) },
    { method: 'GET',  pattern: /\/api\/attendance\/.*/, respond: () => ({ body: [] }) },

    // ─── Reports / Analytics / Dashboard ───────────────────────────────
    { method: 'GET',  pattern: /\/api\/analytics\/dashboard/, respond: () => ({ body: DASHBOARD_STATS }) },
    { method: 'GET',  pattern: /\/api\/reports\/?.*/, respond: () => ({ body: { rows: [], totals: {} } }) },
  ];
}
