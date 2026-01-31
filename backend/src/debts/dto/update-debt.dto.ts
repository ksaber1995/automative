import { IsString, IsOptional, IsEnum, IsDateString, IsNumber, Min } from 'class-validator';
import { PaymentSchedule } from './create-debt.dto';

export enum DebtStatus {
  ACTIVE = 'ACTIVE',
  PAID_OFF = 'PAID_OFF',
  DEFAULTED = 'DEFAULTED',
  REFINANCED = 'REFINANCED',
}

export class UpdateDebtDto {
  @IsOptional()
  @IsString()
  creditorName?: string;

  @IsOptional()
  @IsString()
  creditorContact?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  interestRate?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(PaymentSchedule)
  paymentSchedule?: PaymentSchedule;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumPayment?: number;

  @IsOptional()
  @IsEnum(DebtStatus)
  status?: DebtStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
