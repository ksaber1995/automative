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
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Post()
  @Roles('ADMIN', 'BRANCH_MANAGER')
  create(@Body() createClassDto: CreateClassDto) {
    return this.classesService.create(createClassDto);
  }

  @Get()
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('courseId') courseId?: string,
    @Query('branchId') branchId?: string,
    @Query('teacherId') teacherId?: string,
  ) {
    if (courseId) {
      return this.classesService.findByCourse(courseId);
    }
    if (teacherId) {
      return this.classesService.findByTeacher(teacherId);
    }
    if (branchId) {
      return this.classesService.findByBranch(branchId);
    }
    return this.classesService.findAll();
  }

  @Get('active')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findActive() {
    return this.classesService.findActive();
  }

  @Get(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string, @Query('details') details?: string) {
    if (details === 'true') {
      return this.classesService.findOneWithDetails(id);
    }
    return this.classesService.findOne(id);
  }

  @Get(':id/enrollments')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getEnrollments(@Param('id') id: string) {
    return this.classesService.getEnrollments(id);
  }

  @Get(':id/students')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getStudents(@Param('id') id: string) {
    return this.classesService.getStudents(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() updateClassDto: UpdateClassDto) {
    return this.classesService.update(id, updateClassDto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  remove(@Param('id') id: string) {
    return this.classesService.remove(id);
  }
}
