import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Class, ClassCreateDto, ClassUpdateDto, ClassWithDetails } from '@shared/interfaces/class.interface';

@Injectable({
  providedIn: 'root'
})
export class ClassService {
  private api = inject(ApiService);

  getAllClasses(): Observable<Class[]> {
    return this.api.get<Class[]>('classes');
  }

  getActiveClasses(): Observable<Class[]> {
    return this.api.get<Class[]>('classes/active');
  }

  getClassesByCourse(courseId: string): Observable<Class[]> {
    return this.api.get<Class[]>('classes', { courseId });
  }

  getClassesByTeacher(teacherId: string): Observable<Class[]> {
    return this.api.get<Class[]>('classes', { teacherId });
  }

  getClassesByBranch(branchId: string): Observable<Class[]> {
    return this.api.get<Class[]>('classes', { branchId });
  }

  getClassById(id: string): Observable<Class> {
    return this.api.get<Class>(`classes/${id}`);
  }

  getClassWithDetails(id: string): Observable<ClassWithDetails> {
    return this.api.get<ClassWithDetails>(`classes/${id}`, { details: 'true' });
  }

  getClassEnrollments(id: string): Observable<any[]> {
    return this.api.get<any[]>(`classes/${id}/enrollments`);
  }

  getClassStudents(id: string): Observable<any[]> {
    return this.api.get<any[]>(`classes/${id}/students`);
  }

  createClass(classData: ClassCreateDto): Observable<Class> {
    return this.api.post<Class>('classes', classData);
  }

  updateClass(id: string, classData: ClassUpdateDto): Observable<Class> {
    return this.api.patch<Class>(`classes/${id}`, classData);
  }

  deleteClass(id: string): Observable<Class> {
    return this.api.delete<Class>(`classes/${id}`);
  }
}
