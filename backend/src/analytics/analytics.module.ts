import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { DataStoreModule } from '../data-store/data-store.module';
import { RevenuesModule } from '../revenues/revenues.module';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  imports: [DataStoreModule, RevenuesModule, ExpensesModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
