import { join, resolve } from 'path';

// Use absolute path
const DATA_DIR = process.env.DATA_PATH || 'D:/work/automate-magic/data';

export const FILE_PATHS = {
  USERS: join(DATA_DIR, 'users.json'),
  BRANCHES: join(DATA_DIR, 'branches.json'),
  COURSES: join(DATA_DIR, 'courses.json'),
  CLASSES: join(DATA_DIR, 'classes.json'),
  STUDENTS: join(DATA_DIR, 'students.json'),
  ENROLLMENTS: join(DATA_DIR, 'enrollments.json'),
  EMPLOYEES: join(DATA_DIR, 'employees.json'),
  REVENUES: join(DATA_DIR, 'revenues.json'),
  EXPENSES: join(DATA_DIR, 'expenses.json'),
  CASH_STATE: join(DATA_DIR, 'cash-state.json'),
  WITHDRAWALS: join(DATA_DIR, 'withdrawals.json'),
  DEBTS: join(DATA_DIR, 'debts.json'),
  DEBT_PAYMENTS: join(DATA_DIR, 'debt-payments.json'),
  PRODUCTS: join(DATA_DIR, 'products.json'),
  PRODUCT_SALES: join(DATA_DIR, 'product-sales.json'),
};

export const DATA_KEYS = {
  USERS: 'users',
  BRANCHES: 'branches',
  COURSES: 'courses',
  CLASSES: 'classes',
  STUDENTS: 'students',
  ENROLLMENTS: 'enrollments',
  EMPLOYEES: 'employees',
  REVENUES: 'revenues',
  EXPENSES: 'expenses',
  CASH_STATE: 'cashState',
  WITHDRAWALS: 'withdrawals',
  DEBTS: 'debts',
  DEBT_PAYMENTS: 'debtPayments',
  PRODUCTS: 'products',
  PRODUCT_SALES: 'productSales',
};
