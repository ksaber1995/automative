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

  async generateChurnReport(churnData: any, startDate?: string, endDate?: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    // ========== SUMMARY SHEET ==========
    const summarySheet = workbook.addWorksheet('Overall Summary');

    // Title
    summarySheet.mergeCells('A1:E1');
    summarySheet.getCell('A1').value = 'Automate Magic - Churn Rate Report';
    summarySheet.getCell('A1').font = { size: 16, bold: true };
    summarySheet.getCell('A1').alignment = { horizontal: 'center' as const };

    // Date range
    let row = 2;
    if (startDate && endDate) {
      summarySheet.mergeCells(`A${row}:E${row}`);
      summarySheet.getCell(`A${row}`).value = `Period: ${startDate} to ${endDate}`;
      summarySheet.getCell(`A${row}`).alignment = { horizontal: 'center' as const };
      row++;
    }
    row += 2;

    // Overall Summary
    summarySheet.getCell(`A${row}`).value = 'Overall Summary';
    summarySheet.getCell(`A${row}`).font = { size: 14, bold: true };
    row++;

    summarySheet.getCell(`A${row}`).value = 'Total Students:';
    summarySheet.getCell(`B${row}`).value = churnData.summary.totalStudents;
    row++;

    summarySheet.getCell(`A${row}`).value = 'Active Students:';
    summarySheet.getCell(`B${row}`).value = churnData.summary.activeStudents;
    summarySheet.getCell(`B${row}`).fill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FF90EE90' },
    };
    row++;

    summarySheet.getCell(`A${row}`).value = 'Churned Students:';
    summarySheet.getCell(`B${row}`).value = churnData.summary.churnedStudents;
    summarySheet.getCell(`B${row}`).fill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFFF6B6B' },
    };
    row++;

    summarySheet.getCell(`A${row}`).value = 'Overall Churn Rate:';
    summarySheet.getCell(`B${row}`).value = `${churnData.summary.overallChurnRate}%`;
    summarySheet.getCell(`B${row}`).font = { bold: true, size: 12 };
    summarySheet.getCell(`B${row}`).fill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFFFD700' },
    };
    row += 3;

    // Branch Summary Table
    summarySheet.getCell(`A${row}`).value = 'Branch-wise Churn Analysis';
    summarySheet.getCell(`A${row}`).font = { size: 14, bold: true };
    row++;

    // Headers
    summarySheet.getCell(`A${row}`).value = 'Branch';
    summarySheet.getCell(`B${row}`).value = 'Total Students';
    summarySheet.getCell(`C${row}`).value = 'Active';
    summarySheet.getCell(`D${row}`).value = 'Churned';
    summarySheet.getCell(`E${row}`).value = 'Churn Rate %';

    const headerRow = summarySheet.getRow(row);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFE0E0E0' },
    };
    row++;

    // Branch data
    churnData.churnByBranch.forEach((branch: any) => {
      summarySheet.getCell(`A${row}`).value = `${branch.branchName} (${branch.branchCode})`;
      summarySheet.getCell(`B${row}`).value = branch.totalStudents;
      summarySheet.getCell(`C${row}`).value = branch.activeStudents;
      summarySheet.getCell(`D${row}`).value = branch.churnedStudents;
      summarySheet.getCell(`E${row}`).value = `${branch.churnRate}%`;

      // Color code churn rate
      if (branch.churnRate > 20) {
        summarySheet.getCell(`E${row}`).fill = {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: 'FFFF6B6B' },
        };
      } else if (branch.churnRate > 10) {
        summarySheet.getCell(`E${row}`).fill = {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: 'FFFFD700' },
        };
      }
      row++;
    });

    summarySheet.columns = [
      { width: 30 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
    ];

    // Churned Students Detail Sheet
    const detailSheet = workbook.addWorksheet('Churned Students Detail');

    detailSheet.columns = [
      { header: 'Student Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Branch', key: 'branch', width: 25 },
      { header: 'Courses Enrolled', key: 'courses', width: 35 },
      { header: 'Enrollment Date', key: 'enrollmentDate', width: 15 },
      { header: 'Churn Date', key: 'churnDate', width: 15 },
      { header: 'Duration (Months)', key: 'duration', width: 15 },
      { header: 'Churn Reason', key: 'reason', width: 30 },
    ];

    // Title
    detailSheet.insertRow(1, ['Churned Students - Detailed List']);
    detailSheet.mergeCells('A1:I1');
    detailSheet.getRow(1).font = { size: 16, bold: true };
    detailSheet.getRow(1).alignment = { horizontal: 'center' as const };

    // Date range
    if (startDate && endDate) {
      detailSheet.insertRow(2, [`Period: ${startDate} to ${endDate}`]);
      detailSheet.mergeCells('A2:I2');
      detailSheet.getRow(2).alignment = { horizontal: 'center' as const };
    }

    // Style header row
    const detailHeaderRow = detailSheet.getRow(startDate && endDate ? 3 : 2);
    detailHeaderRow.font = { bold: true };
    detailHeaderRow.fill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add churned students data
    churnData.churnedStudentsList.forEach((student: any) => {
      detailSheet.addRow({
        name: `${student.firstName} ${student.lastName}`,
        email: student.email || 'N/A',
        phone: student.phone || 'N/A',
        branch: `${student.branchName} (${student.branchCode})`,
        courses: student.courses || 'None',
        enrollmentDate: student.enrollmentDate,
        churnDate: student.churnDate,
        duration: student.durationMonths,
        reason: student.churnReason,
      });
    });

    // ========== CHURN BY COURSE SHEET ==========
    const courseSheet = workbook.addWorksheet('Churn by Course');

    courseSheet.columns = [
      { header: 'Course Name', key: 'name', width: 30 },
      { header: 'Course Code', key: 'code', width: 15 },
      { header: 'Total Enrollments', key: 'total', width: 18 },
      { header: 'Churned Students', key: 'churned', width: 18 },
      { header: 'Churn Rate %', key: 'rate', width: 15 },
    ];

    // Title
    courseSheet.insertRow(1, ['Churn Analysis by Course']);
    courseSheet.mergeCells('A1:E1');
    courseSheet.getRow(1).font = { size: 16, bold: true };
    courseSheet.getRow(1).alignment = { horizontal: 'center' as const };

    if (startDate && endDate) {
      courseSheet.insertRow(2, [`Period: ${startDate} to ${endDate}`]);
      courseSheet.mergeCells('A2:E2');
      courseSheet.getRow(2).alignment = { horizontal: 'center' as const };
    }

    const courseHeaderRow = courseSheet.getRow(startDate && endDate ? 3 : 2);
    courseHeaderRow.font = { bold: true };
    courseHeaderRow.fill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFE0E0E0' },
    };

    churnData.churnByCourse.forEach((course: any) => {
      const newRow = courseSheet.addRow({
        name: course.courseName,
        code: course.courseCode,
        total: course.totalEnrollments,
        churned: course.churnedStudents,
        rate: `${course.churnRate}%`,
      });

      if (course.churnRate > 30) {
        newRow.getCell('E').fill = {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: 'FFFF6B6B' },
        };
      } else if (course.churnRate > 15) {
        newRow.getCell('E').fill = {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: 'FFFFD700' },
        };
      }
    });

    // ========== MONTHLY CHURN TREND SHEET ==========
    const monthlySheet = workbook.addWorksheet('Monthly Churn Trend');

    monthlySheet.columns = [
      { header: 'Year', key: 'year', width: 10 },
      { header: 'Month', key: 'month', width: 12 },
      { header: 'Churned Students', key: 'churned', width: 18 },
      { header: 'Active at Month Start', key: 'active', width: 20 },
      { header: 'Churn Rate %', key: 'rate', width: 15 },
    ];

    monthlySheet.insertRow(1, ['Monthly Churn Trend Analysis']);
    monthlySheet.mergeCells('A1:E1');
    monthlySheet.getRow(1).font = { size: 16, bold: true };
    monthlySheet.getRow(1).alignment = { horizontal: 'center' as const };

    if (startDate && endDate) {
      monthlySheet.insertRow(2, [`Period: ${startDate} to ${endDate}`]);
      monthlySheet.mergeCells('A2:E2');
      monthlySheet.getRow(2).alignment = { horizontal: 'center' as const };
    }

    const monthlyHeaderRow = monthlySheet.getRow(startDate && endDate ? 3 : 2);
    monthlyHeaderRow.font = { bold: true };
    monthlyHeaderRow.fill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFE0E0E0' },
    };

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    churnData.monthlyChurn.forEach((month: any) => {
      const newRow = monthlySheet.addRow({
        year: month.year,
        month: monthNames[month.month - 1],
        churned: month.churnedCount,
        active: month.activeAtStart,
        rate: `${month.churnRate}%`,
      });

      if (month.churnRate > 5) {
        newRow.getCell('E').fill = {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: 'FFFF6B6B' },
        };
      } else if (month.churnRate > 2) {
        newRow.getCell('E').fill = {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: 'FFFFD700' },
        };
      }
    });

    // ========== BRANCH & COURSE COMBINED SHEET ==========
    const branchCourseSheet = workbook.addWorksheet('Churn by Branch & Course');

    branchCourseSheet.columns = [
      { header: 'Branch', key: 'branch', width: 25 },
      { header: 'Course', key: 'course', width: 25 },
      { header: 'Total Enrollments', key: 'total', width: 18 },
      { header: 'Churned Students', key: 'churned', width: 18 },
      { header: 'Churn Rate %', key: 'rate', width: 15 },
    ];

    branchCourseSheet.insertRow(1, ['Churn Analysis by Branch & Course']);
    branchCourseSheet.mergeCells('A1:E1');
    branchCourseSheet.getRow(1).font = { size: 16, bold: true };
    branchCourseSheet.getRow(1).alignment = { horizontal: 'center' as const };

    if (startDate && endDate) {
      branchCourseSheet.insertRow(2, [`Period: ${startDate} to ${endDate}`]);
      branchCourseSheet.mergeCells('A2:E2');
      branchCourseSheet.getRow(2).alignment = { horizontal: 'center' as const };
    }

    const branchCourseHeaderRow = branchCourseSheet.getRow(startDate && endDate ? 3 : 2);
    branchCourseHeaderRow.font = { bold: true };
    branchCourseHeaderRow.fill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFE0E0E0' },
    };

    churnData.churnByBranchAndCourse.forEach((item: any) => {
      const newRow = branchCourseSheet.addRow({
        branch: `${item.branchName} (${item.branchCode})`,
        course: `${item.courseName} (${item.courseCode})`,
        total: item.totalEnrollments,
        churned: item.churnedStudents,
        rate: `${item.churnRate}%`,
      });

      if (item.churnRate > 30) {
        newRow.getCell('E').fill = {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: 'FFFF6B6B' },
        };
      } else if (item.churnRate > 15) {
        newRow.getCell('E').fill = {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: 'FFFFD700' },
        };
      }
    });

    // Apply borders to all sheets
    [summarySheet, detailSheet, courseSheet, monthlySheet, branchCourseSheet].forEach(sheet => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' as const },
            left: { style: 'thin' as const },
            bottom: { style: 'thin' as const },
            right: { style: 'thin' as const },
          };
        });
      });
    });

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
