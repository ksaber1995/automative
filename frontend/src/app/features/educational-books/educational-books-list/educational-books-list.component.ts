import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { TranslateModule } from '@ngx-translate/core';
import { EducationalBooksService } from '../services/educational-books.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { AuthService } from '../../../core/services/auth.service';
import { EducationalBooksCourseSummary } from '@shared/interfaces/course-product.interface';

@Component({
  selector: 'app-educational-books-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TagModule, SelectModule,
    TranslateModule,
  ],
  templateUrl: './educational-books-list.component.html',
})
export class EducationalBooksListComponent implements OnInit {
  private educationalBooksService = inject(EducationalBooksService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  authService = inject(AuthService);

  courses = signal<EducationalBooksCourseSummary[]>([]);
  branches = signal<LookupOption[]>([]);
  loading = signal(false);
  selectedBranchId = signal<string | null>(null);
  selectedCourseName = signal<string | null>(null);

  branchOptions = computed(() =>
    this.branches().map((b) => ({ label: b.label, value: b.id })),
  );

  courseNameOptions = computed(() => {
    const names = new Set(this.courses().map(c => c.courseName));
    return Array.from(names).sort().map(n => ({ label: n, value: n }));
  });

  filteredCourses = computed(() => {
    let result = this.courses();
    const branch = this.selectedBranchId();
    if (branch) {
      result = result.filter((c) => c.branchId === branch || c.branchId === null);
    }
    const courseName = this.selectedCourseName();
    if (courseName) {
      result = result.filter((c) => c.courseName === courseName);
    }
    return result;
  });

  ngOnInit() {
    this.loadCourses();
    this.lookupService.branches().subscribe({
      next: (b) => this.branches.set(b),
    });
  }

  loadCourses() {
    this.loading.set(true);
    this.educationalBooksService.getCourses().subscribe({
      next: (data) => {
        this.courses.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading courses:', err);
        this.loading.set(false);
      },
    });
  }

  view(course: EducationalBooksCourseSummary) {
    this.router.navigate(['/educational-books', course.courseId]);
  }
}
