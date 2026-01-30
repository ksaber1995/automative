import { IsNumber, IsString, IsOptional, IsEnum, IsBoolean, IsDateString, Min, Max } from 'class-validator';
import { ExpenseCategory, DistributionMethod } from '../../../../shared/enums/expense-type.enum';

export class UpdateExpenseDto {
  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  date?: string;

  @IsEnum(ExpenseCategory)
  @IsOptional()
  category?: ExpenseCategory;

  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(31)
  recurringDay?: number;

  @IsEnum(DistributionMethod)
  @IsOptional()
  distributionMethod?: DistributionMethod;

  @IsString()
  @IsOptional()
  vendor?: string;

  @IsString()
  @IsOptional()
  invoiceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
