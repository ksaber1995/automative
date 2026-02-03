import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DataStoreModule } from './data-store/data-store.module';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { CoursesModule } from './courses/courses.module';
import { ClassesModule } from './classes/classes.module';
import { StudentsModule } from './students/students.module';
import { EmployeesModule } from './employees/employees.module';
import { RevenuesModule } from './revenues/revenues.module';
import { ExpensesModule } from './expenses/expenses.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ReportsModule } from './reports/reports.module';
import { CashModule } from './cash/cash.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { DebtsModule } from './debts/debts.module';
import { ProductsModule } from './products/products.module';
import { ProductSalesModule } from './product-sales/product-sales.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    DataStoreModule,
    AuthModule,
    BranchesModule,
    CoursesModule,
    ClassesModule,
    StudentsModule,
    EmployeesModule,
    RevenuesModule,
    ExpensesModule,
    CashModule,
    WithdrawalsModule,
    DebtsModule,
    ProductsModule,
    ProductSalesModule,
    AnalyticsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
