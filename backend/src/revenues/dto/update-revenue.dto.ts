import { IsNumber, IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { PaymentMethod } from '../../../../shared/enums/enrollment-status.enum';

export class UpdateRevenueDto {
  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  date?: string;

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @IsString()
  @IsOptional()
  receiptNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
