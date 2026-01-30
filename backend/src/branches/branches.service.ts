import { Injectable, NotFoundException } from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private dataStore: DataStoreService) {}

  async create(createBranchDto: CreateBranchDto) {
    const branch = await this.dataStore.create(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      {
        ...createBranchDto,
        isActive: true,
      },
    );

    return branch;
  }

  async findAll() {
    const branches = await this.dataStore.findAll(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
    );

    return branches;
  }

  async findActive() {
    const branches = await this.dataStore.findBy(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      (branch: any) => branch.isActive === true,
    );

    return branches;
  }

  async findOne(id: string) {
    const branch = await this.dataStore.findById(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      id,
    );

    if (!branch) {
      throw new NotFoundException(`Branch with ID ${id} not found`);
    }

    return branch;
  }

  async update(id: string, updateBranchDto: UpdateBranchDto) {
    const branch = await this.dataStore.update(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      id,
      updateBranchDto as any,
    );

    return branch;
  }

  async remove(id: string) {
    // Soft delete by setting isActive to false
    const branch = await this.dataStore.update(
      FILE_PATHS.BRANCHES,
      DATA_KEYS.BRANCHES,
      id,
      { isActive: false } as any,
    );

    return branch;
  }

  async getStats(id: string) {
    await this.findOne(id); // Check if branch exists

    // Get courses for this branch
    const courses = await this.dataStore.findBy(
      FILE_PATHS.COURSES,
      DATA_KEYS.COURSES,
      (course: any) => course.branchId === id && course.isActive,
    );

    // Get students for this branch
    const students = await this.dataStore.findBy(
      FILE_PATHS.STUDENTS,
      DATA_KEYS.STUDENTS,
      (student: any) => student.branchId === id && student.isActive,
    );

    // Get employees for this branch
    const employees = await this.dataStore.findBy(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      (employee: any) => employee.branchId === id && employee.isActive,
    );

    // Get revenues for this branch
    const revenues = await this.dataStore.findBy(
      FILE_PATHS.REVENUES,
      DATA_KEYS.REVENUES,
      (revenue: any) => revenue.branchId === id,
    );

    const totalRevenue = revenues.reduce(
      (sum: number, rev: any) => sum + rev.amount,
      0,
    );

    // Get expenses for this branch
    const expenses = await this.dataStore.findBy(
      FILE_PATHS.EXPENSES,
      DATA_KEYS.EXPENSES,
      (expense: any) => expense.branchId === id,
    );

    const totalExpenses = expenses.reduce(
      (sum: number, exp: any) => sum + exp.amount,
      0,
    );

    return {
      courseCount: courses.length,
      studentCount: students.length,
      employeeCount: employees.length,
      totalRevenue,
      totalExpenses,
      netProfit: totalRevenue - totalExpenses,
    };
  }
}
