import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { EnrollStudentDto } from './dto/enroll-student.dto';

@Injectable()
export class StudentsService {
  constructor(private dataStore: DataStoreService) {}

  async create(createStudentDto: CreateStudentDto) {
    const branch = await this.dataStore.findById(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      createStudentDto.branchId,
    );

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    return await this.dataStore.create(
      FILE_PATHS.STUDENTS,
      DATA_KEYS.STUDENTS,
      {
        ...createStudentDto,
        isActive: true,
      },
    );
  }

  async findAll() {
    return await this.dataStore.findAll(FILE_PATHS.STUDENTS, DATA_KEYS.STUDENTS);
  }

  async findByBranch(branchId: string) {
    return await this.dataStore.findBy(
      FILE_PATHS.STUDENTS,
      DATA_KEYS.STUDENTS,
      (student: any) => student.branchId === branchId,
    );
  }

  async findOne(id: string) {
    const student = await this.dataStore.findById(
      FILE_PATHS.STUDENTS,
      DATA_KEYS.STUDENTS,
      id,
    );

    if (!student) {
      throw new NotFoundException(`Student with ID ${id} not found`);
    }

    return student;
  }

  async update(id: string, updateStudentDto: UpdateStudentDto) {
    if (updateStudentDto.branchId) {
      const branch = await this.dataStore.findById(
        FILE_PATHS.BRANCHES,
        DATA_KEYS.BRANCHES,
        updateStudentDto.branchId,
      );

      if (!branch) {
        throw new NotFoundException('Branch not found');
      }
    }

    return await this.dataStore.update(
      FILE_PATHS.STUDENTS,
      DATA_KEYS.STUDENTS,
      id,
      updateStudentDto,
    );
  }

  async remove(id: string) {
    return await this.dataStore.update(
      FILE_PATHS.STUDENTS,
      DATA_KEYS.STUDENTS,
      id,
      { isActive: false },
    );
  }

  async enrollStudent(studentId: string, enrollDto: EnrollStudentDto) {
    const student = await this.findOne(studentId);

    const course = await this.dataStore.findById(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      enrollDto.courseId,
    );

    if (!course || !(course as any).isActive) {
      throw new NotFoundException('Course not found or inactive');
    }

    const courseData = course as any;
    const originalPrice = courseData.price;
    let finalPrice = originalPrice;
    let discountAmount = enrollDto.discountAmount || 0;
    let discountPercent = enrollDto.discountPercent || 0;

    if (discountPercent > 0) {
      discountAmount = (originalPrice * discountPercent) / 100;
      finalPrice = originalPrice - discountAmount;
    } else if (discountAmount > 0) {
      finalPrice = originalPrice - discountAmount;
      discountPercent = (discountAmount / originalPrice) * 100;
    }

    if (finalPrice < 0) {
      throw new BadRequestException('Discount cannot exceed the original price');
    }

    const enrollment = await this.dataStore.create(
      FILE_PATHS.ENROLLMENTS,
      DATA_KEYS.ENROLLMENTS,
      {
        studentId,
        courseId: enrollDto.courseId,
        branchId: (student as any).branchId,
        enrollmentDate: enrollDto.enrollmentDate,
        status: 'ACTIVE',
        originalPrice,
        discountPercent,
        discountAmount,
        finalPrice,
        paymentStatus: 'PENDING',
        completionDate: null,
        notes: enrollDto.notes || null,
      },
    );

    return enrollment;
  }

  async getEnrollments(studentId: string) {
    await this.findOne(studentId);

    const enrollments = await this.dataStore.findBy(
      FILE_PATHS.ENROLLMENTS,
      DATA_KEYS.ENROLLMENTS,
      (enrollment: any) => enrollment.studentId === studentId,
    );

    // Enrich with course data
    const enrichedEnrollments = await Promise.all(
      enrollments.map(async (enrollment: any) => {
        const course = await this.dataStore.findById(
          FILE_PATHS.COURSES,
          DATA_KEYS.COURSES,
          enrollment.courseId,
        );
        return {
          ...enrollment,
          course,
        };
      }),
    );

    return enrichedEnrollments;
  }

  async updateEnrollment(studentId: string, enrollmentId: string, updateData: any) {
    await this.findOne(studentId);

    const enrollment = await this.dataStore.findById(
      FILE_PATHS.ENROLLMENTS,
      DATA_KEYS.ENROLLMENTS,
      enrollmentId,
    );

    if (!enrollment || (enrollment as any).studentId !== studentId) {
      throw new NotFoundException('Enrollment not found for this student');
    }

    return await this.dataStore.update(
      FILE_PATHS.ENROLLMENTS,
      DATA_KEYS.ENROLLMENTS,
      enrollmentId,
      updateData,
    );
  }

  async deleteEnrollment(studentId: string, enrollmentId: string) {
    await this.findOne(studentId);

    const enrollment = await this.dataStore.findById(
      FILE_PATHS.ENROLLMENTS,
      DATA_KEYS.ENROLLMENTS,
      enrollmentId,
    );

    if (!enrollment || (enrollment as any).studentId !== studentId) {
      throw new NotFoundException('Enrollment not found for this student');
    }

    return await this.dataStore.update(
      FILE_PATHS.ENROLLMENTS,
      DATA_KEYS.ENROLLMENTS,
      enrollmentId,
      { status: 'DROPPED' },
    );
  }
}
