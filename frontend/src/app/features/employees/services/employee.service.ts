import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Employee, EmployeeCreateDto, EmployeeUpdateDto } from '@shared/interfaces/employee.interface';

@Injectable({
  providedIn: 'root'
})
export class EmployeeService {
  private api = inject(ApiService);

  getAllEmployees(): Observable<Employee[]> {
    return this.api.get<Employee[]>('employees');
  }

  getEmployeesByBranch(branchId: string): Observable<Employee[]> {
    return this.api.get<Employee[]>('employees', { branchId });
  }

  /** Server-side employee/teacher split. The list page filters client-side (it
   *  needs both counts at once); this is for callers that want only one kind. */
  getEmployeesByRole(isTeacher: boolean, branchId?: string): Observable<Employee[]> {
    return this.api.get<Employee[]>('employees', {
      isTeacher: String(isTeacher),
      ...(branchId ? { branchId } : {}),
    });
  }

  getGlobalEmployees(): Observable<Employee[]> {
    return this.api.get<Employee[]>('employees/global');
  }

  getEmployeeById(id: string): Observable<Employee> {
    return this.api.get<Employee>(`employees/${id}`);
  }

  createEmployee(employee: EmployeeCreateDto): Observable<Employee> {
    return this.api.post<Employee>('employees', employee);
  }

  updateEmployee(id: string, employee: EmployeeUpdateDto): Observable<Employee> {
    return this.api.patch<Employee>(`employees/${id}`, employee);
  }

  deleteEmployee(id: string): Observable<Employee> {
    return this.api.delete<Employee>(`employees/${id}`);
  }
}
