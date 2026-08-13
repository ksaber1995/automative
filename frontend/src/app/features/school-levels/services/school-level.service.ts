import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SchoolLevel, SchoolLevelCreateDto, SchoolLevelUpdateDto } from '@shared/interfaces/school-level.interface';

@Injectable({
  providedIn: 'root'
})
export class SchoolLevelService {
  private api = inject(ApiService);

  getAllLevels(): Observable<SchoolLevel[]> {
    return this.api.get<SchoolLevel[]>('school-levels');
  }

  getLevelById(id: string): Observable<SchoolLevel> {
    return this.api.get<SchoolLevel>(`school-levels/${id}`);
  }

  createLevel(level: SchoolLevelCreateDto): Observable<SchoolLevel> {
    return this.api.post<SchoolLevel>('school-levels', level);
  }

  updateLevel(id: string, level: SchoolLevelUpdateDto): Observable<SchoolLevel> {
    return this.api.patch<SchoolLevel>(`school-levels/${id}`, level);
  }

  deleteLevel(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`school-levels/${id}`);
  }
}
