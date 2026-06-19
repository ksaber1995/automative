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
import { masterCoursesRoutes } from './routes/master-courses';
import { masterEnrollmentsRoutes } from './routes/master-enrollments';
import { masterClassEnrollmentsRoutes } from './routes/master-class-enrollments';
import { eventsRoutes } from './routes/events';
import { eventSubscriptionsRoutes } from './routes/event-subscriptions';
import { examsRoutes } from './routes/exams';
import { classesRoutes } from './routes/classes';
import { revenuesRoutes } from './routes/revenues';
import { expensesRoutes } from './routes/expenses';
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
import { roomsRoutes } from './routes/rooms';
import { sessionsRoutes } from './routes/sessions';
import { attendanceRoutes } from './routes/attendance';
import { timetableRoutes } from './routes/timetable';
import { monthlySubscriptionsRoutes } from './routes/monthly-subscriptions';

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
  students: studentsRoutes,
  branches: branchesRoutes,
  courses: coursesRoutes,
  levels: levelsRoutes,
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
    saveResult: examsRoutes.saveResult,
    deleteResult: examsRoutes.deleteResult,
    getById: examsRoutes.getById,
    update: examsRoutes.update,
    delete: examsRoutes.delete,
  },
  classes: {
    create: classesRoutes.create,
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
  expenses: expensesRoutes,
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
  rooms: roomsRoutes,
  attendance: attendanceRoutes,
  sessions: {
    start: sessionsRoutes.start,
    prepare: sessionsRoutes.prepare,
    end: sessionsRoutes.end,
    list: sessionsRoutes.list,
    listActive: sessionsRoutes.listActive,
    // NOTE: itty-router (used by @ts-rest/serverless) matches in registration
    // order with no static-over-param precedence. The static `/next-number`
    // route MUST be registered before the `/:id` route, or `next-number` is
    // captured as `:id` and fails "id: Invalid uuid".
    nextNumber: sessionsRoutes.nextNumber,
    getById: sessionsRoutes.getById,
    update: sessionsRoutes.update,
  },
  timetable: {
    getDay: timetableRoutes.getDay,
  },
  monthlySubscriptions: {
    generate: monthlySubscriptionsRoutes.generate,
    list: monthlySubscriptionsRoutes.list,
    summary: monthlySubscriptionsRoutes.summary,
    recordPayment: monthlySubscriptionsRoutes.recordPayment,
    voidPayment: monthlySubscriptionsRoutes.voidPayment,
    listByCourse: monthlySubscriptionsRoutes.listByCourse,
    listByStudent: monthlySubscriptionsRoutes.listByStudent,
    byToken: monthlySubscriptionsRoutes.byToken,
    setPriceOverride: monthlySubscriptionsRoutes.setPriceOverride,
    getPriceOverride: monthlySubscriptionsRoutes.getPriceOverride,
    deletePriceOverride: monthlySubscriptionsRoutes.deletePriceOverride,
  },
};

// Create the Lambda handler
// @ts-expect-error - Type mismatch with ts-rest router implementation
// Echo the request Origin back rather than using '*'. The previous '*' +
// 'Allow-Credentials: true' combo is invalid per CORS spec — browsers reject
// the response whenever the request runs in credentials mode 'include'.
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
        // The field+message tells the user exactly what's wrong (e.g.
        // "email: Invalid email"). Omit `code` so the frontend interceptor
        // uses this specific message instead of a generic translated string.
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
    (response, request, args) => {
      const origin = request.headers.get('origin');
      if (origin) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Vary', 'Origin');
      } else {
        response.headers.set('Access-Control-Allow-Origin', '*');
      }
      response.headers.set('Access-Control-Allow-Credentials', 'true');
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
    const reqOrigin =
      (event.headers?.['origin'] ?? event.headers?.['Origin']) as string | undefined;
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': reqOrigin || '*',
        'Access-Control-Allow-Credentials': 'true',
        ...(reqOrigin ? { Vary: 'Origin' } : {}),
      },
      body: JSON.stringify({
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
