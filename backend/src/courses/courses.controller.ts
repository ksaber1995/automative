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
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  @Roles('ADMIN', 'BRANCH_MANAGER')
  create(@Body() createCourseDto: CreateCourseDto) {
    return this.coursesService.create(createCourseDto);
  }

  @Get()
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(@Query('branchId') branchId?: string) {
    if (branchId) {
      return this.coursesService.findByBranch(branchId);
    }
    return this.coursesService.findAll();
  }

  @Get('active')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findActive() {
    return this.coursesService.findActive();
  }

  @Get(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.coursesService.findOne(id);
  }

  @Get(':id/enrollments')
  @Roles('ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getEnrollments(@Param('id') id: string) {
    return this.coursesService.getEnrollments(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() updateCourseDto: UpdateCourseDto) {
    return this.coursesService.update(id, updateCourseDto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'BRANCH_MANAGER')
  remove(@Param('id') id: string) {
    return this.coursesService.remove(id);
  }
}
