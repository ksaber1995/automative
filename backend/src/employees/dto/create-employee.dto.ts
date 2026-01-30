import { IsNotEmpty, IsString, IsEmail, IsNumber, IsOptional, IsBoolean, IsDateString, Min } from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  position: string;

  @IsString()
  @IsNotEmpty()
  department: string;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsBoolean()
  @IsNotEmpty()
  isGlobal: boolean;

  @IsNumber()
  @Min(0)
  salary: number;

  @IsDateString()
  @IsNotEmpty()
  hireDate: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
