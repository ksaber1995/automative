import { Injectable } from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';

@Injectable()
export class RevenuesService {
  constructor(private dataStore: DataStoreService) {}

  async findAll(filters?: { branchId?: string; startDate?: string; endDate?: string }) {
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

  async getSummary(filters?: { branchId?: string; startDate?: string; endDate?: string }) {
    const revenues = await this.findAll(filters);

    const total = revenues.reduce((sum: number, rev: any) => sum + rev.amount, 0);
    const count = revenues.length;
    const average = count > 0 ? total / count : 0;

    const byPaymentMethod = revenues.reduce((acc: any, rev: any) => {
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
}
