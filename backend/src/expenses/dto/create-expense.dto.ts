import { IsNotEmpty, IsNumber, IsString, IsOptional, IsEnum, IsBoolean, IsDateString, Min, Max } from 'class-validator';
import { ExpenseType, ExpenseCategory, DistributionMethod } from '../../../../shared/enums/expense-type.enum';

export class CreateExpenseDto {
  @IsString()
  @IsOptional()
  branchId?: string | null;

  @IsEnum(ExpenseType)
  @IsNotEmpty()
  type: ExpenseType;

  @IsEnum(ExpenseCategory)
  @IsNotEmpty()
  category: ExpenseCategory;

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

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
