import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { DebtsService } from './debts.service';
import { CreateDebtDto } from './dto/create-debt.dto';
import { UpdateDebtDto } from './dto/update-debt.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('debts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Post()
  @Roles('ADMIN')
  create(@Body() createDebtDto: CreateDebtDto) {
    return this.debtsService.create(createDebtDto);
  }

  @Get()
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(@Query('status') status?: string) {
    return this.debtsService.findAll(status);
  }

  @Get('summary')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getSummary() {
    return this.debtsService.getSummary();
  }

  @Get(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  findOne(@Param('id') id: string, @Query('includePayments') includePayments?: string) {
    return this.debtsService.findOne(id, includePayments === 'true');
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateDebtDto: UpdateDebtDto) {
    return this.debtsService.update(id, updateDebtDto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.debtsService.remove(id);
  }

  // Debt payments
  @Post(':id/payments')
  @Roles('ADMIN', 'ACCOUNTANT')
  createPayment(
    @Param('id') id: string,
    @Body() createPaymentDto: CreatePaymentDto,
  ) {
    return this.debtsService.createPayment(id, createPaymentDto);
  }

  @Get(':id/payments')
  @Roles('ADMIN', 'ACCOUNTANT')
  getPayments(@Param('id') id: string) {
    return this.debtsService.getPayments(id);
  }

  @Delete(':id/payments/:paymentId')
  @Roles('ADMIN')
  deletePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.debtsService.deletePayment(id, paymentId);
  }
}
