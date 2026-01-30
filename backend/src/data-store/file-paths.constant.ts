import { join } from 'path';

const DATA_DIR = process.env.DATA_PATH || join(__dirname, '..', '..', '..', 'data');

export const FILE_PATHS = {
  USERS: join(DATA_DIR, 'users.json'),
  BRANCHES: join(DATA_DIR, 'branches.json'),
  COURSES: join(DATA_DIR, 'courses.json'),
  STUDENTS: join(DATA_DIR, 'students.json'),
  ENROLLMENTS: join(DATA_DIR, 'enrollments.json'),
  EMPLOYEES: join(DATA_DIR, 'employees.json'),
  REVENUES: join(DATA_DIR, 'revenues.json'),
  EXPENSES: join(DATA_DIR, 'expenses.json'),
};

export const DATA_KEYS = {
  USERS: 'users',
  BRANCHES: 'branches',
  COURSES: 'courses',
  STUDENTS: 'students',
  ENROLLMENTS: 'enrollments',
  EMPLOYEES: 'employees',
  REVENUES: 'revenues',
  EXPENSES: 'expenses',
};
