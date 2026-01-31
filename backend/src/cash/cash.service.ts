import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { AdjustCashDto } from './dto/adjust-cash.dto';

@Injectable()
export class CashService {
  async getCurrentCash() {
    const cashState = await this.getCashState();
    return {
      currentCash: cashState.currentCash,
      lastUpdated: cashState.lastUpdated,
      lastTransactionType: cashState.lastTransactionType,
    };
  }

  async getCashState() {
    try {
      const fileContent = await fs.readFile(FILE_PATHS.CASH_STATE, 'utf-8');
      const data = JSON.parse(fileContent);
      return data[DATA_KEYS.CASH_STATE];
    } catch (error) {
      // If file doesn't exist, return default cash state
      return {
        id: 'cash-state-001',
        currentCash: 0,
        lastUpdated: new Date().toISOString(),
        lastTransactionId: null,
        lastTransactionType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async updateCashState(
    amount: number,
    transactionType: string,
    transactionId: string,
  ) {
    const cashState = await this.getCashState();
    const newCash = cashState.currentCash + amount;

    const updated = {
      ...cashState,
      currentCash: newCash,
      lastUpdated: new Date().toISOString(),
      lastTransactionId: transactionId,
      lastTransactionType: transactionType,
      updatedAt: new Date().toISOString(),
    };

    const fileContent = JSON.stringify(
      { [DATA_KEYS.CASH_STATE]: updated },
      null,
      2,
    );
    await fs.writeFile(FILE_PATHS.CASH_STATE, fileContent, 'utf-8');

    return updated;
  }

  async adjustCash(adjustCashDto: AdjustCashDto) {
    const result = await this.updateCashState(
      adjustCashDto.amount,
      'MANUAL_ADJUSTMENT',
      `adjustment-${Date.now()}`,
    );

    return {
      ...result,
      adjustment: adjustCashDto,
    };
  }

  async getCashFlow(startDate?: string, endDate?: string) {
    // TODO: Implement cash flow statement
    // This would aggregate all transactions (revenues, expenses, withdrawals, debts)
    // and show cash movement over time
    return {
      startDate,
      endDate,
      items: [],
    };
  }
}
