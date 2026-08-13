import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyResultV2,
  Context
} from 'aws-lambda';
import { createLambdaHandler } from '@ts-rest/serverless/aws';
import { RequestValidationError, TsRestResponse } from '@ts-rest/serverless';

type ApiGatewayEvent = APIGatewayProxyEvent | APIGatewayProxyEventV2;
type ApiGatewayResponse = APIGatewayProxyResult | APIGatewayProxyResultV2;
import { contract } from './contract';
import { runWithRequestContext } from './utils/request-context';
import { authRoutes } from './routes/auth';
import { studentsRoutes } from './routes/students';
import { branchesRoutes } from './routes/branches';
import { coursesRoutes } from './routes/courses';
import { levelsRoutes } from './routes/levels';
import { schoolLevelsRoutes } from './routes/school-levels';
import { schoolSubjectsRoutes } from './routes/school-subjects';
import { schoolSemestersRoutes } from './routes/school-semesters';
import { subjectsRoutes } from './routes/subjects';
import { masterCoursesRoutes } from './routes/master-courses';
import { masterEnrollmentsRoutes } from './routes/master-enrollments';
import { masterClassEnrollmentsRoutes } from './routes/master-class-enrollments';
import { eventsRoutes } from './routes/events';
import { eventSubscriptionsRoutes } from './routes/event-subscriptions';
import { examsRoutes } from './routes/exams';
import { classesRoutes } from './routes/classes';
import { revenuesRoutes } from './routes/revenues';
import { expensesRoutes } from './routes/expenses';
import { crmRoutes } from './routes/crm';
import { qrCardsRoutes } from './routes/qr-cards';
import { waCloudRoutes } from './routes/wa-cloud';
import { expensePaymentsRoutes } from './routes/expense-payments';
import { installmentsRoutes } from './routes/installments';
import { analyticsRoutes } from './routes/analytics';
import { employeesRoutes } from './routes/employees';
import { withdrawalsRoutes } from './routes/withdrawals';
import { productsRoutes } from './routes/products';
import { productSalesRoutes } from './routes/product-sales';
import { courseProductsRoutes } from './routes/course-products';
import { educationalBooksRoutes } from './routes/educational-books';
import { debtsRoutes } from './routes/debts';
import { cashRoutes } from './routes/cash';
import { reportsRoutes } from './routes/reports';
import { enrollmentsRoutes } from './routes/enrollments';
import { subscriptionsRoutes } from './routes/subscriptions';
import { migrationsRoutes } from './routes/migrations';
import { adminSecretRoutes } from './routes/admin-secret';
import { companiesRoutes } from './routes/companies';
import { debugRoutes } from './routes/debug';
import { usersRoutes } from './routes/users';
import { demoLeadsRoutes } from './routes/demo-leads';
import { publicStudentsRoutes } from './routes/public-students';
import { receiptsRoutes } from './routes/receipts';
import { roomsRoutes } from './routes/rooms';
import { sessionsRoutes } from './routes/sessions';
import { attendanceRoutes } from './routes/attendance';
import { timetableRoutes } from './routes/timetable';
import { monthlySubscriptionsRoutes } from './routes/monthly-subscriptions';
import { sessionPaymentsRoutes } from './routes/session-payments';
import { whatsappTemplatesRoutes } from './routes/whatsappTemplates';
import { telegramRoutes } from './routes/telegram';
import { lookupsRoutes } from './routes/lookups';

