export interface Debt {
  id: string;
  debtType: DebtType;
  creditorName: string;
  creditorContact?: string;
  principalAmount: number;
  interestRate: number; // Annual percentage (e.g., 5.5 for 5.5%)
  compoundingFrequency: CompoundingFrequency;
  takenDate: string;
  dueDate: string;
  paymentSchedule: PaymentSchedule;
  minimumPayment?: number;
  currentBalance: number;
  totalInterestPaid: number;
  totalPaid: number;
  status: DebtStatus;
  branchId?: string;
  collateral?: string;
  notes?: string;
  contractUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export enum DebtType {
  BANK_LOAN = 'BANK_LOAN',
  LINE_OF_CREDIT = 'LINE_OF_CREDIT',
  INVESTOR_LOAN = 'INVESTOR_LOAN',
  VENDOR_CREDIT = 'VENDOR_CREDIT',
  OTHER = 'OTHER',
}

export enum CompoundingFrequency {
  DAILY = 'DAILY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  ANNUALLY = 'ANNUALLY',
}

export enum PaymentSchedule {
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  ANNUALLY = 'ANNUALLY',
  LUMP_SUM = 'LUMP_SUM',
}

export enum DebtStatus {
  ACTIVE = 'ACTIVE',
  PAID_OFF = 'PAID_OFF',
  DEFAULTED = 'DEFAULTED',
  REFINANCED = 'REFINANCED',
}

export interface DebtPayment {
  id: string;
  debtId: string;
  paymentDate: string;
  totalAmount: number;
  principalAmount: number;
  interestAmount: number;
  lateFee?: number;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  balanceAfter: number;
  notes?: string;
  receiptUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export enum PaymentMethod {
  CASH = 'CASH',
  CHECK = 'CHECK',
  BANK_TRANSFER = 'BANK_TRANSFER',
  AUTO_DEBIT = 'AUTO_DEBIT',
  OTHER = 'OTHER',
}

export interface DebtCreateDto {
  debtType: DebtType;
  creditorName: string;
  creditorContact?: string;
  principalAmount: number;
  interestRate: number;
  compoundingFrequency: CompoundingFrequency;
  takenDate: string;
  dueDate: string;
  paymentSchedule: PaymentSchedule;
  minimumPayment?: number;
  branchId?: string;
  collateral?: string;
  notes?: string;
}

export interface DebtUpdateDto {
  creditorName?: string;
  creditorContact?: string;
  interestRate?: number;
  dueDate?: string;
  paymentSchedule?: PaymentSchedule;
  minimumPayment?: number;
  status?: DebtStatus;
  notes?: string;
}

export interface DebtPaymentCreateDto {
  paymentDate: string;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  lateFee?: number;
  notes?: string;
}

export interface DebtWithPayments extends Debt {
  payments?: DebtPayment[];
  nextPaymentDue?: string;
  paymentsDue?: number;
}
