import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ExcelGeneratorService } from './generators/excel-generator.service';
import { PdfGeneratorService } from './generators/pdf-generator.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ExcelGeneratorService, PdfGeneratorService],
  exports: [ReportsService],
})
export class ReportsModule {}
