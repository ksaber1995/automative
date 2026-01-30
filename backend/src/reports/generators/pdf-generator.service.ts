import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

@Injectable()
export class PdfGeneratorService {
  async generateFinancialReport(data: any, startDate?: string, endDate?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Title
      doc.fontSize(20).text('Automate Magic', { align: 'center' });
      doc.fontSize(16).text('Financial Report', { align: 'center' });
      doc.moveDown();

      // Date range
      if (startDate && endDate) {
        doc.fontSize(10).text(`Period: ${startDate} to ${endDate}`, { align: 'center' });
        doc.moveDown();
      }

      // Company Summary
      doc.fontSize(14).text('Company-Wide Summary', { underline: true });
      doc.moveDown(0.5);

      const summary = data.companyWideSummary;
      doc.fontSize(10);
      doc.text(`Total Revenue: $${summary.totalRevenue.toFixed(2)}`);
      doc.text(`Total Expenses: $${summary.totalExpenses.toFixed(2)}`);

      // Set color based on profit
      doc.fillColor(summary.netProfit >= 0 ? 'green' : 'red');
      doc.text(`Net Profit: $${summary.netProfit.toFixed(2)}`);

      const margin = summary.totalRevenue > 0
        ? ((summary.netProfit / summary.totalRevenue) * 100).toFixed(2)
        : 0;
      doc.fillColor('black').text(`Profit Margin: ${margin}%`);
      doc.moveDown();

      // Branch Performance
      doc.fontSize(14).text('Branch Performance', { underline: true });
      doc.moveDown(0.5);

      data.branchSummaries.forEach((branch: any) => {
        doc.fontSize(12).text(branch.branchName, { underline: true });
        doc.fontSize(10);
        doc.text(`Revenue: $${branch.totalRevenue.toFixed(2)}`);
        doc.text(`Expenses: $${branch.totalExpenses.toFixed(2)}`);
        doc.text(`Profit: $${branch.netProfit.toFixed(2)}`);
        doc.moveDown(0.5);
      });

      // Footer
      doc.fontSize(8)
        .text(
          `Generated on ${new Date().toLocaleDateString()}`,
          50,
          doc.page.height - 50,
          { align: 'center' }
        );

      doc.end();
    });
  }

  async generateBranchReport(branchData: any, startDate?: string, endDate?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Title
      doc.fontSize(20).text('Branch Report', { align: 'center' });
      doc.fontSize(16).text(branchData.branch.name, { align: 'center' });
      doc.moveDown();

      // Date range
      if (startDate && endDate) {
        doc.fontSize(10).text(`Period: ${startDate} to ${endDate}`, { align: 'center' });
        doc.moveDown();
      }

      // Branch Info
      doc.fontSize(12).text('Branch Information', { underline: true });
      doc.fontSize(10);
      doc.text(`Code: ${branchData.branch.code}`);
      doc.text(`City: ${branchData.branch.city}`);
      doc.text(`Email: ${branchData.branch.email}`);
      doc.moveDown();

      // Financial Summary
      doc.fontSize(12).text('Financial Summary', { underline: true });
      doc.fontSize(10);
      const summary = branchData.financialSummary;
      doc.text(`Total Revenue: $${summary.totalRevenue.toFixed(2)}`);
      doc.text(`Total Expenses: $${summary.totalExpenses.toFixed(2)}`);
      doc.text(`Net Profit: $${summary.netProfit.toFixed(2)}`);
      doc.moveDown();

      // Statistics
      doc.fontSize(12).text('Statistics', { underline: true });
      doc.fontSize(10);
      doc.text(`Active Courses: ${branchData.courseCount}`);
      doc.text(`Enrolled Students: ${branchData.studentCount}`);
      doc.text(`Employees: ${branchData.employeeCount}`);

      // Footer
      doc.fontSize(8)
        .text(
          `Generated on ${new Date().toLocaleDateString()}`,
          50,
          doc.page.height - 50,
          { align: 'center' }
        );

      doc.end();
    });
  }
}
