import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';

@Injectable()
export class ClassesService {
  constructor(private dataStore: DataStoreService) {}

  async create(createClassDto: CreateClassDto) {
    // Verify course exists and is active
    const course = await this.dataStore.findById(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      createClassDto.courseId,
    );

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (!(course as any).isActive) {
      throw new BadRequestException('Cannot create class for inactive course');
    }

    // Verify teacher (employee) exists and is active
    const teacher = await this.dataStore.findById(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      createClassDto.teacherId,
    );

    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }

    if (!(teacher as any).isActive) {
      throw new BadRequestException('Cannot assign inactive teacher to class');
    }

    // Validate schedule times
    if (createClassDto.schedule.startTime >= createClassDto.schedule.endTime) {
      throw new BadRequestException('Start time must be before end time');
    }

    // Validate dates
    if (new Date(createClassDto.startDate) >= new Date(createClassDto.endDate)) {
      throw new BadRequestException('Start date must be before end date');
    }

    // Create class with course's branchId
    const classData = await this.dataStore.create(
      FILE_PATHS.CLASSES,
      DATA_KEYS.CLASSES,
      {
        ...createClassDto,
        branchId: (course as any).branchId,
        isActive: true,
      },
    );

    return classData;
  }

  async findAll() {
    return await this.dataStore.findAll(FILE_PATHS.CLASSES, DATA_KEYS.CLASSES);
  }

  async findActive() {
    return await this.dataStore.findBy(
      FILE_PATHS.CLASSES,
      DATA_KEYS.CLASSES,
      (classItem: any) => classItem.isActive === true,
    );
  }

  async findByCourse(courseId: string) {
    // Verify course exists
    const course = await this.dataStore.findById(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      courseId,
    );

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    return await this.dataStore.findBy(
      FILE_PATHS.CLASSES,
      DATA_KEYS.CLASSES,
      (classItem: any) => classItem.courseId === courseId,
    );
  }

  async findByTeacher(teacherId: string) {
    return await this.dataStore.findBy(
      FILE_PATHS.CLASSES,
      DATA_KEYS.CLASSES,
      (classItem: any) => classItem.teacherId === teacherId && classItem.isActive,
    );
  }

  async findByBranch(branchId: string) {
    return await this.dataStore.findBy(
      FILE_PATHS.CLASSES,
      DATA_KEYS.CLASSES,
      (classItem: any) => classItem.branchId === branchId,
    );
  }

  async findOne(id: string) {
    const classData = await this.dataStore.findById(
      FILE_PATHS.CLASSES,
      DATA_KEYS.CLASSES,
      id,
    );

    if (!classData) {
      throw new NotFoundException(`Class with ID ${id} not found`);
    }

    return classData;
  }

  async findOneWithDetails(id: string) {
    const classData = await this.findOne(id) as any;

    // Get course info
    const course = await this.dataStore.findById(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      classData.courseId,
    ) as any;

    // Get teacher info
    const teacher = await this.dataStore.findById(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      classData.teacherId,
    ) as any;

    // Get enrollments for this class
    const enrollments = await this.dataStore.findBy(
      FILE_PATHS.ENROLLMENTS,
      DATA_KEYS.ENROLLMENTS,
      (enrollment: any) => enrollment.classId === id,
    );

    // Get student details for each enrollment
    const students = await Promise.all(
      enrollments.map(async (enrollment: any) => {
        const student = await this.dataStore.findById(
          FILE_PATHS.STUDENTS,
          DATA_KEYS.STUDENTS,
          enrollment.studentId,
        ) as any;
        return {
          id: student?.id,
          firstName: student?.firstName,
          lastName: student?.lastName,
          enrollmentId: enrollment.id,
          enrollmentDate: enrollment.enrollmentDate,
          paymentStatus: enrollment.paymentStatus,
        };
      }),
    );

    return {
      ...classData,
      course: course ? {
        id: course.id,
        name: course.name,
        code: course.code,
      } : null,
      teacher: teacher ? {
        id: teacher.id,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        email: teacher.email,
      } : null,
      studentCount: students.length,
      students: students.filter(s => s.id), // Filter out students that weren't found
    };
  }

  async update(id: string, updateClassDto: UpdateClassDto) {
    // Verify class exists
    await this.findOne(id);

    // If updating teacher, verify teacher exists and is active
    if (updateClassDto.teacherId) {
      const teacher = await this.dataStore.findById(
        FILE_PATHS.EMPLOYEES,
        DATA_KEYS.EMPLOYEES,
        updateClassDto.teacherId,
      );

      if (!teacher) {
        throw new NotFoundException('Teacher not found');
      }

      if (!(teacher as any).isActive) {
        throw new BadRequestException('Cannot assign inactive teacher to class');
      }
    }

    // Validate schedule times if provided
    if (updateClassDto.schedule) {
      if (updateClassDto.schedule.startTime >= updateClassDto.schedule.endTime) {
        throw new BadRequestException('Start time must be before end time');
      }
    }

    // Validate dates if both are provided
    if (updateClassDto.startDate && updateClassDto.endDate) {
      if (new Date(updateClassDto.startDate) >= new Date(updateClassDto.endDate)) {
        throw new BadRequestException('Start date must be before end date');
      }
    }

    return await this.dataStore.update(
      FILE_PATHS.CLASSES,
      DATA_KEYS.CLASSES,
      id,
      updateClassDto,
    );
  }

  async remove(id: string) {
    // Soft delete - mark as inactive
    return await this.dataStore.update(
      FILE_PATHS.CLASSES,
      DATA_KEYS.CLASSES,
      id,
      { isActive: false },
    );
  }

  async getEnrollments(id: string) {
    // Verify class exists
    await this.findOne(id);

    return await this.dataStore.findBy(
      FILE_PATHS.ENROLLMENTS,
      DATA_KEYS.ENROLLMENTS,
      (enrollment: any) => enrollment.classId === id,
    );
  }

  async getStudents(id: string) {
    const enrollments = await this.getEnrollments(id);

    const students = await Promise.all(
      enrollments.map(async (enrollment: any) => {
        const student = await this.dataStore.findById(
          FILE_PATHS.STUDENTS,
          DATA_KEYS.STUDENTS,
          enrollment.studentId,
        );
        return {
          ...student,
          enrollmentId: enrollment.id,
          enrollmentDate: enrollment.enrollmentDate,
          enrollmentStatus: enrollment.status,
          paymentStatus: enrollment.paymentStatus,
        };
      }),
    );

    return students.filter(s => s.id); // Filter out students that weren't found
  }
}
