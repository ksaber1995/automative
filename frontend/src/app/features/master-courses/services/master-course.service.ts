import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  MasterCourse,
  MasterCourseCreateDto,
  MasterCourseUpdateDto,
  LinkedCourseSummary,
} from '@shared/interfaces/master-course.interface';

export interface AvailableCourse {
  id: string;
  name: string;
  code: string;
  price: number;
  duration: number;
}

@Injectable({ providedIn: 'root' })
export class MasterCourseService {
  private api = inject(ApiService);

  getAll(): Observable<MasterCourse[]> {
    return this.api.get<MasterCourse[]>('master-courses');
  }

  getById(id: string): Observable<MasterCourse> {
    return this.api.get<MasterCourse>(`master-courses/${id}`);
  }

  getLinkedCourses(id: string): Observable<LinkedCourseSummary[]> {
    return this.api.get<LinkedCourseSummary[]>(`master-courses/${id}/linked-courses`);
  }

  getAvailableCourses(id: string): Observable<AvailableCourse[]> {
    return this.api.get<AvailableCourse[]>(`master-courses/${id}/available-courses`);
  }

  create(dto: MasterCourseCreateDto): Observable<MasterCourse> {
    return this.api.post<MasterCourse>('master-courses', dto);
  }

  update(id: string, dto: MasterCourseUpdateDto): Observable<MasterCourse> {
    return this.api.patch<MasterCourse>(`master-courses/${id}`, dto);
  }

  delete(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`master-courses/${id}`);
  }

  addCourse(id: string, courseId: string): Observable<{ message: string }> {
    return this.api.post<{ message: string }>(`master-courses/${id}/courses`, { courseId });
  }

  removeCourse(id: string, courseId: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`master-courses/${id}/courses/${courseId}`);
  }
}
