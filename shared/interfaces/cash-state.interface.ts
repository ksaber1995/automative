export interface CashState {
  id: string;
  currentCash: number;
  lastUpdated: string;
  lastTransactionId: string | null;
  lastTransactionType: 'REVENUE' | 'EXPENSE' | 'WITHDRAWAL' | 'DEBT_TAKEN' | 'DEBT_PAYMENT' | 'MANUAL_ADJUSTMENT' | null;
  createdAt: string;
  updatedAt: string;
}

export interface CashAdjustment {
  amount: number; // Can be positive or negative
  reason: string;
  adjustmentType: 'CORRECTION' | 'INITIAL_BALANCE' | 'OTHER';
}

export interface CashFlowItem {
  id: string;
  date: string;
  type: 'REVENUE' | 'EXPENSE' | 'WITHDRAWAL' | 'DEBT_TAKEN' | 'DEBT_PAYMENT' | 'MANUAL_ADJUSTMENT';
  amount: number; // Positive for increases, negative for decreases
  description: string;
  balanceAfter: number;
}
