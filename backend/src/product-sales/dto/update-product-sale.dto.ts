import { IsString, IsOptional } from 'class-validator';

export class UpdateProductSaleDto {
  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  receiptNumber?: string;
}