// Create the router implementation
const router = {
  auth: {
    login: authRoutes.login,
    register: authRoutes.register,
    verifyEmail: authRoutes.verifyEmail,
    resendEmailOtp: authRoutes.resendEmailOtp,
    forgotPassword: authRoutes.forgotPassword,
    resetPassword: authRoutes.resetPassword,
    profile: authRoutes.profile,
  },
  // `similar` is declared first inside studentsRoutes AND above `getById` in the
  // contract — the static `/students/similar` has to be registered before
  // `/students/:id` or it is captured as an id and rejected as an invalid uuid
  // (same trap as sessions' `/next-number`, see the note further down).
  students: studentsRoutes,
  branches: branchesRoutes,
  courses: coursesRoutes,
  levels: levelsRoutes,
  schoolLevels: schoolLevelsRoutes,
  schoolSubjects: schoolSubjectsRoutes,
  schoolSemesters: schoolSemestersRoutes,
  subjects: subjectsRoutes,
  masterCourses: { ...masterCoursesRoutes, listEnrollments: masterEnrollmentsRoutes.listByMaster },
  // Route order matters — specific paths first, before `/:id`.
  masterEnrollments: {
    coverageCheck: masterEnrollmentsRoutes.coverageCheck,
    listByStudent: masterEnrollmentsRoutes.listByStudent,
    list: masterEnrollmentsRoutes.list,
    create: masterEnrollmentsRoutes.create,
    getPayments: masterEnrollmentsRoutes.getPayments,
    addPayment: masterEnrollmentsRoutes.addPayment,
    cancel: masterEnrollmentsRoutes.cancel,
    createRefund: masterEnrollmentsRoutes.createRefund,
    listRefunds: masterEnrollmentsRoutes.listRefunds,
    getById: masterEnrollmentsRoutes.getById,
  },
  masterClassEnrollments: masterClassEnrollmentsRoutes,
  events: {
    ...eventsRoutes,
    listSubscriptions: eventSubscriptionsRoutes.listByEvent,
    createSubscription: eventSubscriptionsRoutes.create,
    deleteSubscription: eventSubscriptionsRoutes.remove,
    listExpenses: eventSubscriptionsRoutes.listExpenses,
    listRefunds: eventSubscriptionsRoutes.listRefunds,
    createRefund: eventSubscriptionsRoutes.createRefund,
  },
  // Order matters — itty-router matches in registration order, so the static
  // `/student/:studentId` and `/:id/results*` paths are listed before `/:id`.
  exams: {
    create: examsRoutes.create,
    list: examsRoutes.list,
    getByStudent: examsRoutes.getByStudent,
    results: examsRoutes.results,
    recordByQr: examsRoutes.recordByQr,
    recordByCode: examsRoutes.recordByCode,
    saveResult: examsRoutes.saveResult,
    deleteResult: examsRoutes.deleteResult,
    markAbsent: examsRoutes.markAbsent,
    markRemainingAbsent: examsRoutes.markRemainingAbsent,
    sendTelegramResults: examsRoutes.sendTelegramResults,
    getById: examsRoutes.getById,
    update: examsRoutes.update,
    delete: examsRoutes.delete,
  },
  classes: {
    create: classesRoutes.create,
    assignRoom: classesRoutes.assignRoom,
    list: classesRoutes.list,
    listActive: classesRoutes.listActive,
    checkTeacherAvailability: classesRoutes.checkTeacherAvailability,
    getEnrollments: classesRoutes.getEnrollments,
    finish: classesRoutes.finish,
    getById: classesRoutes.getById,
    update: classesRoutes.update,
    delete: classesRoutes.delete,
  },
  enrollments: enrollmentsRoutes,
  revenues: revenuesRoutes,
  // Its static paths are declared before `/:id` inside expensesRoutes — see the
  // note there. Registration follows that object's key order.
  expenses: expensesRoutes,
  crm: crmRoutes,
  qrCards: qrCardsRoutes,
  waCloud: waCloudRoutes,
  expensePayments: expensePaymentsRoutes,
  installments: installmentsRoutes,
  analytics: analyticsRoutes,
  companies: companiesRoutes,
  employees: employeesRoutes,
  withdrawals: withdrawalsRoutes,
  products: productsRoutes,
  productSales: productSalesRoutes,
  courseProducts: courseProductsRoutes,
  educationalBooks: educationalBooksRoutes,
  debts: debtsRoutes,
  cash: cashRoutes,
  reports: reportsRoutes,
  debug: debugRoutes,
  subscriptions: subscriptionsRoutes,
  adminSecret: adminSecretRoutes,
  migrations: migrationsRoutes,
  users: usersRoutes,
  demoLeads: demoLeadsRoutes,
  publicStudents: publicStudentsRoutes,
  receipts: receiptsRoutes,
  rooms: roomsRoutes,
  attendance: attendanceRoutes,
  sessions: {
    start: sessionsRoutes.start,
    prepare: sessionsRoutes.prepare,
    autoSchedule: sessionsRoutes.autoSchedule,
    end: sessionsRoutes.end,
    cancel: sessionsRoutes.cancel,
    remove: sessionsRoutes.remove,
    list: sessionsRoutes.list,
    listActive: sessionsRoutes.listActive,
    // NOTE: itty-router (used by @ts-rest/serverless) matches in registration
    // order with no static-over-param precedence. The static `/next-number`
    // route MUST be registered before the `/:id` route, or `next-number` is
    // captured as `:id` and fails "id: Invalid uuid".
    nextNumber: sessionsRoutes.nextNumber,
    freeSummary: sessionsRoutes.freeSummary,
    activeForStudent: sessionsRoutes.activeForStudent,
    checkinTarget: sessionsRoutes.checkinTarget,
    getById: sessionsRoutes.getById,
    update: sessionsRoutes.update,
  },
  whatsappTemplates: {
    getTemplates: whatsappTemplatesRoutes.getTemplates,
    updateTemplates: whatsappTemplatesRoutes.updateTemplates,
  },
  telegram: {
    // Static paths before param paths (itty-router matches in registration order).
    getSettings: telegramRoutes.getSettings,
    updateSettings: telegramRoutes.updateSettings,
    updateTemplates: telegramRoutes.updateTemplates,
    setBot: telegramRoutes.setBot,
    enableWithPooledBot: telegramRoutes.enableWithPooledBot,
    disconnectBot: telegramRoutes.disconnectBot,
    getStudentLink: telegramRoutes.getStudentLink,
    getStaffLink: telegramRoutes.getStaffLink,
    webhook: telegramRoutes.webhook,
  },
  timetable: {
    getDay: timetableRoutes.getDay,
  },
  monthlySubscriptions: {
    generate: monthlySubscriptionsRoutes.generate,
    list: monthlySubscriptionsRoutes.list,
    listHeld: monthlySubscriptionsRoutes.listHeld,
    summary: monthlySubscriptionsRoutes.summary,
    recordPayment: monthlySubscriptionsRoutes.recordPayment,
    collect: monthlySubscriptionsRoutes.collect,
    voidPayment: monthlySubscriptionsRoutes.voidPayment,
    refund: monthlySubscriptionsRoutes.refund,
    listByCourse: monthlySubscriptionsRoutes.listByCourse,
    // Before listByStudent, matching the contract: these carry an extra path
    // segment, and this router registers in declaration order.
    unpaidForStudent: monthlySubscriptionsRoutes.unpaidForStudent,
    clearUnpaidForStudent: monthlySubscriptionsRoutes.clearUnpaidForStudent,
    listByStudent: monthlySubscriptionsRoutes.listByStudent,
    byToken: monthlySubscriptionsRoutes.byToken,
    setPriceOverride: monthlySubscriptionsRoutes.setPriceOverride,
    getPriceOverride: monthlySubscriptionsRoutes.getPriceOverride,
    deletePriceOverride: monthlySubscriptionsRoutes.deletePriceOverride,
    listPriceOverrides: monthlySubscriptionsRoutes.listPriceOverrides,
  },
  sessionPayments: {
    list: sessionPaymentsRoutes.list,
    summary: sessionPaymentsRoutes.summary,
    overdue: sessionPaymentsRoutes.overdue,
    // Registered ahead of the `/:id/...` routes below — itty-router matches in
    // order with no static-over-param precedence (see the sessions block).
    payPerSession: sessionPaymentsRoutes.payPerSession,
    recordPayment: sessionPaymentsRoutes.recordPayment,
    voidPayment: sessionPaymentsRoutes.voidPayment,
    refund: sessionPaymentsRoutes.refund,
    buyPackage: sessionPaymentsRoutes.buyPackage,
    payPackage: sessionPaymentsRoutes.payPackage,
    refundPackage: sessionPaymentsRoutes.refundPackage,
    renewalsDue: sessionPaymentsRoutes.renewalsDue,
    listPackages: sessionPaymentsRoutes.listPackages,
    listByCourse: sessionPaymentsRoutes.listByCourse,
    listByStudent: sessionPaymentsRoutes.listByStudent,
    byToken: sessionPaymentsRoutes.byToken,
  },
  lookups: {
    branches: lookupsRoutes.branches,
    employees: lookupsRoutes.employees,
    courses: lookupsRoutes.courses,
    classes: lookupsRoutes.classes,
    levels: lookupsRoutes.levels,
    subjects: lookupsRoutes.subjects,
    rooms: lookupsRoutes.rooms,
    masterCourses: lookupsRoutes.masterCourses,
    students: lookupsRoutes.students,
    products: lookupsRoutes.products,
  },
};

