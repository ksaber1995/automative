import { IsNumber, IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString, Min } from 'class-validator';

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

export class CreateDebtDto {
  @IsEnum(DebtType)
  debtType: DebtType;

  @IsString()
  @IsNotEmpty()
  creditorName: string;

  @IsOptional()
  @IsString()
  creditorContact?: string;

  @IsNumber()
  @Min(0.01)
  principalAmount: number;

  @IsNumber()
  @Min(0)
  interestRate: number;

  @IsEnum(CompoundingFrequency)
  compoundingFrequency: CompoundingFrequency;

  @IsDateString()
  takenDate: string;

  @IsDateString()
  dueDate: string;

  @IsEnum(PaymentSchedule)
  paymentSchedule: PaymentSchedule;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumPayment?: number;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  collateral?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
