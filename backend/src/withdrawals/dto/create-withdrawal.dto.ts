import { IsNumber, IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString, IsEmail, Min, IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

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

export class WithdrawalStakeholderDto {
  @IsString()
  @IsNotEmpty()
  stakeholderName: string;

  @IsOptional()
  @IsEmail()
  stakeholderEmail?: string;

  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WithdrawalStakeholderDto)
  stakeholders: WithdrawalStakeholderDto[];

  @IsDateString()
  withdrawalDate: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsEnum(WithdrawalCategory)
  category: WithdrawalCategory;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;
}
