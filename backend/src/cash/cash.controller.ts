import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CashService } from './cash.service';
import { AdjustCashDto } from './dto/adjust-cash.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('cash')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Get('current')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getCurrentCash() {
    return this.cashService.getCurrentCash();
  }

  @Post('adjust')
  @Roles('ADMIN')
  adjustCash(@Body() adjustCashDto: AdjustCashDto) {
    return this.cashService.adjustCash(adjustCashDto);
  }

  @Get('flow')
  @Roles('ADMIN', 'ACCOUNTANT')
  getCashFlow(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.cashService.getCashFlow(startDate, endDate);
  }
}
