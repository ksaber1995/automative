import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private dataStore: DataStoreService) {}

  async create(createProductDto: CreateProductDto) {
    // Validate: if isGlobal=true, branchId must be null
    if (createProductDto.isGlobal && createProductDto.branchId) {
      throw new BadRequestException(
        'Global products cannot have a branchId. Set branchId to null.',
      );
    }

    // Validate: if isGlobal=false, branchId is required
    if (!createProductDto.isGlobal && !createProductDto.branchId) {
      throw new BadRequestException(
        'Branch-specific products must have a branchId.',
      );
    }

    // Validate branch exists if branchId provided
    if (createProductDto.branchId) {
      const branch = await this.dataStore.findById(
        FILE_PATHS.BRANCHES,
        DATA_KEYS.BRANCHES,
        createProductDto.branchId,
      );
      if (!branch) {
        throw new NotFoundException('Branch not found');
      }
    }

    // Check if product code already exists
    const existingProduct = await this.dataStore.findOneBy(
      FILE_PATHS.PRODUCTS,
      DATA_KEYS.PRODUCTS,
      (product: any) => product.code === createProductDto.code,
    );

    if (existingProduct) {
      throw new BadRequestException(
        `Product with code ${createProductDto.code} already exists`,
      );
    }

    const product = await this.dataStore.create(
      FILE_PATHS.PRODUCTS,
      DATA_KEYS.PRODUCTS,
      {
        ...createProductDto,
        branchId: createProductDto.isGlobal ? null : createProductDto.branchId,
        isActive: true,
      },
    );

    return product;
  }

  async findAll(filters?: {
    branchId?: string;
    isGlobal?: boolean;
    category?: string;
    isActive?: boolean;
  }) {
    const products = await this.dataStore.findAll(
      FILE_PATHS.PRODUCTS,
      DATA_KEYS.PRODUCTS,
    );

    if (!filters) {
      return products;
    }

    return (products as any[]).filter((product) => {
      if (filters.branchId !== undefined && product.branchId !== filters.branchId) {
        return false;
      }
      if (filters.isGlobal !== undefined && product.isGlobal !== filters.isGlobal) {
        return false;
      }
      if (filters.category && product.category !== filters.category) {
        return false;
      }
      if (filters.isActive !== undefined && product.isActive !== filters.isActive) {
        return false;
      }
      return true;
    });
  }

  async findAvailableForBranch(branchId: string) {
    // Returns global products + products for this specific branch
    const products = await this.dataStore.findBy(
      FILE_PATHS.PRODUCTS,
      DATA_KEYS.PRODUCTS,
      (product: any) =>
        product.isActive &&
        (product.isGlobal || product.branchId === branchId),
    );

    return products;
  }

  async findOne(id: string) {
    const product = await this.dataStore.findById(
      FILE_PATHS.PRODUCTS,
      DATA_KEYS.PRODUCTS,
      id,
    );

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    await this.findOne(id); // Verify product exists

    return await this.dataStore.update(
      FILE_PATHS.PRODUCTS,
      DATA_KEYS.PRODUCTS,
      id,
      updateProductDto,
    );
  }

  async remove(id: string) {
    await this.findOne(id); // Verify product exists

    // Soft delete
    return await this.dataStore.update(
      FILE_PATHS.PRODUCTS,
      DATA_KEYS.PRODUCTS,
      id,
      { isActive: false },
    );
  }

  async adjustStock(
    productId: string,
    quantity: number,
    operation: 'add' | 'subtract',
  ) {
    const product = (await this.findOne(productId)) as any;

    let newStock: number;
    if (operation === 'add') {
      newStock = product.stock + quantity;
    } else {
      newStock = product.stock - quantity;
      if (newStock < 0) {
        throw new BadRequestException(
          `Insufficient stock. Available: ${product.stock}, Requested: ${quantity}`,
        );
      }
    }

    return await this.dataStore.update(
      FILE_PATHS.PRODUCTS,
      DATA_KEYS.PRODUCTS,
      productId,
      { stock: newStock },
    );
  }

  async checkStockAvailability(
    productId: string,
    quantity: number,
  ): Promise<boolean> {
    const product = (await this.findOne(productId)) as any;
    return product.stock >= quantity;
  }

  async getLowStockProducts(branchId?: string) {
    const products = await this.dataStore.findBy(
      FILE_PATHS.PRODUCTS,
      DATA_KEYS.PRODUCTS,
      (product: any) => {
        if (!product.isActive) return false;
        if (product.stock > product.minStock) return false;

        // If branchId provided, filter by branch (including global)
        if (branchId) {
          return product.isGlobal || product.branchId === branchId;
        }

        return true;
      },
    );

    return products;
  }
}
