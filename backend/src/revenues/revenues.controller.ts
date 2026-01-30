import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { RevenuesService } from './revenues.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('revenues')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RevenuesController {
  constructor(private readonly revenuesService: RevenuesService) {}

  @Get()
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.revenuesService.findAll({ branchId, startDate, endDate });
  }

  @Get('summary')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getSummary(
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.revenuesService.getSummary({ branchId, startDate, endDate });
  }
}
