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
  Request,
} from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { UpdateWithdrawalDto } from './dto/update-withdrawal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('withdrawals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Post()
  @Roles('ADMIN')
  create(@Body() createWithdrawalDto: CreateWithdrawalDto, @Request() req) {
    return this.withdrawalsService.create(createWithdrawalDto, req.user.id);
  }

  @Get()
  @Roles('ADMIN', 'ACCOUNTANT')
  findAll(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('stakeholder') stakeholder?: string,
  ) {
    return this.withdrawalsService.findAll(startDate, endDate, stakeholder);
  }

  @Get('summary')
  @Roles('ADMIN', 'ACCOUNTANT')
  getSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.withdrawalsService.getSummary(startDate, endDate);
  }

  @Get('stakeholder/:name')
  @Roles('ADMIN')
  getByStakeholder(@Param('name') name: string) {
    return this.withdrawalsService.getByStakeholder(name);
  }

  @Get(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.withdrawalsService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id') id: string,
    @Body() updateWithdrawalDto: UpdateWithdrawalDto,
  ) {
    return this.withdrawalsService.update(id, updateWithdrawalDto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.withdrawalsService.remove(id);
  }
}
