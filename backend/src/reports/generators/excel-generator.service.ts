import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ExcelGeneratorService {
  async generateFinancialReport(data: any, startDate?: string, endDate?: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Financial Report');

    // Set column widths
    worksheet.columns = [
      { header: 'Branch', key: 'branch', width: 25 },
      { header: 'Revenue', key: 'revenue', width: 15 },
      { header: 'Fixed Expenses', key: 'fixed', width: 15 },
      { header: 'Variable Expenses', key: 'variable', width: 15 },
      { header: 'Salaries', key: 'salaries', width: 15 },
      { header: 'Shared Expenses', key: 'shared', width: 15 },
      { header: 'Total Expenses', key: 'expenses', width: 15 },
      { header: 'Net Profit', key: 'profit', width: 15 },
      { header: 'Profit Margin %', key: 'margin', width: 15 },
    ];

    // Add title
    worksheet.insertRow(1, ['Automate Magic - Financial Report']);
    worksheet.mergeCells('A1:I1');
    const titleRow = worksheet.getRow(1);
    titleRow.font = { size: 16, bold: true };
    titleRow.alignment = { horizontal: 'center' as const };

    // Add date range
    if (startDate && endDate) {
      worksheet.insertRow(2, [`Period: ${startDate} to ${endDate}`]);
      worksheet.mergeCells('A2:I2');
      const dateRow = worksheet.getRow(2);
      dateRow.alignment = { horizontal: 'center' as const };
    }

    // Style header row
    const headerRow = worksheet.getRow(startDate && endDate ? 3 : 2);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFE0E0E0' },
    };
    headerRow.alignment = { horizontal: 'center' as const };

    // Add company-wide summary
    const summary = data.companyWideSummary;
    const margin = summary.totalRevenue > 0
      ? ((summary.netProfit / summary.totalRevenue) * 100).toFixed(2)
      : '0.00';

    worksheet.addRow({
      branch: 'COMPANY TOTAL',
      revenue: summary.totalRevenue,
      fixed: summary.fixedExpenses,
      variable: summary.variableExpenses,
      salaries: summary.salaries,
      shared: summary.sharedExpenses,
      expenses: summary.totalExpenses,
      profit: summary.netProfit,
      margin: margin,
    });

    // Style total row
    const totalRow = worksheet.lastRow;
    if (totalRow) {
      totalRow.font = { bold: true };
      totalRow.fill = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FFF0F0F0' },
      };
    }

    // Add branch data
    data.branchSummaries.forEach((branch: any) => {
      const branchMargin = branch.totalRevenue > 0
        ? ((branch.netProfit / branch.totalRevenue) * 100).toFixed(2)
        : '0.00';

      worksheet.addRow({
        branch: `${branch.branchName} (${branch.branchCode})`,
        revenue: branch.totalRevenue,
        fixed: branch.fixedExpenses,
        variable: branch.variableExpenses,
        salaries: branch.salaries,
        shared: branch.sharedExpenses,
        expenses: branch.totalExpenses,
        profit: branch.netProfit,
        margin: branchMargin,
      });
    });

    // Format currency columns
    ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => {
      worksheet.getColumn(col).numFmt = '"$"#,##0.00';
    });

    // Format percentage column
    worksheet.getColumn('I').numFmt = '0.00"%"';

    // Apply borders
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' as const },
          left: { style: 'thin' as const },
          bottom: { style: 'thin' as const },
          right: { style: 'thin' as const },
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async generateBranchReport(branchData: any, startDate?: string, endDate?: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Branch Report');

    // Add title
    worksheet.mergeCells('A1:B1');
    worksheet.getCell('A1').value = `Branch Report: ${branchData.branch.name}`;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' as const };

    // Add date range if provided
    let row = 2;
    if (startDate && endDate) {
      worksheet.mergeCells(`A${row}:B${row}`);
      worksheet.getCell(`A${row}`).value = `Period: ${startDate} to ${endDate}`;
      worksheet.getCell(`A${row}`).alignment = { horizontal: 'center' as const };
      row++;
    }
    row++; // Skip a row

    // Add branch info
    worksheet.getCell(`A${row}`).value = 'Branch Code:';
    worksheet.getCell(`B${row}`).value = branchData.branch.code;
    row++;
    worksheet.getCell(`A${row}`).value = 'City:';
    worksheet.getCell(`B${row}`).value = branchData.branch.city;
    row++;
    worksheet.getCell(`A${row}`).value = 'Email:';
    worksheet.getCell(`B${row}`).value = branchData.branch.email;
    row += 2;

    // Financial summary
    worksheet.getCell(`A${row}`).value = 'Financial Summary';
    worksheet.getCell(`A${row}`).font = { bold: true };
    row++;

    const summary = branchData.financialSummary;
    worksheet.getCell(`A${row}`).value = 'Total Revenue:';
    worksheet.getCell(`B${row}`).value = summary.totalRevenue;
    worksheet.getCell(`B${row}`).numFmt = '"$"#,##0.00';
    row++;

    worksheet.getCell(`A${row}`).value = 'Total Expenses:';
    worksheet.getCell(`B${row}`).value = summary.totalExpenses;
    worksheet.getCell(`B${row}`).numFmt = '"$"#,##0.00';
    row++;

    worksheet.getCell(`A${row}`).value = 'Net Profit:';
    worksheet.getCell(`B${row}`).value = summary.netProfit;
    worksheet.getCell(`B${row}`).numFmt = '"$"#,##0.00';
    worksheet.getCell(`B${row}`).font = { bold: true };

    worksheet.columns = [
      { width: 25 },
      { width: 20 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async generateMonthlyFinancialReport(monthlyData: any[], startDate?: string, endDate?: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Monthly Financial Report');

    // Set column widths
    worksheet.columns = [
      { header: 'Month', key: 'month', width: 20 },
      { header: 'Revenue', key: 'revenue', width: 15 },
      { header: 'Fixed Expenses', key: 'fixed', width: 15 },
      { header: 'Variable Expenses', key: 'variable', width: 15 },
      { header: 'Salaries', key: 'salaries', width: 15 },
      { header: 'Shared Expenses', key: 'shared', width: 15 },
      { header: 'Total Expenses', key: 'expenses', width: 15 },
      { header: 'Net Profit', key: 'profit', width: 15 },
      { header: 'Profit Margin %', key: 'margin', width: 15 },
      { header: 'Growth %', key: 'growth', width: 15 },
    ];

    // Add title
    worksheet.insertRow(1, ['Automate Magic - Monthly Financial Report']);
    worksheet.mergeCells('A1:J1');
    const titleRow = worksheet.getRow(1);
    titleRow.font = { size: 16, bold: true };
    titleRow.alignment = { horizontal: 'center' as const };

    // Add date range
    if (startDate && endDate) {
      worksheet.insertRow(2, [`Period: ${startDate} to ${endDate}`]);
      worksheet.mergeCells('A2:J2');
      const dateRow = worksheet.getRow(2);
      dateRow.alignment = { horizontal: 'center' as const };
    }

    // Style header row
    const headerRow = worksheet.getRow(startDate && endDate ? 3 : 2);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFE0E0E0' },
    };
    headerRow.alignment = { horizontal: 'center' as const };

    // Add monthly data
    let previousProfit = 0;
    monthlyData.forEach((month: any, index: number) => {
      const margin = month.totalRevenue > 0
        ? ((month.netProfit / month.totalRevenue) * 100).toFixed(2)
        : '0.00';

      const growth = index > 0 && previousProfit !== 0
        ? (((month.netProfit - previousProfit) / Math.abs(previousProfit)) * 100).toFixed(2)
        : '0.00';

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthLabel = `${monthNames[month.month - 1]} ${month.year}`;

      worksheet.addRow({
        month: monthLabel,
        revenue: month.totalRevenue,
        fixed: month.fixedExpenses,
        variable: month.variableExpenses,
        salaries: month.salaries,
        shared: month.sharedExpenses,
        expenses: month.totalExpenses,
        profit: month.netProfit,
        margin: margin,
        growth: growth,
      });

      previousProfit = month.netProfit;
    });

    // Add totals row
    const totals = monthlyData.reduce((acc, month) => ({
      totalRevenue: acc.totalRevenue + month.totalRevenue,
      fixedExpenses: acc.fixedExpenses + month.fixedExpenses,
      variableExpenses: acc.variableExpenses + month.variableExpenses,
      salaries: acc.salaries + month.salaries,
      sharedExpenses: acc.sharedExpenses + month.sharedExpenses,
      totalExpenses: acc.totalExpenses + month.totalExpenses,
      netProfit: acc.netProfit + month.netProfit,
    }), {
      totalRevenue: 0,
      fixedExpenses: 0,
      variableExpenses: 0,
      salaries: 0,
      sharedExpenses: 0,
      totalExpenses: 0,
      netProfit: 0,
    });

    const totalMargin = totals.totalRevenue > 0
      ? ((totals.netProfit / totals.totalRevenue) * 100).toFixed(2)
      : '0.00';

    worksheet.addRow({
      month: 'TOTAL',
      revenue: totals.totalRevenue,
      fixed: totals.fixedExpenses,
      variable: totals.variableExpenses,
      salaries: totals.salaries,
      shared: totals.sharedExpenses,
      expenses: totals.totalExpenses,
      profit: totals.netProfit,
      margin: totalMargin,
      growth: '',
    });

    // Style total row
    const totalRow = worksheet.lastRow;
    if (totalRow) {
      totalRow.font = { bold: true };
      totalRow.fill = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FFFFD700' },
      };
    }

    // Format currency columns
    ['B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => {
      worksheet.getColumn(col).numFmt = '"$"#,##0.00';
    });

    // Format percentage columns
    worksheet.getColumn('I').numFmt = '0.00"%"';
    worksheet.getColumn('J').numFmt = '0.00"%"';

    // Apply borders
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' as const },
          left: { style: 'thin' as const },
          bottom: { style: 'thin' as const },
          right: { style: 'thin' as const },
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
