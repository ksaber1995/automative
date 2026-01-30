export const API_BASE_URL = '/api';

export const API_ENDPOINTS = {
  // Auth endpoints
  AUTH: {
    LOGIN: `${API_BASE_URL}/auth/login`,
    REGISTER: `${API_BASE_URL}/auth/register`,
    LOGOUT: `${API_BASE_URL}/auth/logout`,
    REFRESH: `${API_BASE_URL}/auth/refresh`,
    PROFILE: `${API_BASE_URL}/auth/profile`,
    CHANGE_PASSWORD: `${API_BASE_URL}/auth/change-password`,
  },

  // User endpoints
  USERS: {
    BASE: `${API_BASE_URL}/users`,
    BY_ID: (id: string) => `${API_BASE_URL}/users/${id}`,
  },

  // Branch endpoints
  BRANCHES: {
    BASE: `${API_BASE_URL}/branches`,
    BY_ID: (id: string) => `${API_BASE_URL}/branches/${id}`,
    STATS: (id: string) => `${API_BASE_URL}/branches/${id}/stats`,
    EMPLOYEES: (id: string) => `${API_BASE_URL}/branches/${id}/employees`,
    COURSES: (id: string) => `${API_BASE_URL}/branches/${id}/courses`,
    STUDENTS: (id: string) => `${API_BASE_URL}/branches/${id}/students`,
  },

  // Course endpoints
  COURSES: {
    BASE: `${API_BASE_URL}/courses`,
    BY_ID: (id: string) => `${API_BASE_URL}/courses/${id}`,
    BY_BRANCH: (branchId: string) => `${API_BASE_URL}/courses/branch/${branchId}`,
    ENROLLMENTS: (id: string) => `${API_BASE_URL}/courses/${id}/enrollments`,
  },

  // Student endpoints
  STUDENTS: {
    BASE: `${API_BASE_URL}/students`,
    BY_ID: (id: string) => `${API_BASE_URL}/students/${id}`,
    ENROLL: (id: string) => `${API_BASE_URL}/students/${id}/enroll`,
    ENROLLMENTS: (id: string) => `${API_BASE_URL}/students/${id}/enrollments`,
    ENROLLMENT_BY_ID: (studentId: string, enrollmentId: string) =>
      `${API_BASE_URL}/students/${studentId}/enrollments/${enrollmentId}`,
    BY_BRANCH: (branchId: string) => `${API_BASE_URL}/students/branch/${branchId}`,
  },

  // Employee endpoints
  EMPLOYEES: {
    BASE: `${API_BASE_URL}/employees`,
    BY_ID: (id: string) => `${API_BASE_URL}/employees/${id}`,
    BY_BRANCH: (branchId: string) => `${API_BASE_URL}/employees/branch/${branchId}`,
    GLOBAL: `${API_BASE_URL}/employees/global`,
  },

  // Revenue endpoints
  REVENUES: {
    BASE: `${API_BASE_URL}/revenues`,
    BY_ID: (id: string) => `${API_BASE_URL}/revenues/${id}`,
    BY_BRANCH: (branchId: string) => `${API_BASE_URL}/revenues/branch/${branchId}`,
    SUMMARY: `${API_BASE_URL}/revenues/summary`,
  },

  // Expense endpoints
  EXPENSES: {
    BASE: `${API_BASE_URL}/expenses`,
    BY_ID: (id: string) => `${API_BASE_URL}/expenses/${id}`,
    BY_BRANCH: (branchId: string) => `${API_BASE_URL}/expenses/branch/${branchId}`,
    BY_TYPE: (type: string) => `${API_BASE_URL}/expenses/type/${type}`,
    RECURRING: `${API_BASE_URL}/expenses/recurring`,
    AUTO_GENERATE: `${API_BASE_URL}/expenses/auto-generate`,
  },

  // Analytics endpoints
  ANALYTICS: {
    DASHBOARD: `${API_BASE_URL}/analytics/dashboard`,
    BRANCH: (branchId: string) => `${API_BASE_URL}/analytics/branch/${branchId}`,
    REVENUE_TRENDS: `${API_BASE_URL}/analytics/revenue-trends`,
    EXPENSE_BREAKDOWN: `${API_BASE_URL}/analytics/expense-breakdown`,
    PROFIT_LOSS: `${API_BASE_URL}/analytics/profit-loss`,
    COMPARISON: `${API_BASE_URL}/analytics/comparison`,
  },

  // Report endpoints
  REPORTS: {
    GENERATE: `${API_BASE_URL}/reports/generate`,
    DOWNLOAD: (id: string) => `${API_BASE_URL}/reports/${id}/download`,
    EXCEL_FINANCIAL: `${API_BASE_URL}/reports/excel/financial`,
    PDF_FINANCIAL: `${API_BASE_URL}/reports/pdf/financial`,
    EXCEL_BRANCH: (branchId: string) => `${API_BASE_URL}/reports/excel/branch/${branchId}`,
    PDF_BRANCH: (branchId: string) => `${API_BASE_URL}/reports/pdf/branch/${branchId}`,
    EXCEL_STUDENTS: `${API_BASE_URL}/reports/excel/students`,
    EXCEL_REVENUES: `${API_BASE_URL}/reports/excel/revenues`,
    EXCEL_EXPENSES: `${API_BASE_URL}/reports/excel/expenses`,
  },
};
