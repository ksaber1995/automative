import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SchoolSubject, SchoolSubjectCreateDto, SchoolSubjectUpdateDto } from '@shared/interfaces/school-subject.interface';

@Injectable({
  providedIn: 'root'
})
export class SchoolSubjectService {
  private api = inject(ApiService);

  /** Omit levelId for every subject across every stage; pass it to narrow to one. */
  getAllSubjects(levelId?: string): Observable<SchoolSubject[]> {
    return this.api.get<SchoolSubject[]>('school-subjects', levelId ? { levelId } : undefined);
  }

  getSubjectById(id: string): Observable<SchoolSubject> {
    return this.api.get<SchoolSubject>(`school-subjects/${id}`);
  }

  createSubject(subject: SchoolSubjectCreateDto): Observable<SchoolSubject> {
    return this.api.post<SchoolSubject>('school-subjects', subject);
  }

  updateSubject(id: string, subject: SchoolSubjectUpdateDto): Observable<SchoolSubject> {
    return this.api.patch<SchoolSubject>(`school-subjects/${id}`, subject);
  }

  deleteSubject(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`school-subjects/${id}`);
  }
}
