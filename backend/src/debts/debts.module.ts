import { Module, forwardRef } from '@nestjs/common';
import { DebtsService } from './debts.service';
import { DebtsController } from './debts.controller';
import { DataStoreModule } from '../data-store/data-store.module';
import { CashModule } from '../cash/cash.module';

@Module({
  imports: [DataStoreModule, forwardRef(() => CashModule)],
  controllers: [DebtsController],
  providers: [DebtsService],
  exports: [DebtsService],
})
export class DebtsModule {}
