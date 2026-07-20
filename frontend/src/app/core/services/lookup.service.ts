import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';
import { ApiService } from './api.service';

/** A minimal dropdown option returned by the permission-free /api/lookups/* endpoints. */
export interface LookupOption {
  id: string;
  label: string;
}

/**
 * Fetches lightweight {id, label} lists for dropdowns. These endpoints require
 * only a valid session (no granular permission), so a page the user CAN access
 * (e.g. Students) can still populate a foreign dropdown (e.g. Branch) even when
 * the user lacks permission on that foreign resource.
 *
 * Prefer this over the full entity services whenever you only need to populate a
 * <p-select>/<p-multiSelect> with names — not the full records.
 */
@Injectable({ providedIn: 'root' })
export class LookupService {
  private api = inject(ApiService);

  /**
   * Branches are loaded by the app-wide BranchStateService AND by many page
   * filters, so cache the request for the session: all callers share one HTTP
   * call (shareReplay). On error the cache is dropped so a later call retries.
   */
  private branches$?: Observable<LookupOption[]>;

  branches(): Observable<LookupOption[]> {
    if (!this.branches$) {
      this.branches$ = this.api.get<LookupOption[]>('lookups/branches').pipe(
        catchError((err) => { this.branches$ = undefined; return throwError(() => err); }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.branches$;
  }

  employees(): Observable<LookupOption[]> {
    return this.api.get<LookupOption[]>('lookups/employees');
  }

  courses(branchId?: string): Observable<LookupOption[]> {
    return this.api.get<LookupOption[]>('lookups/courses', branchId ? { branchId } : undefined);
  }

  classes(opts?: { courseId?: string; branchId?: string }): Observable<LookupOption[]> {
    return this.api.get<LookupOption[]>('lookups/classes', opts);
  }

  levels(): Observable<LookupOption[]> {
    return this.api.get<LookupOption[]>('lookups/levels');
  }

  subjects(): Observable<LookupOption[]> {
    return this.api.get<LookupOption[]>('lookups/subjects');
  }

  rooms(branchId?: string): Observable<LookupOption[]> {
    return this.api.get<LookupOption[]>('lookups/rooms', branchId ? { branchId } : undefined);
  }

  masterCourses(): Observable<LookupOption[]> {
    return this.api.get<LookupOption[]>('lookups/master-courses');
  }

  students(branchId?: string): Observable<LookupOption[]> {
    return this.api.get<LookupOption[]>('lookups/students', branchId ? { branchId } : undefined);
  }

  products(branchId?: string): Observable<LookupOption[]> {
    return this.api.get<LookupOption[]>('lookups/products', branchId ? { branchId } : undefined);
  }
}
