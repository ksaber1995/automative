import { Injectable, NotFoundException } from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@Injectable()
export class CoursesService {
  constructor(private dataStore: DataStoreService) {}

  async create(createCourseDto: CreateCourseDto) {
    // Verify branch exists
    const branch = await this.dataStore.findById(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      createCourseDto.branchId,
    );

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    const course = await this.dataStore.create(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      {
        ...createCourseDto,
        isActive: true,
      },
    );

    return course;
  }

  async findAll() {
    return await this.dataStore.findAll(FILE_PATHS.COURSES, DATA_KEYS.COURSES);
  }

  async findActive() {
    return await this.dataStore.findBy(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      (course: any) => course.isActive === true,
    );
  }

  async findByBranch(branchId: string) {
    return await this.dataStore.findBy(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      (course: any) => course.branchId === branchId,
    );
  }

  async findOne(id: string) {
    const course = await this.dataStore.findById(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      id,
    );

    if (!course) {
      throw new NotFoundException(`Course with ID ${id} not found`);
    }

    return course;
  }

  async update(id: string, updateCourseDto: UpdateCourseDto) {
    if (updateCourseDto.branchId) {
      const branch = await this.dataStore.findById(
        FILE_PATHS.BRANCHES,
        DATA_KEYS.BRANCHES,
        updateCourseDto.branchId,
      );

      if (!branch) {
        throw new NotFoundException('Branch not found');
      }
    }

    return await this.dataStore.update(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      id,
      updateCourseDto as any,
    );
  }

  async remove(id: string) {
    return await this.dataStore.update(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      id,
      { isActive: false } as any,
    );
  }

  async getEnrollments(id: string) {
    await this.findOne(id);

    return await this.dataStore.findBy(
      FILE_PATHS.ENROLLMENTS,
      DATA_KEYS.ENROLLMENTS,
      (enrollment: any) => enrollment.courseId === id,
    );
  }
}
