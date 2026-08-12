import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Course, CourseCreateDto, CourseUpdateDto, CoursePriceImpact, CourseWithEnrollmentCount } from '@shared/interfaces/course.interface';

@Injectable({
  providedIn: 'root'
})
export class CourseService {
  private api = inject(ApiService);

  getAllCourses(): Observable<CourseWithEnrollmentCount[]> {
    return this.api.get<CourseWithEnrollmentCount[]>('courses');
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

  /** What changing this course's price would do, for the confirmation shown first. */
  getPriceImpact(id: string, price: number): Observable<CoursePriceImpact> {
    return this.api.get<CoursePriceImpact>(`courses/${id}/price-impact`, { price: String(price) });
  }

  deleteCourse(id: string): Observable<Course> {
    return this.api.delete<Course>(`courses/${id}`);
  }

  deactivateCourse(id: string): Observable<Course> {
    return this.api.post<Course>(`courses/${id}/deactivate`, {});
  }

  activateCourse(id: string): Observable<Course> {
    return this.api.post<Course>(`courses/${id}/activate`, {});
  }
}
