import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, IsDateString, ValidateNested, IsArray, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum DayOfWeek {
  SUNDAY = 'SUNDAY',
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
}

export class ClassScheduleDto {
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  days: DayOfWeek[];

  @IsString()
  @IsNotEmpty()
  startTime: string; // Format: "HH:mm" (24-hour)

  @IsString()
  @IsNotEmpty()
  endTime: string; // Format: "HH:mm" (24-hour)
}

export class CreateClassDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  teacherId: string;

  @ValidateNested()
  @Type(() => ClassScheduleDto)
  schedule: ClassScheduleDto;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxStudents?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
