import { IsNumber, IsString, IsNotEmpty, IsEnum } from 'class-validator';

export enum AdjustmentType {
  CORRECTION = 'CORRECTION',
  INITIAL_BALANCE = 'INITIAL_BALANCE',
  OTHER = 'OTHER',
}

export class AdjustCashDto {
  @IsNumber()
  amount: number; // Can be positive or negative

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsEnum(AdjustmentType)
  adjustmentType: AdjustmentType;
}
