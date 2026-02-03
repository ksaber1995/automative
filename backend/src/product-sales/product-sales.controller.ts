import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductSalesService } from './product-sales.service';
import { CreateProductSaleDto } from './dto/create-product-sale.dto';
import { UpdateProductSaleDto } from './dto/update-product-sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('product-sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductSalesController {
  constructor(private readonly productSalesService: ProductSalesService) {}

  @Post()
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  create(@Body() createProductSaleDto: CreateProductSaleDto) {
    return this.productSalesService.create(createProductSaleDto);
  }

  @Get()
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('branchId') branchId?: string,
    @Query('productId') productId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const filters: any = {};
    if (branchId) filters.branchId = branchId;
    if (productId) filters.productId = productId;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    return this.productSalesService.findAll(
      Object.keys(filters).length > 0 ? filters : undefined,
    );
  }

  @Get('summary')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getSalesSummary(
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const filters: any = {};
    if (branchId) filters.branchId = branchId;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    return this.productSalesService.getSalesSummary(
      Object.keys(filters).length > 0 ? filters : undefined,
    );
  }

  @Get('top-products')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getTopProducts(
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    const filters: any = {};
    if (branchId) filters.branchId = branchId;
    if (limit) filters.limit = parseInt(limit, 10);

    return this.productSalesService.getTopProducts(filters);
  }

  @Get(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.productSalesService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  update(
    @Param('id') id: string,
    @Body() updateProductSaleDto: UpdateProductSaleDto,
  ) {
    return this.productSalesService.update(id, updateProductSaleDto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.productSalesService.remove(id);
  }
}
