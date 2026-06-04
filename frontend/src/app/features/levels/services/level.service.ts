import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Level, LevelCreateDto, LevelUpdateDto } from '@shared/interfaces/level.interface';

@Injectable({
  providedIn: 'root'
})
export class LevelService {
  private api = inject(ApiService);

  getAllLevels(): Observable<Level[]> {
    return this.api.get<Level[]>('levels');
  }

  getLevelById(id: string): Observable<Level> {
    return this.api.get<Level>(`levels/${id}`);
  }

  createLevel(level: LevelCreateDto): Observable<Level> {
    return this.api.post<Level>('levels', level);
  }

  updateLevel(id: string, level: LevelUpdateDto): Observable<Level> {
    return this.api.patch<Level>(`levels/${id}`, level);
  }

  deleteLevel(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`levels/${id}`);
  }
}
