import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SchoolSemester, SchoolSemesterCreateDto, SchoolSemesterUpdateDto } from '@shared/interfaces/school-semester.interface';

@Injectable({
  providedIn: 'root'
})
export class SchoolSemesterService {
  private api = inject(ApiService);

  getAllSemesters(): Observable<SchoolSemester[]> {
    return this.api.get<SchoolSemester[]>('school-semesters');
  }

  getSemesterById(id: string): Observable<SchoolSemester> {
    return this.api.get<SchoolSemester>(`school-semesters/${id}`);
  }

  createSemester(semester: SchoolSemesterCreateDto): Observable<SchoolSemester> {
    return this.api.post<SchoolSemester>('school-semesters', semester);
  }

  updateSemester(id: string, semester: SchoolSemesterUpdateDto): Observable<SchoolSemester> {
    return this.api.patch<SchoolSemester>(`school-semesters/${id}`, semester);
  }

  deleteSemester(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`school-semesters/${id}`);
  }
}
