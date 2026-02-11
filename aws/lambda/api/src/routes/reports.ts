import ExcelJS from 'exceljs';
import { query } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

interface FinancialData {
  enrollments: any[];
  expenses: any[];
  productSales: any[];
  withdrawals: any[];
  branches: any[];
}

async function fetchFinancialData(
  companyId: string,
  startDate: string,
  endDate: string,
  branchId?: string
): Promise<FinancialData> {
  let whereClause = '';
  let params: any[] = [companyId, startDate, endDate];

  if (branchId) {
    params.push(branchId);
    whereClause = ` AND e.branch_id = $4`;
  }

  // Fetch enrollments (revenues from enrollments)
  const enrollments = await query(
    `SELECT e.*, b.name as branch_name, b.code as branch_code,
            s.first_name || ' ' || s.last_name as student_name,
            c.name as course_name
     FROM enrollments e
     LEFT JOIN branches b ON e.branch_id = b.id
     LEFT JOIN students s ON e.student_id = s.id
     LEFT JOIN courses c ON e.course_id = c.id
     WHERE e.company_id = $1 AND e.payment_status IN ('PAID', 'PARTIAL')
       AND e.enrollment_date >= $2 AND e.enrollment_date <= $3${whereClause}
     ORDER BY e.enrollment_date DESC`,
    params
  );

  // Fetch expenses
  const expenseParams = branchId ? [companyId, startDate, endDate, branchId] : [companyId, startDate, endDate];
  const expenseWhereClause = branchId ? ` AND e.branch_id = $4` : '';

  const expenses = await query(
    `SELECT e.*, b.name as branch_name, b.code as branch_code
     FROM expenses e
     LEFT JOIN branches b ON e.branch_id = b.id
     WHERE e.company_id = $1 AND e.date >= $2 AND e.date <= $3${expenseWhereClause}
     ORDER BY e.date DESC`,
    expenseParams
  );

  // Fetch product sales
  const productSalesParams = branchId ? [companyId, startDate, endDate, branchId] : [companyId, startDate, endDate];
  const productSalesWhereClause = branchId ? ` AND ps.branch_id = $4` : '';

  const productSales = await query(
    `SELECT ps.*, p.name as product_name, p.code as product_code,
            b.name as branch_name, b.code as branch_code
     FROM product_sales ps
     LEFT JOIN products p ON ps.product_id = p.id
     LEFT JOIN branches b ON ps.branch_id = b.id
     WHERE ps.company_id = $1 AND ps.sale_date >= $2 AND ps.sale_date <= $3${productSalesWhereClause}
     ORDER BY ps.sale_date DESC`,
    productSalesParams
  );

  // Fetch withdrawals (active only)
  const withdrawalsParams = branchId ? [companyId, startDate, endDate, branchId] : [companyId, startDate, endDate];
  const withdrawalsWhereClause = branchId ? ` AND w.branch_id = $4` : '';

  const withdrawals = await query(
    `SELECT w.*, b.name as branch_name, b.code as branch_code
     FROM withdrawals w
     LEFT JOIN branches b ON w.branch_id = b.id
     WHERE w.company_id = $1 AND w.withdrawal_date >= $2 AND w.withdrawal_date <= $3
       AND w.is_active = true${withdrawalsWhereClause}
     ORDER BY w.withdrawal_date DESC`,
    withdrawalsParams
  );

  // Fetch branches for summary
  const branches = branchId
    ? await query(`SELECT * FROM branches WHERE id = $1 AND company_id = $2`, [branchId, companyId])
    : await query(`SELECT * FROM branches WHERE company_id = $1 AND is_active = true ORDER BY name`, [companyId]);

  return { enrollments, expenses, productSales, withdrawals, branches };
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatDate(date: string): string {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US');
}

async function generateFinancialExcel(
  data: FinancialData,
  startDate: string,
  endDate: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Summary Sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Amount', key: 'amount', width: 20 },
  ];

  const totalRevenue = data.enrollments.reduce((sum, e) => sum + parseFloat(e.final_price || 0), 0);
  const totalExpenses = data.expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
  const totalProductSales = data.productSales.reduce((sum, ps) => sum + parseFloat(ps.total_amount || 0), 0);
  const totalWithdrawals = data.withdrawals.reduce((sum, w) => sum + parseFloat(w.amount || 0), 0);
  const netProfit = totalRevenue + totalProductSales - totalExpenses - totalWithdrawals;

  summarySheet.addRows([
    { metric: 'Period', amount: `${formatDate(startDate)} to ${formatDate(endDate)}` },
    { metric: '', amount: '' },
    { metric: 'Total Course Revenue', amount: formatCurrency(totalRevenue) },
    { metric: 'Total Product Sales', amount: formatCurrency(totalProductSales) },
    { metric: 'Total Income', amount: formatCurrency(totalRevenue + totalProductSales) },
    { metric: '', amount: '' },
    { metric: 'Total Expenses', amount: formatCurrency(totalExpenses) },
    { metric: 'Total Withdrawals', amount: formatCurrency(totalWithdrawals) },
    { metric: 'Total Outflow', amount: formatCurrency(totalExpenses + totalWithdrawals) },
    { metric: '', amount: '' },
    { metric: 'Net Profit', amount: formatCurrency(netProfit) },
  ]);

  // Style summary sheet
  summarySheet.getRow(1).font = { bold: true, size: 12 };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  const netProfitRow = summarySheet.getRow(12);
  netProfitRow.font = { bold: true, size: 12 };
  netProfitRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: netProfit >= 0 ? 'FF70AD47' : 'FFE74C3C' },
  };

  // Enrollments Revenue Sheet
  const revenuesSheet = workbook.addWorksheet('Enrollment Revenue');
  revenuesSheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Branch', key: 'branch', width: 20 },
    { header: 'Student', key: 'student', width: 25 },
    { header: 'Course', key: 'course', width: 25 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Payment Status', key: 'paymentStatus', width: 18 },
  ];

  data.enrollments.forEach((enr) => {
    revenuesSheet.addRow({
      date: formatDate(enr.enrollment_date),
      branch: enr.branch_name || 'N/A',
      student: enr.student_name || 'N/A',
      course: enr.course_name || 'N/A',
      amount: formatCurrency(parseFloat(enr.final_price || 0)),
      paymentStatus: enr.payment_status || 'N/A',
    });
  });

  revenuesSheet.addRow({});
  const revenueTotalRow = revenuesSheet.addRow({
    date: '',
    branch: 'TOTAL',
    student: '',
    course: '',
    amount: formatCurrency(totalRevenue),
  });
  revenueTotalRow.font = { bold: true };

  // Style revenues header
  revenuesSheet.getRow(1).font = { bold: true };
  revenuesSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  revenuesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Expenses Sheet
  const expensesSheet = workbook.addWorksheet('Expenses');
  expensesSheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Branch', key: 'branch', width: 20 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Vendor', key: 'vendor', width: 20 },
  ];

  data.expenses.forEach((exp) => {
    expensesSheet.addRow({
      date: formatDate(exp.date),
      branch: exp.branch_name || 'Shared',
      category: exp.category || 'N/A',
      type: exp.type || 'N/A',
      amount: formatCurrency(parseFloat(exp.amount || 0)),
      description: exp.description || '',
      vendor: exp.vendor || '',
    });
  });

  expensesSheet.addRow({});
  const expenseTotalRow = expensesSheet.addRow({
    date: '',
    branch: '',
    category: '',
    type: 'TOTAL',
    amount: formatCurrency(totalExpenses),
  });
  expenseTotalRow.font = { bold: true };

  // Style expenses header
  expensesSheet.getRow(1).font = { bold: true };
  expensesSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  expensesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Product Sales Sheet
  const productSalesSheet = workbook.addWorksheet('Product Sales');
  productSalesSheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Branch', key: 'branch', width: 20 },
    { header: 'Product', key: 'product', width: 25 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Unit Price', key: 'unitPrice', width: 15 },
    { header: 'Total Amount', key: 'totalAmount', width: 15 },
    { header: 'Payment Method', key: 'paymentMethod', width: 18 },
    { header: 'Customer', key: 'customer', width: 20 },
  ];

  data.productSales.forEach((sale) => {
    productSalesSheet.addRow({
      date: formatDate(sale.sale_date),
      branch: sale.branch_name || 'N/A',
      product: sale.product_name || 'N/A',
      quantity: sale.quantity || 0,
      unitPrice: formatCurrency(parseFloat(sale.unit_price || 0)),
      totalAmount: formatCurrency(parseFloat(sale.total_amount || 0)),
      paymentMethod: sale.payment_method || 'N/A',
      customer: sale.customer_name || '',
    });
  });

  productSalesSheet.addRow({});
  const productSalesTotalRow = productSalesSheet.addRow({
    date: '',
    branch: '',
    product: '',
    quantity: '',
    unitPrice: 'TOTAL',
    totalAmount: formatCurrency(totalProductSales),
  });
  productSalesTotalRow.font = { bold: true };

  // Style product sales header
  productSalesSheet.getRow(1).font = { bold: true };
  productSalesSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  productSalesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Withdrawals Sheet
  const withdrawalsSheet = workbook.addWorksheet('Withdrawals');
  withdrawalsSheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Branch', key: 'branch', width: 20 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Reason', key: 'reason', width: 40 },
    { header: 'Status', key: 'status', width: 12 },
  ];

  data.withdrawals.forEach((withdrawal) => {
    withdrawalsSheet.addRow({
      date: formatDate(withdrawal.date),
      branch: withdrawal.branch_name || 'Company-wide',
      amount: formatCurrency(parseFloat(withdrawal.amount || 0)),
      reason: withdrawal.reason || '',
      status: withdrawal.status || 'N/A',
    });
  });

  withdrawalsSheet.addRow({});
  const withdrawalTotalRow = withdrawalsSheet.addRow({
    date: '',
    branch: 'TOTAL',
    amount: formatCurrency(totalWithdrawals),
  });
  withdrawalTotalRow.font = { bold: true };

  // Style withdrawals header
  withdrawalsSheet.getRow(1).font = { bold: true };
  withdrawalsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  withdrawalsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function generateChurnReportExcel(companyId: string, startDate: string, endDate: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Fetch students who churned in the period
  const churnedStudents = await query(
    `SELECT s.*, b.name as branch_name, b.code as branch_code
     FROM students s
     LEFT JOIN branches b ON s.branch_id = b.id
     WHERE s.company_id = $1 AND s.churn_date >= $2 AND s.churn_date <= $3
     ORDER BY s.churn_date DESC`,
    [companyId, startDate, endDate]
  );

  // Summary Sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 },
  ];

  summarySheet.addRows([
    { metric: 'Period', value: `${formatDate(startDate)} to ${formatDate(endDate)}` },
    { metric: 'Total Churned Students', value: churnedStudents.length },
  ]);

  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Churned Students Sheet
  const studentsSheet = workbook.addWorksheet('Churned Students');
  studentsSheet.columns = [
    { header: 'Churn Date', key: 'churnDate', width: 15 },
    { header: 'First Name', key: 'firstName', width: 20 },
    { header: 'Last Name', key: 'lastName', width: 20 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'Branch', key: 'branch', width: 20 },
    { header: 'Enrollment Date', key: 'enrollmentDate', width: 15 },
    { header: 'Churn Reason', key: 'churnReason', width: 40 },
  ];

  churnedStudents.forEach((student) => {
    studentsSheet.addRow({
      churnDate: formatDate(student.churn_date),
      firstName: student.first_name || '',
      lastName: student.last_name || '',
      email: student.email || '',
      phone: student.phone || '',
      branch: student.branch_name || 'N/A',
      enrollmentDate: formatDate(student.enrollment_date),
      churnReason: student.churn_reason || 'Not specified',
    });
  });

  studentsSheet.getRow(1).font = { bold: true };
  studentsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  studentsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export const reportsRoutes = {
  financial: async ({ query: queryParams, headers }: { query: { startDate: string; endDate: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const { startDate, endDate } = queryParams;

      if (!startDate || !endDate) {
        return {
          status: 400 as const,
          body: { message: 'startDate and endDate are required' },
        };
      }

      const data = await fetchFinancialData(context.companyId, startDate, endDate);
      const excelBuffer = await generateFinancialExcel(data, startDate, endDate);
      const base64Data = excelBuffer.toString('base64');
      const filename = `Financial_Report_${startDate}_to_${endDate}.xlsx`;

      return {
        status: 200 as const,
        body: {
          data: base64Data,
          filename,
        },
      };
    } catch (error) {
      console.error('Generate financial report error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to generate financial report' },
      };
    }
  },

  financialMonthly: async ({ query: queryParams, headers }: { query: { startDate: string; endDate: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const { startDate, endDate } = queryParams;

      if (!startDate || !endDate) {
        return {
          status: 400 as const,
          body: { message: 'startDate and endDate are required' },
        };
      }

      const data = await fetchFinancialData(context.companyId, startDate, endDate);
      const excelBuffer = await generateFinancialExcel(data, startDate, endDate);
      const base64Data = excelBuffer.toString('base64');
      const filename = `Financial_Monthly_Report_${startDate}_to_${endDate}.xlsx`;

      return {
        status: 200 as const,
        body: {
          data: base64Data,
          filename,
        },
      };
    } catch (error) {
      console.error('Generate monthly financial report error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to generate monthly financial report' },
      };
    }
  },

  branch: async ({ params, query: queryParams, headers }: { params: { branchId: string }; query: { startDate: string; endDate: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const { branchId } = params;
      const { startDate, endDate } = queryParams;

      if (!startDate || !endDate) {
        return {
          status: 400 as const,
          body: { message: 'startDate and endDate are required' },
        };
      }

      if (!canAccessBranch(context, branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      const data = await fetchFinancialData(context.companyId, startDate, endDate, branchId);
      const excelBuffer = await generateFinancialExcel(data, startDate, endDate);
      const base64Data = excelBuffer.toString('base64');

      const branchName = data.branches[0]?.name || 'Branch';
      const filename = `${branchName}_Report_${startDate}_to_${endDate}.xlsx`;

      return {
        status: 200 as const,
        body: {
          data: base64Data,
          filename,
        },
      };
    } catch (error) {
      console.error('Generate branch report error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to generate branch report' },
      };
    }
  },

  churn: async ({ query: queryParams, headers }: { query: { startDate: string; endDate: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const { startDate, endDate } = queryParams;

      if (!startDate || !endDate) {
        return {
          status: 400 as const,
          body: { message: 'startDate and endDate are required' },
        };
      }

      const excelBuffer = await generateChurnReportExcel(context.companyId, startDate, endDate);
      const base64Data = excelBuffer.toString('base64');
      const filename = `Churn_Report_${startDate}_to_${endDate}.xlsx`;

      return {
        status: 200 as const,
        body: {
          data: base64Data,
          filename,
        },
      };
    } catch (error) {
      console.error('Generate churn report error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to generate churn report' },
      };
    }
  },
};
