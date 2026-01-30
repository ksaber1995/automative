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
    titleRow.alignment = { horizontal: 'center' };

    // Add date range
    if (startDate && endDate) {
      worksheet.insertRow(2, [`Period: ${startDate} to ${endDate}`]);
      worksheet.mergeCells('A2:I2');
      const dateRow = worksheet.getRow(2);
      dateRow.alignment = { horizontal: 'center' };
    }

    // Style header row
    const headerRow = worksheet.getRow(startDate && endDate ? 3 : 2);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
    headerRow.alignment = { horizontal: 'center' };

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
        type: 'pattern',
        pattern: 'solid',
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
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

    return await workbook.xlsx.writeBuffer() as Buffer;
  }

  async generateBranchReport(branchData: any, startDate?: string, endDate?: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Branch Report');

    // Add title
    worksheet.mergeCells('A1:B1');
    worksheet.getCell('A1').value = `Branch Report: ${branchData.branch.name}`;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    // Add branch info
    let row = 3;
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

    return await workbook.xlsx.writeBuffer() as Buffer;
  }
}
