import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('excel/financial')
  @Roles('ADMIN', 'ACCOUNTANT')
  async exportFinancialExcel(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.generateFinancialReportExcel(startDate, endDate);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=financial-report-${Date.now()}.xlsx`,
    );

    res.send(buffer);
  }

  @Get('pdf/financial')
  @Roles('ADMIN', 'ACCOUNTANT')
  async exportFinancialPdf(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.generateFinancialReportPdf(startDate, endDate);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=financial-report-${Date.now()}.pdf`,
    );

    res.send(buffer);
  }

  @Get('excel/branch/:branchId')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  async exportBranchExcel(
    @Param('branchId') branchId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.generateBranchReportExcel(
      branchId,
      startDate,
      endDate,
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=branch-report-${branchId}-${Date.now()}.xlsx`,
    );

    res.send(buffer);
  }

  @Get('pdf/branch/:branchId')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  async exportBranchPdf(
    @Param('branchId') branchId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.generateBranchReportPdf(
      branchId,
      startDate,
      endDate,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=branch-report-${branchId}-${Date.now()}.pdf`,
    );

    res.send(buffer);
  }

  @Get('excel/financial-monthly')
  @Roles('ADMIN', 'ACCOUNTANT')
  async exportMonthlyFinancialExcel(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.generateMonthlyFinancialReportExcel(startDate, endDate);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=monthly-financial-report-${Date.now()}.xlsx`,
    );

    res.send(buffer);
  }
}
