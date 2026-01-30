import { Controller, Get, Post, Patch, Delete, UseGuards, Query, Param, Body } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

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

  @Get(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string): Promise<any> {
    return this.expensesService.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'ACCOUNTANT')
  create(@Body() createExpenseDto: CreateExpenseDto): Promise<any> {
    return this.expensesService.create(createExpenseDto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() updateExpenseDto: UpdateExpenseDto): Promise<any> {
    return this.expensesService.update(id, updateExpenseDto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string): Promise<any> {
    return this.expensesService.remove(id);
  }
}
