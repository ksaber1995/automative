import { Injectable, NotFoundException } from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { CreateRevenueDto } from './dto/create-revenue.dto';
import { UpdateRevenueDto } from './dto/update-revenue.dto';

interface RevenueFilters {
  branchId?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class RevenuesService {
  constructor(private dataStore: DataStoreService) {}

  async findAll(filters?: RevenueFilters): Promise<any[]> {
    let revenues = await this.dataStore.findAll(FILE_PATHS.REVENUES, DATA_KEYS.REVENUES);

    if (filters) {
      revenues = revenues.filter((rev: any) => {
        let match = true;

        if (filters.branchId) {
          match = match && rev.branchId === filters.branchId;
        }

        if (filters.startDate) {
          match = match && new Date(rev.date) >= new Date(filters.startDate);
        }

        if (filters.endDate) {
          match = match && new Date(rev.date) <= new Date(filters.endDate);
        }

        return match;
      });
    }

    return revenues;
  }

  async getSummary(filters?: RevenueFilters): Promise<{
    total: number;
    count: number;
    average: number;
    byPaymentMethod: Record<string, number>;
  }> {
    const revenues = await this.findAll(filters);

    const total = revenues.reduce((sum: number, rev: any) => sum + rev.amount, 0);
    const count = revenues.length;
    const average = count > 0 ? total / count : 0;

    const byPaymentMethod = revenues.reduce((acc: Record<string, number>, rev: any) => {
      const method = rev.paymentMethod;
      acc[method] = (acc[method] || 0) + rev.amount;
      return acc;
    }, {});

    return {
      total,
      count,
      average,
      byPaymentMethod,
    };
  }

  async create(createRevenueDto: CreateRevenueDto) {
    return await this.dataStore.create(
      FILE_PATHS.REVENUES,
      DATA_KEYS.REVENUES,
      createRevenueDto,
    );
  }

  async findOne(id: string) {
    const revenue = await this.dataStore.findById(
      FILE_PATHS.REVENUES,
      DATA_KEYS.REVENUES,
      id,
    );

    if (!revenue) {
      throw new NotFoundException(`Revenue with ID ${id} not found`);
    }

    return revenue;
  }

  async update(id: string, updateRevenueDto: UpdateRevenueDto) {
    return await this.dataStore.update(
      FILE_PATHS.REVENUES,
      DATA_KEYS.REVENUES,
      id,
      updateRevenueDto,
    );
  }

  async remove(id: string) {
    return await this.dataStore.delete(
      FILE_PATHS.REVENUES,
      DATA_KEYS.REVENUES,
      id,
    );
  }
}
