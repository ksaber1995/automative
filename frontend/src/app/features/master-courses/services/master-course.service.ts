import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  MasterCourse,
  MasterCourseCreateDto,
  MasterCourseUpdateDto,
  LinkedCourseSummary,
  ApplyMasterCourseDto,
  ApplyMasterCourseResult,
  InstantiateMasterCourseDto,
  InstantiateMasterCourseResult,
  CloneMasterCourseDto,
} from '@shared/interfaces/master-course.interface';

@Injectable({ providedIn: 'root' })
export class MasterCourseService {
  private api = inject(ApiService);

  getAll(): Observable<MasterCourse[]> {
    return this.api.get<MasterCourse[]>('master-courses');
  }

  getById(id: string): Observable<MasterCourse> {
    return this.api.get<MasterCourse>(`master-courses/${id}`);
  }

  getLinkedCourses(id: string): Observable<LinkedCourseSummary[]> {
    return this.api.get<LinkedCourseSummary[]>(`master-courses/${id}/linked-courses`);
  }

  create(dto: MasterCourseCreateDto): Observable<MasterCourse> {
    return this.api.post<MasterCourse>('master-courses', dto);
  }

  update(id: string, dto: MasterCourseUpdateDto): Observable<MasterCourse> {
    return this.api.patch<MasterCourse>(`master-courses/${id}`, dto);
  }

  delete(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`master-courses/${id}`);
  }

  apply(id: string, dto: ApplyMasterCourseDto): Observable<ApplyMasterCourseResult> {
    return this.api.post<ApplyMasterCourseResult>(`master-courses/${id}/apply`, dto);
  }

  instantiate(id: string, dto: InstantiateMasterCourseDto): Observable<InstantiateMasterCourseResult> {
    return this.api.post<InstantiateMasterCourseResult>(`master-courses/${id}/instantiate`, dto);
  }

  clone(id: string, dto: CloneMasterCourseDto): Observable<MasterCourse> {
    return this.api.post<MasterCourse>(`master-courses/${id}/clone`, dto);
  }
}
