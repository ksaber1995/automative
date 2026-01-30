import { Controller, Get, Post, UseGuards, Query, Param } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('branchId') branchId?: string,
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<any[]> {
    return this.expensesService.findAll({ branchId, type, startDate, endDate });
  }

  @Get('recurring')
  @Roles('ADMIN', 'ACCOUNTANT')
  getRecurring(): Promise<any[]> {
    return this.expensesService.getRecurring();
  }

  @Get('type/:type')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getByType(@Param('type') type: string): Promise<any[]> {
    return this.expensesService.getByType(type);
  }

  @Post('auto-generate')
  @Roles('ADMIN')
  autoGenerate(): Promise<{ message: string }> {
    return this.expensesService.autoGenerateRecurringExpenses();
  }
}
