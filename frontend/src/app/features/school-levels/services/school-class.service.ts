import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SchoolClass, SchoolClassCreateDto, SchoolClassUpdateDto } from '@shared/interfaces/school-class.interface';

@Injectable({
  providedIn: 'root'
})
export class SchoolClassService {
  private api = inject(ApiService);

  /** Omit levelId for every class across every stage; pass it to narrow to one. */
  getAllClasses(levelId?: string): Observable<SchoolClass[]> {
    return this.api.get<SchoolClass[]>('school-classes', levelId ? { levelId } : undefined);
  }

  getClassById(id: string): Observable<SchoolClass> {
    return this.api.get<SchoolClass>(`school-classes/${id}`);
  }

  createClass(cls: SchoolClassCreateDto): Observable<SchoolClass> {
    return this.api.post<SchoolClass>('school-classes', cls);
  }

  updateClass(id: string, cls: SchoolClassUpdateDto): Observable<SchoolClass> {
    return this.api.patch<SchoolClass>(`school-classes/${id}`, cls);
  }

  deleteClass(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`school-classes/${id}`);
  }
}
