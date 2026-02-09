import ExcelJS from 'exceljs';
import { query } from '../db/connection';

interface FinancialData {
  revenues: any[];
  expenses: any[];
  productSales: any[];
  withdrawals: any[];
  branches: any[];
}

async function fetchFinancialData(
  startDate: string,
  endDate: string,
  branchId?: string
): Promise<FinancialData> {
  let whereClause = '';
  let params: any[] = [startDate, endDate];

  if (branchId) {
    params.push(branchId);
    whereClause = ` AND branch_id = $3`;
  }

  // Fetch revenues
  const revenues = await query(
    `SELECT r.*, b.name as branch_name, b.code as branch_code
     FROM revenues r
     LEFT JOIN branches b ON r.branch_id = b.id
     WHERE r.date >= $1 AND r.date <= $2${whereClause}
     ORDER BY r.date DESC`,
    params
  );

  // Fetch expenses
  const expenses = await query(
    `SELECT e.*, b.name as branch_name, b.code as branch_code
     FROM expenses e
     LEFT JOIN branches b ON e.branch_id = b.id
     WHERE e.date >= $1 AND e.date <= $2${whereClause}
     ORDER BY e.date DESC`,
    params
  );

  // Fetch product sales
  const productSales = await query(
    `SELECT ps.*, p.name as product_name, p.code as product_code,
            b.name as branch_name, b.code as branch_code
     FROM product_sales ps
     LEFT JOIN products p ON ps.product_id = p.id
     LEFT JOIN branches b ON ps.branch_id = b.id
     WHERE ps.sale_date >= $1 AND ps.sale_date <= $2${whereClause}
     ORDER BY ps.sale_date DESC`,
    params
  );

  // Fetch withdrawals (approved only)
  const withdrawals = await query(
    `SELECT w.*, b.name as branch_name, b.code as branch_code
     FROM withdrawals w
     LEFT JOIN branches b ON w.branch_id = b.id
     WHERE w.date >= $1 AND w.date <= $2 AND w.status = 'APPROVED'${whereClause}
     ORDER BY w.date DESC`,
    params
  );

  // Fetch branches for summary
  const branches = branchId
    ? await query(`SELECT * FROM branches WHERE id = $1`, [branchId])
    : await query(`SELECT * FROM branches WHERE is_active = true ORDER BY name`);

  return { revenues, expenses, productSales, withdrawals, branches };
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

  const totalRevenue = data.revenues.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
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

  // Revenues Sheet
  const revenuesSheet = workbook.addWorksheet('Revenues');
  revenuesSheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Branch', key: 'branch', width: 20 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Payment Method', key: 'paymentMethod', width: 18 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Receipt Number', key: 'receiptNumber', width: 18 },
  ];

  data.revenues.forEach((rev) => {
    revenuesSheet.addRow({
      date: formatDate(rev.date),
      branch: rev.branch_name || 'N/A',
      amount: formatCurrency(parseFloat(rev.amount || 0)),
      paymentMethod: rev.payment_method || 'N/A',
      description: rev.description || '',
      receiptNumber: rev.receipt_number || '',
    });
  });

  revenuesSheet.addRow({});
  const revenueTotalRow = revenuesSheet.addRow({
    date: '',
    branch: 'TOTAL',
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

export const reportsRoutes = {
  financialMonthly: async ({ query: queryParams }: { query: { startDate: string; endDate: string; branchId?: string } }) => {
    try {
      const { startDate, endDate, branchId } = queryParams;

      // Validate dates
      if (!startDate || !endDate) {
        return {
          status: 400 as const,
          body: { message: 'startDate and endDate are required' },
        };
      }

      // Fetch data
      const data = await fetchFinancialData(startDate, endDate, branchId);

      // Generate Excel
      const excelBuffer = await generateFinancialExcel(data, startDate, endDate);

      // Convert to base64
      const base64Data = excelBuffer.toString('base64');

      // Generate filename
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
        status: 400 as const,
        body: { message: 'Failed to generate financial report', error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  },
};
