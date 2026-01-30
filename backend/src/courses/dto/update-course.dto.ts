import { IsOptional, IsString, IsNumber, IsBoolean, Min } from 'class-validator';

export class UpdateCourseDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  price?: number;

  @IsString()
  @IsOptional()
  duration?: string;

  @IsString()
  @IsOptional()
  level?: string;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  maxStudents?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
