import { IsNumber, IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString, Min } from 'class-validator';

export enum PaymentMethod {
  CASH = 'CASH',
  CHECK = 'CHECK',
  BANK_TRANSFER = 'BANK_TRANSFER',
  AUTO_DEBIT = 'AUTO_DEBIT',
  OTHER = 'OTHER',
}

export class CreatePaymentDto {
  @IsDateString()
  paymentDate: string;

  @IsNumber()
  @Min(0.01)
  totalAmount: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  lateFee?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
