import { Module } from '@nestjs/common';
import { ProductSalesService } from './product-sales.service';
import { ProductSalesController } from './product-sales.controller';
import { DataStoreModule } from '../data-store/data-store.module';
import { ProductsModule } from '../products/products.module';
import { RevenuesModule } from '../revenues/revenues.module';

@Module({
  imports: [DataStoreModule, ProductsModule, RevenuesModule],
  controllers: [ProductSalesController],
  providers: [ProductSalesService],
  exports: [ProductSalesService],
})
export class ProductSalesModule {}
