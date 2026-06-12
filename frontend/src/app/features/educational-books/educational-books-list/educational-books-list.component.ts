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
import { BranchService } from '../../branches/services/branch.service';
import { EducationalBooksCourseSummary } from '@shared/interfaces/course-product.interface';
import { Branch } from '@shared/interfaces/branch.interface';

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
  private branchService = inject(BranchService);
  private router = inject(Router);

  courses = signal<EducationalBooksCourseSummary[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(false);
  selectedBranchId = signal<string | null>(null);

  branchOptions = computed(() =>
    this.branches().map((b) => ({ label: b.name, value: b.id })),
  );

  filteredCourses = computed(() => {
    const branch = this.selectedBranchId();
    if (!branch) return this.courses();
    // Global courses (null branchId) are always shown alongside branch matches.
    return this.courses().filter((c) => c.branchId === branch || c.branchId === null);
  });

  ngOnInit() {
    this.loadCourses();
    this.branchService.getAllBranches().subscribe({
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
