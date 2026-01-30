import { Controller, Get, Post, Patch, Delete, UseGuards, Query, Body, Param } from '@nestjs/common';
import { RevenuesService } from './revenues.service';
import { CreateRevenueDto } from './dto/create-revenue.dto';
import { UpdateRevenueDto } from './dto/update-revenue.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('revenues')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RevenuesController {
  constructor(private readonly revenuesService: RevenuesService) {}

  @Post()
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  create(@Body() createRevenueDto: CreateRevenueDto) {
    return this.revenuesService.create(createRevenueDto);
  }

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

  @Get(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.revenuesService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() updateRevenueDto: UpdateRevenueDto) {
    return this.revenuesService.update(id, updateRevenueDto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.revenuesService.remove(id);
  }
}
