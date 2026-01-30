import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardMetrics, FinancialSummary } from '../../../shared/interfaces/analytics.interface';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getDashboard(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<DashboardMetrics> {
    return this.analyticsService.getDashboard(startDate, endDate);
  }

  @Get('branch/:branchId')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getBranchAnalytics(
    @Param('branchId') branchId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analyticsService.getBranchAnalytics(branchId, startDate, endDate);
  }

  @Get('revenue-trends')
  @Roles('ADMIN', 'ACCOUNTANT')
  getRevenueTrends(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analyticsService.getRevenueTrends(startDate, endDate);
  }

  @Get('profit-loss')
  @Roles('ADMIN', 'ACCOUNTANT')
  getProfitLoss(
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<FinancialSummary> {
    return this.analyticsService.getProfitLoss(branchId, startDate, endDate);
  }
}
