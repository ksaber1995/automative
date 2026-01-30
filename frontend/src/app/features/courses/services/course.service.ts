import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Course, CourseCreateDto, CourseUpdateDto } from '@shared/interfaces/course.interface';

@Injectable({
  providedIn: 'root'
})
export class CourseService {
  private api = inject(ApiService);

  getAllCourses(): Observable<Course[]> {
    return this.api.get<Course[]>('courses');
  }

  getActiveCourses(): Observable<Course[]> {
    return this.api.get<Course[]>('courses/active');
  }

  getCoursesByBranch(branchId: string): Observable<Course[]> {
    return this.api.get<Course[]>('courses', { branchId });
  }

  getCourseById(id: string): Observable<Course> {
    return this.api.get<Course>(`courses/${id}`);
  }

  getCourseEnrollments(id: string): Observable<any[]> {
    return this.api.get<any[]>(`courses/${id}/enrollments`);
  }

  createCourse(course: CourseCreateDto): Observable<Course> {
    return this.api.post<Course>('courses', course);
  }

  updateCourse(id: string, course: CourseUpdateDto): Observable<Course> {
    return this.api.patch<Course>(`courses/${id}`, course);
  }

  deleteCourse(id: string): Observable<Course> {
    return this.api.delete<Course>(`courses/${id}`);
  }
}
