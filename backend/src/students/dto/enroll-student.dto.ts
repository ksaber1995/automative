import { IsNotEmpty, IsString, IsNumber, IsOptional, Min, Max, IsDateString } from 'class-validator';

export class EnrollStudentDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsDateString()
  @IsNotEmpty()
  enrollmentDate: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  discountAmount?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
