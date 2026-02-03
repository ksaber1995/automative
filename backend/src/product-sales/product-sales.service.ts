import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { ProductsService } from '../products/products.service';
import { RevenuesService } from '../revenues/revenues.service';
import { CreateProductSaleDto } from './dto/create-product-sale.dto';
import { UpdateProductSaleDto } from './dto/update-product-sale.dto';
import { DiscountType } from '../../../shared/enums/product.enum';

@Injectable()
export class ProductSalesService {
  constructor(
    private dataStore: DataStoreService,
    private productsService: ProductsService,
    private revenuesService: RevenuesService,
  ) {}

  async create(createProductSaleDto: CreateProductSaleDto) {
    // 1. Fetch product details and validate
    const product = (await this.productsService.findOne(
      createProductSaleDto.productId,
    )) as any;

    if (!product.isActive) {
      throw new BadRequestException('Product is not active');
    }

    // 2. Validate stock availability
    const stockAvailable = await this.productsService.checkStockAvailability(
      createProductSaleDto.productId,
      createProductSaleDto.quantity,
    );

    if (!stockAvailable) {
      throw new BadRequestException(
        `Insufficient stock. Available: ${product.stock}, Requested: ${createProductSaleDto.quantity}`,
      );
    }

    // 3. Calculate sale amounts
    const unitPrice = product.sellingPrice;
    const subtotal = unitPrice * createProductSaleDto.quantity;

    let discountAmount = 0;
    if (createProductSaleDto.discountType === DiscountType.PERCENTAGE) {
      discountAmount = (subtotal * createProductSaleDto.discountValue) / 100;
    } else if (
      createProductSaleDto.discountType === DiscountType.FIXED_AMOUNT
    ) {
      discountAmount = createProductSaleDto.discountValue;
    }

    // Validate discount doesn't exceed subtotal
    if (discountAmount > subtotal) {
      throw new BadRequestException('Discount cannot exceed subtotal');
    }

    const totalAmount = subtotal - discountAmount;

    // 4. Create revenue record FIRST
    const revenue = await this.revenuesService.create({
      branchId: createProductSaleDto.branchId,
      amount: totalAmount,
      description: `Product Sale: ${product.name} (x${createProductSaleDto.quantity})`,
      date: createProductSaleDto.date,
      paymentMethod: createProductSaleDto.paymentMethod,
      receiptNumber: createProductSaleDto.receiptNumber,
      notes: createProductSaleDto.notes
        ? `Automated from product sale. ${createProductSaleDto.notes}`
        : 'Automated from product sale',
    });

    // 5. Create product sale record
    const saleData = {
      ...createProductSaleDto,
      unitPrice,
      subtotal,
      discountAmount,
      totalAmount,
      revenueId: (revenue as any).id,
    };

    const productSale = await this.dataStore.create(
      FILE_PATHS.PRODUCT_SALES,
      DATA_KEYS.PRODUCT_SALES,
      saleData,
    );

    // 6. Reduce product stock
    await this.productsService.adjustStock(
      createProductSaleDto.productId,
      createProductSaleDto.quantity,
      'subtract',
    );

    return productSale;
  }

  async findAll(filters?: {
    branchId?: string;
    productId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const sales = await this.dataStore.findAll(
      FILE_PATHS.PRODUCT_SALES,
      DATA_KEYS.PRODUCT_SALES,
    );

    if (!filters) {
      return sales;
    }

    return (sales as any[]).filter((sale) => {
      if (filters.branchId && sale.branchId !== filters.branchId) {
        return false;
      }
      if (filters.productId && sale.productId !== filters.productId) {
        return false;
      }
      if (filters.startDate && sale.date < filters.startDate) {
        return false;
      }
      if (filters.endDate && sale.date > filters.endDate) {
        return false;
      }
      return true;
    });
  }

  async findOne(id: string) {
    const sale = await this.dataStore.findById(
      FILE_PATHS.PRODUCT_SALES,
      DATA_KEYS.PRODUCT_SALES,
      id,
    );

    if (!sale) {
      throw new NotFoundException(`Product sale with ID ${id} not found`);
    }

    return sale;
  }

  async update(id: string, updateProductSaleDto: UpdateProductSaleDto) {
    await this.findOne(id); // Verify sale exists

    // Only allow updating notes and receiptNumber
    return await this.dataStore.update(
      FILE_PATHS.PRODUCT_SALES,
      DATA_KEYS.PRODUCT_SALES,
      id,
      updateProductSaleDto,
    );
  }

  async remove(id: string) {
    // Sales should not be deleted to maintain audit trail
    throw new ForbiddenException(
      'Product sales cannot be deleted. Please contact system administrator if you need to cancel a sale.',
    );
  }

  async getSalesSummary(filters?: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const sales = (await this.findAll(filters)) as any[];

    const totalSales = sales.length;
    const totalRevenue = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);

    // Group by product
    const productMap = new Map<
      string,
      { productId: string; productName: string; quantity: number; revenue: number }
    >();

    for (const sale of sales) {
      const product = (await this.productsService.findOne(
        sale.productId,
      )) as any;
      const existing = productMap.get(sale.productId) || {
        productId: sale.productId,
        productName: product.name,
        quantity: 0,
        revenue: 0,
      };

      productMap.set(sale.productId, {
        ...existing,
        quantity: existing.quantity + sale.quantity,
        revenue: existing.revenue + sale.totalAmount,
      });
    }

    const byProduct = Array.from(productMap.values());

    return {
      totalSales,
      totalRevenue,
      totalQuantity,
      byProduct,
    };
  }

  async getTopProducts(filters?: { branchId?: string; limit?: number }) {
    const sales = (await this.findAll({
      branchId: filters?.branchId,
    })) as any[];

    // Group by product and sum quantities
    const productMap = new Map<string, { productId: string; quantity: number }>();

    for (const sale of sales) {
      const existing = productMap.get(sale.productId) || {
        productId: sale.productId,
        quantity: 0,
      };
      productMap.set(sale.productId, {
        ...existing,
        quantity: existing.quantity + sale.quantity,
      });
    }

    // Convert to array and sort by quantity
    let topProducts = Array.from(productMap.values()).sort(
      (a, b) => b.quantity - a.quantity,
    );

    // Apply limit
    if (filters?.limit) {
      topProducts = topProducts.slice(0, filters.limit);
    }

    // Enrich with product details
    const enrichedProducts = await Promise.all(
      topProducts.map(async (item) => {
        const product = (await this.productsService.findOne(
          item.productId,
        )) as any;
        return {
          productId: item.productId,
          productName: product.name,
          productCode: product.code,
          quantity: item.quantity,
        };
      }),
    );

    return enrichedProducts;
  }
}