// Allowed CORS origins — keep in sync with CDK defaultCorsPreflightOptions.
const ALLOWED_ORIGINS = [
  'https://app.netrofit.com',   // prod frontend
  'https://dev.netrofit.com',   // dev frontend
  'http://localhost:4200',      // local Angular dev server
  'http://localhost:4300',      // local admin console
  'http://localhost:4800',      // local cards report (cards/)
];

function getAllowedOrigin(requestOrigin: string | null | undefined): string | null {
  if (!requestOrigin) return null;
  return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : null;
}

// Create the Lambda handler
// @ts-expect-error - Type mismatch with ts-rest router implementation
const lambdaHandler = createLambdaHandler(contract, router, {
  // ts-rest's default body-validation failure returns `{ message: 'Request
  // validation failed', bodyErrors: { issues: [...] } }` with no `code`, so the
  // frontend interceptor falls through to showing that raw English text. Wrap
  // it in our standard `{ code, message }` shape with a translatable code and
  // a human-readable summary of the first Zod issue (so the user sees e.g.
  // "email: Invalid email" instead of "Request validation failed").
  errorHandler: (err) => {
    if (err instanceof RequestValidationError) {
      const firstIssue =
        err.bodyError?.issues?.[0] ||
        err.queryError?.issues?.[0] ||
        err.pathParamsError?.issues?.[0] ||
        err.headersError?.issues?.[0];
      if (firstIssue) {
        const field =
          firstIssue.path && firstIssue.path.length > 0
            ? firstIssue.path.join('.')
            : undefined;
        const message = field
          ? `${field}: ${firstIssue.message}`
          : firstIssue.message;
        return TsRestResponse.fromJson({ message }, { status: 400 });
      }
      return TsRestResponse.fromJson(
        { code: 'ERRORS.VALIDATION_FAILED', message: 'Request validation failed' },
        { status: 400 }
      );
    }
    return undefined;
  },
  responseHandlers: [
    // Meta verifies a webhook by GETting it with a `hub.challenge` and comparing
    // the response body to that value byte for byte. The route declares a string
    // response, which ts-rest serialises as JSON — so the body goes out as
    // `"1234"`, quotes included, and Meta rejects the subscription with no
    // useful explanation. Re-emit it as text/plain. Only on 200: the 403 body is
    // never read, and every other route wants its JSON.
    (response, request) => {
      if (request.method !== 'GET' || response.status !== 200) return;
      const url = new URL(request.url);
      if (url.pathname !== '/api/public/wa/webhook') return;
      return TsRestResponse.fromText(url.searchParams.get('hub.challenge') ?? '', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    },
    (response, request) => {
      const origin = getAllowedOrigin(request.headers.get('origin'));
      if (origin) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Credentials', 'true');
        response.headers.set('Vary', 'Origin');
      }
    },
  ],
});

