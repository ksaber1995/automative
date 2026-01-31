import { IsString, IsOptional, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { WithdrawalCategory, PaymentMethod, WithdrawalStakeholderDto } from './create-withdrawal.dto';

export class UpdateWithdrawalDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WithdrawalStakeholderDto)
  stakeholders?: WithdrawalStakeholderDto[];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsEnum(WithdrawalCategory)
  category?: WithdrawalCategory;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;
}
