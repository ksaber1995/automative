import {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  APIGatewayProxyResultV2,
  Context
} from 'aws-lambda';
import { createLambdaHandler } from '@ts-rest/serverless/aws';

type ApiGatewayEvent = APIGatewayProxyEvent | APIGatewayProxyEventV2;
type ApiGatewayResponse = APIGatewayProxyResult | APIGatewayProxyResultV2;
import { contract } from './contract';
import { authRoutes } from './routes/auth';
import { studentsRoutes } from './routes/students';
import { branchesRoutes } from './routes/branches';
import { coursesRoutes } from './routes/courses';
import { revenuesRoutes } from './routes/revenues';
import { expensesRoutes } from './routes/expenses';
import { analyticsRoutes } from './routes/analytics';
import { employeesRoutes } from './routes/employees';
import { withdrawalsRoutes } from './routes/withdrawals';
import { productsRoutes } from './routes/products';
import { productSalesRoutes } from './routes/product-sales';
import { debtsRoutes } from './routes/debts';
import { cashRoutes } from './routes/cash';
import { reportsRoutes } from './routes/reports';

// Create the router implementation
const router = {
  auth: authRoutes,
  students: studentsRoutes,
  branches: branchesRoutes,
  courses: coursesRoutes,
  revenues: revenuesRoutes,
  expenses: expensesRoutes,
  analytics: analyticsRoutes,
  employees: employeesRoutes,
  withdrawals: withdrawalsRoutes,
  products: productsRoutes,
  productSales: productSalesRoutes,
  debts: debtsRoutes,
  cash: cashRoutes,
  reports: reportsRoutes,
};

// Create the Lambda handler
const lambdaHandler = createLambdaHandler(contract, router, {
  responseHandlers: [
    (response, request, args) => {
      // Add CORS headers to all responses
      response.headers.set('Access-Control-Allow-Origin', '*');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');
      response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    },
  ],
});

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

  try {
    const result = await lambdaHandler(event, context);
    return result;
  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
