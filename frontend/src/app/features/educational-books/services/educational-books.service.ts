import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  EducationalBooksCourseSummary,
  EducationalBooksCourseDetail,
} from '@shared/interfaces/course-product.interface';

@Injectable({ providedIn: 'root' })
export class EducationalBooksService {
  private api = inject(ApiService);

  /** Courses that have ≥1 linked product, with bought / not-bought counts. */
  getCourses(): Observable<EducationalBooksCourseSummary[]> {
    return this.api.get<EducationalBooksCourseSummary[]>('educational-books/courses');
  }

  /** Per linked product: who bought and who didn't, over the enrolled roster. */
  getCourseDetail(courseId: string): Observable<EducationalBooksCourseDetail> {
    return this.api.get<EducationalBooksCourseDetail>(`educational-books/course/${courseId}`);
  }
}
