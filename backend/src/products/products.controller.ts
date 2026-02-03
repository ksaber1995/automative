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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles('ADMIN', 'BRANCH_MANAGER')
  create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }

  @Get()
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('branchId') branchId?: string,
    @Query('isGlobal') isGlobal?: string,
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
  ) {
    const filters: any = {};
    if (branchId) filters.branchId = branchId;
    if (isGlobal !== undefined) filters.isGlobal = isGlobal === 'true';
    if (category) filters.category = category;
    if (isActive !== undefined) filters.isActive = isActive === 'true';

    return this.productsService.findAll(Object.keys(filters).length > 0 ? filters : undefined);
  }

  @Get('available/:branchId')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAvailableForBranch(@Param('branchId') branchId: string) {
    return this.productsService.findAvailableForBranch(branchId);
  }

  @Get('low-stock')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getLowStockProducts(@Query('branchId') branchId?: string) {
    return this.productsService.getLowStockProducts(branchId);
  }

  @Get(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    return this.productsService.update(id, updateProductDto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Patch(':id/stock')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  adjustStock(
    @Param('id') id: string,
    @Body() body: { quantity: number; operation: 'add' | 'subtract' },
  ) {
    return this.productsService.adjustStock(id, body.quantity, body.operation);
  }
}
