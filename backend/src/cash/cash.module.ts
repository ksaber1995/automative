import { Module } from '@nestjs/common';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';
import { DataStoreModule } from '../data-store/data-store.module';

@Module({
  imports: [DataStoreModule],
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
