export interface WithdrawalStakeholder {
  stakeholderName: string;
  stakeholderEmail?: string;
  amount: number;
}

export interface Withdrawal {
  id: string;
  companyId: string;
  amount: number;
  stakeholders: WithdrawalStakeholder[];
  withdrawalDate: string;
  reason: string;
  category: WithdrawalCategory;
  paymentMethod: PaymentMethod;
  approvedBy: string;
  notes?: string;
  receiptUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export enum WithdrawalCategory {
  OWNER_DRAW = 'OWNER_DRAW',
  PROFIT_DISTRIBUTION = 'PROFIT_DISTRIBUTION',
  DIVIDEND = 'DIVIDEND',
  OTHER = 'OTHER',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CHECK = 'CHECK',
  BANK_TRANSFER = 'BANK_TRANSFER',
  OTHER = 'OTHER',
}

export interface WithdrawalCreateDto {
  amount: number;
  stakeholders: WithdrawalStakeholder[];
  withdrawalDate: string;
  reason: string;
  category: WithdrawalCategory;
  paymentMethod: PaymentMethod;
  notes?: string;
}

export interface WithdrawalUpdateDto {
  stakeholders?: WithdrawalStakeholder[];
  reason?: string;
  category?: WithdrawalCategory;
  paymentMethod?: PaymentMethod;
  notes?: string;
}
