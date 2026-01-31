import { Module, forwardRef } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';
import { DataStoreModule } from '../data-store/data-store.module';
import { CashModule } from '../cash/cash.module';

@Module({
  imports: [DataStoreModule, forwardRef(() => CashModule)],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
