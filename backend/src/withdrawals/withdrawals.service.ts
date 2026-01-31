import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { UpdateWithdrawalDto } from './dto/update-withdrawal.dto';
import { CashService } from '../cash/cash.service';

@Injectable()
export class WithdrawalsService {
  constructor(
    private dataStore: DataStoreService,
    @Inject(forwardRef(() => CashService))
    private cashService: CashService,
  ) {}

  async create(createWithdrawalDto: CreateWithdrawalDto, userId: string) {
    // Validate stakeholders sum equals total amount
    const stakeholdersTotal = createWithdrawalDto.stakeholders.reduce(
      (sum, s) => sum + s.amount,
      0,
    );
    if (Math.abs(stakeholdersTotal - createWithdrawalDto.amount) > 0.01) {
      throw new BadRequestException(
        `Stakeholders total ($${stakeholdersTotal}) must equal withdrawal amount ($${createWithdrawalDto.amount})`,
      );
    }

    // Check if sufficient cash available
    const cashState = await this.cashService.getCashState();
    if (cashState.currentCash < createWithdrawalDto.amount) {
      throw new BadRequestException(
        `Insufficient cash. Available: $${cashState.currentCash.toFixed(2)}, Requested: $${createWithdrawalDto.amount.toFixed(2)}`,
      );
    }

    // Create withdrawal
    const withdrawal = await this.dataStore.create(
      FILE_PATHS.WITHDRAWALS,
      DATA_KEYS.WITHDRAWALS,
      {
        ...createWithdrawalDto,
        approvedBy: userId,
        isActive: true,
      },
    );

    // Update cash state (negative amount to decrease cash)
    await this.cashService.updateCashState(
      -createWithdrawalDto.amount,
      'WITHDRAWAL',
      withdrawal.id,
    );

    return withdrawal;
  }

  async findAll(startDate?: string, endDate?: string, stakeholder?: string) {
    let withdrawals = await this.dataStore.findAll(
      FILE_PATHS.WITHDRAWALS,
      DATA_KEYS.WITHDRAWALS,
    );

    // Filter by date range
    if (startDate || endDate) {
      withdrawals = withdrawals.filter((w: any) => {
        const wDate = new Date(w.withdrawalDate);
        if (startDate && wDate < new Date(startDate)) return false;
        if (endDate && wDate > new Date(endDate)) return false;
        return true;
      });
    }

    // Filter by stakeholder
    if (stakeholder) {
      withdrawals = withdrawals.filter(
        (w: any) =>
          w.stakeholderName.toLowerCase().includes(stakeholder.toLowerCase()),
      );
    }

    // Filter active only
    return withdrawals.filter((w: any) => w.isActive);
  }

  async findOne(id: string) {
    const withdrawal = await this.dataStore.findById(
      FILE_PATHS.WITHDRAWALS,
      DATA_KEYS.WITHDRAWALS,
      id,
    );

    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal with ID ${id} not found`);
    }

    return withdrawal;
  }

  async update(id: string, updateWithdrawalDto: UpdateWithdrawalDto) {
    await this.findOne(id); // Verify exists

    // Check if withdrawal is recent (within 24 hours)
    const withdrawal = await this.dataStore.findById(
      FILE_PATHS.WITHDRAWALS,
      DATA_KEYS.WITHDRAWALS,
      id,
    ) as any;

    const withdrawalDate = new Date(withdrawal.createdAt);
    const now = new Date();
    const hoursSince = (now.getTime() - withdrawalDate.getTime()) / (1000 * 60 * 60);

    if (hoursSince > 24) {
      throw new BadRequestException(
        'Cannot update withdrawal older than 24 hours',
      );
    }

    return await this.dataStore.update(
      FILE_PATHS.WITHDRAWALS,
      DATA_KEYS.WITHDRAWALS,
      id,
      updateWithdrawalDto,
    );
  }

  async remove(id: string) {
    const withdrawal = await this.findOne(id) as any;

    // Check if withdrawal is recent (within 24 hours)
    const withdrawalDate = new Date(withdrawal.createdAt);
    const now = new Date();
    const hoursSince = (now.getTime() - withdrawalDate.getTime()) / (1000 * 60 * 60);

    if (hoursSince > 24) {
      throw new BadRequestException(
        'Cannot delete withdrawal older than 24 hours',
      );
    }

    // Soft delete
    await this.dataStore.update(
      FILE_PATHS.WITHDRAWALS,
      DATA_KEYS.WITHDRAWALS,
      id,
      { isActive: false },
    );

    // Restore cash (positive amount to increase cash)
    await this.cashService.updateCashState(
      withdrawal.amount,
      'WITHDRAWAL',
      `reversal-${id}`,
    );

    return { message: 'Withdrawal deleted and cash restored' };
  }

  async getByStakeholder(name: string) {
    const withdrawals = await this.dataStore.findBy(
      FILE_PATHS.WITHDRAWALS,
      DATA_KEYS.WITHDRAWALS,
      (w: any) =>
        w.stakeholders.some((s: any) =>
          s.stakeholderName.toLowerCase().includes(name.toLowerCase())
        ) && w.isActive,
    );

    return withdrawals;
  }

  async getSummary(startDate?: string, endDate?: string) {
    const withdrawals = await this.findAll(startDate, endDate);

    const totalAmount = (withdrawals as any[]).reduce((sum, w) => sum + w.amount, 0);

    // Group by category
    const categoryMap = (withdrawals as any[]).reduce((acc, w) => {
      if (!acc[w.category]) {
        acc[w.category] = { amount: 0, count: 0 };
      }
      acc[w.category].amount += w.amount;
      acc[w.category].count += 1;
      return acc;
    }, {});

    const byCategory = Object.entries(categoryMap).map(([category, data]: [string, any]) => ({
      category,
      amount: data.amount,
      count: data.count,
    }));

    // Group by stakeholder
    const stakeholderMap = new Map<string, { amount: number; count: number }>();
    (withdrawals as any[]).forEach(w => {
      w.stakeholders.forEach((s: any) => {
        const existing = stakeholderMap.get(s.stakeholderName) || { amount: 0, count: 0 };
        stakeholderMap.set(s.stakeholderName, {
          amount: existing.amount + s.amount,
          count: existing.count + 1,
        });
      });
    });

    const byStakeholder = Array.from(stakeholderMap.entries()).map(([name, data]) => ({
      name,
      amount: data.amount,
      count: data.count,
    }));

    return {
      totalWithdrawals: withdrawals.length,
      totalAmount,
      byCategory,
      byStakeholder,
      withdrawals,
    };
  }
}