/**
 * Best-effort client IP extraction. API Gateway forwards the original client
 * IP either in `x-forwarded-for` (comma-separated; first hop is the client)
 * or in `event.requestContext.identity.sourceIp` (REST v1) /
 * `event.requestContext.http.sourceIp` (HTTP v2). Returns `null` only when
 * none of those fields are populated, which should be vanishingly rare in
 * practice but we tolerate it gracefully (the rate limiter no-ops on null).
 */
function extractClientIp(event: ApiGatewayEvent): string | null {
  const headers = event.headers || {};
  const xff = headers['x-forwarded-for'] ?? headers['X-Forwarded-For'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  if ('rawPath' in event) {
    return event.requestContext?.http?.sourceIp ?? null;
  }
  return (event as APIGatewayProxyEvent).requestContext?.identity?.sourceIp ?? null;
}

export const handler = async (
  event: ApiGatewayEvent,
  context: Context
): Promise<ApiGatewayResponse> => {
  // Log the incoming request
  const isV2 = 'rawPath' in event;
  console.log('Incoming request:', {
    path: isV2 ? event.rawPath : event.path,
    method: isV2 ? event.requestContext.http.method : event.httpMethod,
    headers: event.headers,
  });

  const ip = extractClientIp(event);

  try {
    return await runWithRequestContext({ ip }, () => lambdaHandler(event, context));
  } catch (error) {
    console.error('Handler error:', error);
    const reqOrigin = (event.headers?.['origin'] ?? event.headers?.['Origin']) as string | undefined;
    const origin = getAllowedOrigin(reqOrigin);
    const corsHeaders: Record<string, string> = origin
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' }
      : {};
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
      body: JSON.stringify({
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
