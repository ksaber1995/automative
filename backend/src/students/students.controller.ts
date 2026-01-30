import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { EnrollStudentDto } from './dto/enroll-student.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post()
  @Roles('ADMIN', 'BRANCH_MANAGER')
  create(@Body() createStudentDto: CreateStudentDto) {
    return this.studentsService.create(createStudentDto);
  }

  @Get()
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(@Query('branchId') branchId?: string) {
    if (branchId) {
      return this.studentsService.findByBranch(branchId);
    }
    return this.studentsService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.studentsService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() updateStudentDto: UpdateStudentDto) {
    return this.studentsService.update(id, updateStudentDto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  remove(@Param('id') id: string) {
    return this.studentsService.remove(id);
  }

  @Post(':id/enroll')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  enrollStudent(@Param('id') id: string, @Body() enrollDto: EnrollStudentDto) {
    return this.studentsService.enrollStudent(id, enrollDto);
  }

  @Get(':id/enrollments')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getEnrollments(@Param('id') id: string) {
    return this.studentsService.getEnrollments(id);
  }

  @Patch(':id/enrollments/:enrollmentId')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  updateEnrollment(
    @Param('id') id: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body() updateData: any,
  ) {
    return this.studentsService.updateEnrollment(id, enrollmentId, updateData);
  }

  @Delete(':id/enrollments/:enrollmentId')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  deleteEnrollment(
    @Param('id') id: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.studentsService.deleteEnrollment(id, enrollmentId);
  }
}
