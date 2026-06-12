import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  CourseProduct,
  CourseProductCreateDto,
  CourseProductUpdateDto,
} from '@shared/interfaces/course-product.interface';

@Injectable({ providedIn: 'root' })
export class CourseProductService {
  private api = inject(ApiService);

  /** Products linked to a course (or all links when no courseId). */
  list(courseId?: string): Observable<CourseProduct[]> {
    return this.api.get<CourseProduct[]>('course-products', courseId ? { courseId } : {});
  }

  /** Link a product to a course (upsert; also the mid-course add). */
  link(dto: CourseProductCreateDto): Observable<CourseProduct> {
    return this.api.post<CourseProduct>('course-products', dto);
  }

  update(id: string, dto: CourseProductUpdateDto): Observable<CourseProduct> {
    return this.api.patch<CourseProduct>(`course-products/${id}`, dto);
  }

  unlink(id: string): Observable<{ message: string; code: string }> {
    return this.api.delete<{ message: string; code: string }>(`course-products/${id}`);
  }
}
