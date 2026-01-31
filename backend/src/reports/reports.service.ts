import { Injectable } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import { ExcelGeneratorService } from './generators/excel-generator.service';
import { PdfGeneratorService } from './generators/pdf-generator.service';

@Injectable()
export class ReportsService {
  constructor(
    private analyticsService: AnalyticsService,
    private excelGenerator: ExcelGeneratorService,
    private pdfGenerator: PdfGeneratorService,
  ) {}

  async generateFinancialReportExcel(startDate?: string, endDate?: string): Promise<Buffer> {
    const data = await this.analyticsService.getDashboard(startDate, endDate);
    return this.excelGenerator.generateFinancialReport(data, startDate, endDate);
  }

  async generateFinancialReportPdf(startDate?: string, endDate?: string): Promise<Buffer> {
    const data = await this.analyticsService.getDashboard(startDate, endDate);
    return this.pdfGenerator.generateFinancialReport(data, startDate, endDate);
  }

  async generateBranchReportExcel(
    branchId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<Buffer> {
    const data = await this.analyticsService.getBranchAnalytics(branchId, startDate, endDate);
    return this.excelGenerator.generateBranchReport(data, startDate, endDate);
  }

  async generateBranchReportPdf(
    branchId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<Buffer> {
    const data = await this.analyticsService.getBranchAnalytics(branchId, startDate, endDate);
    return this.pdfGenerator.generateBranchReport(data, startDate, endDate);
  }

  async generateMonthlyFinancialReportExcel(startDate?: string, endDate?: string): Promise<Buffer> {
    const monthlyData = await this.analyticsService.getMonthlyFinancialBreakdown(startDate, endDate);
    return this.excelGenerator.generateMonthlyFinancialReport(monthlyData, startDate, endDate);
  }

  async generateChurnReportExcel(startDate?: string, endDate?: string): Promise<Buffer> {
    const churnData = await this.analyticsService.getChurnAnalysis(startDate, endDate);
    return this.excelGenerator.generateChurnReport(churnData, startDate, endDate);
  }
}
