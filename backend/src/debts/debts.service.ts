import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { CreateDebtDto } from './dto/create-debt.dto';
import { UpdateDebtDto } from './dto/update-debt.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CashService } from '../cash/cash.service';

@Injectable()
export class DebtsService {
  constructor(
    private dataStore: DataStoreService,
    @Inject(forwardRef(() => CashService))
    private cashService: CashService,
  ) {}

  async create(createDebtDto: CreateDebtDto) {
    // Verify branch if provided
    if (createDebtDto.branchId) {
      const branch = await this.dataStore.findById(
        FILE_PATHS.BRANCHES,
        DATA_KEYS.BRANCHES,
        createDebtDto.branchId,
      );
      if (!branch) {
        throw new NotFoundException('Branch not found');
      }
    }

    // Create debt
    const debt = await this.dataStore.create(FILE_PATHS.DEBTS, DATA_KEYS.DEBTS, {
      ...createDebtDto,
      currentBalance: createDebtDto.principalAmount,
      totalInterestPaid: 0,
      totalPaid: 0,
      status: 'ACTIVE',
      isActive: true,
    });

    // Update cash state (positive amount - receiving loan)
    await this.cashService.updateCashState(
      createDebtDto.principalAmount,
      'DEBT_TAKEN',
      debt.id,
    );

    return debt;
  }

  async findAll(status?: string) {
    let debts = await this.dataStore.findAll(FILE_PATHS.DEBTS, DATA_KEYS.DEBTS);

    // Filter by status
    if (status) {
      debts = debts.filter((d: any) => d.status === status);
    }

    // Filter active only
    return debts.filter((d: any) => d.isActive);
  }

  async findOne(id: string, includePayments = false) {
    const debt = await this.dataStore.findById(
      FILE_PATHS.DEBTS,
      DATA_KEYS.DEBTS,
      id,
    );

    if (!debt) {
      throw new NotFoundException(`Debt with ID ${id} not found`);
    }

    if (includePayments) {
      const payments = await this.getPayments(id);
      return { ...debt, payments };
    }

    return debt;
  }

  async update(id: string, updateDebtDto: UpdateDebtDto) {
    await this.findOne(id); // Verify exists

    return await this.dataStore.update(
      FILE_PATHS.DEBTS,
      DATA_KEYS.DEBTS,
      id,
      updateDebtDto,
    );
  }

  async remove(id: string) {
    // Soft delete
    return await this.dataStore.update(FILE_PATHS.DEBTS, DATA_KEYS.DEBTS, id, {
      isActive: false,
    });
  }

  // Calculate interest on principal for a given period
  private calculateInterest(
    principal: number,
    annualRate: number,
    days: number,
  ): number {
    // Simple interest calculation: P * R * T
    // Where R is daily rate and T is days
    const dailyRate = annualRate / 100 / 365;
    return principal * dailyRate * days;
  }

  async createPayment(debtId: string, createPaymentDto: CreatePaymentDto) {
    const debt = (await this.findOne(debtId)) as any;

    if (debt.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot make payment on inactive debt');
    }

    // Calculate days since last payment (or since debt taken)
    const payments = await this.getPayments(debtId);
    const lastPaymentDate =
      payments.length > 0
        ? new Date((payments[payments.length - 1] as any).paymentDate)
        : new Date(debt.takenDate);

    const paymentDate = new Date(createPaymentDto.paymentDate);
    const daysSince = Math.floor(
      (paymentDate.getTime() - lastPaymentDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Calculate interest for this period
    const interestAmount = this.calculateInterest(
      debt.currentBalance,
      debt.interestRate,
      daysSince,
    );

    // Calculate principal payment (total - interest - late fee)
    const lateFee = createPaymentDto.lateFee || 0;
    const principalAmount = Math.max(
      0,
      createPaymentDto.totalAmount - interestAmount - lateFee,
    );

    // New balance
    const balanceAfter = Math.max(0, debt.currentBalance - principalAmount);

    // Create payment record
    const payment = await this.dataStore.create(
      FILE_PATHS.DEBT_PAYMENTS,
      DATA_KEYS.DEBT_PAYMENTS,
      {
        debtId,
        ...createPaymentDto,
        principalAmount,
        interestAmount,
        balanceAfter,
      },
    );

    // Update debt record
    const newStatus =
      balanceAfter === 0 ? 'PAID_OFF' : debt.status;
    await this.dataStore.update(FILE_PATHS.DEBTS, DATA_KEYS.DEBTS, debtId, {
      currentBalance: balanceAfter,
      totalInterestPaid: debt.totalInterestPaid + interestAmount,
      totalPaid: debt.totalPaid + createPaymentDto.totalAmount,
      status: newStatus,
    });

    // Update cash state (negative amount - paying debt)
    await this.cashService.updateCashState(
      -createPaymentDto.totalAmount,
      'DEBT_PAYMENT',
      payment.id,
    );

    return payment;
  }

  async getPayments(debtId: string) {
    await this.findOne(debtId); // Verify debt exists

    return await this.dataStore.findBy(
      FILE_PATHS.DEBT_PAYMENTS,
      DATA_KEYS.DEBT_PAYMENTS,
      (p: any) => p.debtId === debtId,
    );
  }

  async deletePayment(debtId: string, paymentId: string) {
    const debt = (await this.findOne(debtId)) as any;
    const payment = await this.dataStore.findById(
      FILE_PATHS.DEBT_PAYMENTS,
      DATA_KEYS.DEBT_PAYMENTS,
      paymentId,
    ) as any;

    if (!payment || payment.debtId !== debtId) {
      throw new NotFoundException('Payment not found for this debt');
    }

    // Check if payment is recent (within 24 hours)
    const paymentCreated = new Date(payment.createdAt);
    const now = new Date();
    const hoursSince = (now.getTime() - paymentCreated.getTime()) / (1000 * 60 * 60);

    if (hoursSince > 24) {
      throw new BadRequestException(
        'Cannot delete payment older than 24 hours',
      );
    }

    // Restore debt balance
    await this.dataStore.update(FILE_PATHS.DEBTS, DATA_KEYS.DEBTS, debtId, {
      currentBalance: debt.currentBalance + payment.principalAmount,
      totalInterestPaid: debt.totalInterestPaid - payment.interestAmount,
      totalPaid: debt.totalPaid - payment.totalAmount,
      status: 'ACTIVE',
    });

    // Delete payment
    await this.dataStore.delete(
      FILE_PATHS.DEBT_PAYMENTS,
      DATA_KEYS.DEBT_PAYMENTS,
      paymentId,
    );

    // Restore cash (positive amount)
    await this.cashService.updateCashState(
      payment.totalAmount,
      'DEBT_PAYMENT',
      `reversal-${paymentId}`,
    );

    return { message: 'Payment deleted and cash restored' };
  }

  async getSummary() {
    const debts = await this.findAll('ACTIVE');

    const totalDebt = (debts as any[]).reduce((sum, d) => sum + d.currentBalance, 0);
    const totalOriginal = (debts as any[]).reduce((sum, d) => sum + d.principalAmount, 0);
    const totalInterestPaid = (debts as any[]).reduce(
      (sum, d) => sum + d.totalInterestPaid,
      0,
    );

    return {
      totalOutstanding: totalDebt,
      totalBorrowed: totalOriginal,
      totalInterestPaid,
      activeDebtsCount: debts.length,
      debts,
    };
  }
}
