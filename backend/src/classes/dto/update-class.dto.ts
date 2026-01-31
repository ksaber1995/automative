import { IsString, IsOptional, IsNumber, Min, IsDateString, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ClassScheduleDto } from './create-class.dto';

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClassScheduleDto)
  schedule?: ClassScheduleDto;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxStudents?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
