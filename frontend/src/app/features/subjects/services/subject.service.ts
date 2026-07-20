import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Subject, SubjectCreateDto, SubjectUpdateDto } from '@shared/interfaces/subject.interface';

@Injectable({
  providedIn: 'root'
})
export class SubjectService {
  private api = inject(ApiService);

  getAllSubjects(): Observable<Subject[]> {
    return this.api.get<Subject[]>('subjects');
  }

  getSubjectById(id: string): Observable<Subject> {
    return this.api.get<Subject>(`subjects/${id}`);
  }

  createSubject(subject: SubjectCreateDto): Observable<Subject> {
    return this.api.post<Subject>('subjects', subject);
  }

  updateSubject(id: string, subject: SubjectUpdateDto): Observable<Subject> {
    return this.api.patch<Subject>(`subjects/${id}`, subject);
  }

  deleteSubject(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`subjects/${id}`);
  }
}
