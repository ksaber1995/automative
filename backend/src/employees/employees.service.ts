import { Injectable, NotFoundException } from '@nestjs/common';
import { DataStoreService } from '../data-store/data-store.service';
import { FILE_PATHS, DATA_KEYS } from '../data-store/file-paths.constant';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private dataStore: DataStoreService) {}

  async create(createEmployeeDto: CreateEmployeeDto) {
    if (createEmployeeDto.branchId && !createEmployeeDto.isGlobal) {
      const branch = await this.dataStore.findById(
        FILE_PATHS.BRANCHES,
        DATA_KEYS.BRANCHES,
        createEmployeeDto.branchId,
      );

      if (!branch) {
        throw new NotFoundException('Branch not found');
      }
    }

    return await this.dataStore.create(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      {
        ...createEmployeeDto,
        branchId: createEmployeeDto.isGlobal ? null : createEmployeeDto.branchId,
        terminationDate: null,
        isActive: true,
      },
    );
  }

  async findAll() {
    return await this.dataStore.findAll(FILE_PATHS.EMPLOYEES, DATA_KEYS.EMPLOYEES);
  }

  async findByBranch(branchId: string) {
    return await this.dataStore.findBy(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      (employee: any) => employee.branchId === branchId,
    );
  }

  async findGlobal() {
    return await this.dataStore.findBy(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      (employee: any) => employee.isGlobal === true,
    );
  }

  async findOne(id: string) {
    const employee = await this.dataStore.findById(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      id,
    );

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    return employee;
  }

  async update(id: string, updateEmployeeDto: UpdateEmployeeDto) {
    if (updateEmployeeDto.branchId) {
      const branch = await this.dataStore.findById(
        FILE_PATHS.BRANCHES,
        DATA_KEYS.BRANCHES,
        updateEmployeeDto.branchId,
      );

      if (!branch) {
        throw new NotFoundException('Branch not found');
      }
    }

    return await this.dataStore.update(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      id,
      updateEmployeeDto as any,
    );
  }

  async remove(id: string) {
    return await this.dataStore.update(
      FILE_PATHS.EMPLOYEES,
      DATA_KEYS.EMPLOYEES,
      id,
      {
        isActive: false,
        terminationDate: new Date().toISOString(),
      } as any,
    );
  }
}
