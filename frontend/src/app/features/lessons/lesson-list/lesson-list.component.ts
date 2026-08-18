import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LessonService } from '../services/lesson.service';
import { CourseService } from '../../courses/services/course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { LessonModel } from '@shared/interfaces/lesson.interface';

/**
 * The lessons of one course, in teaching order.
 *
 * A course is picked first and everything below is that course's curriculum —
 * lessons are per-course, so a flat list of every lesson in the academy would mix
 * curricula that have nothing to do with each other.
 *
 * Ordering is edited with move up/down rather than drag-and-drop: it is the same
 * one call (`reorder`), works on a phone, and cannot half-apply.
 */
@Component({
  selector: 'app-lesson-list',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TooltipModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    SelectModule,
    TagModule,
    ConfirmDialogModule,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './lesson-list.component.html',
})
export class LessonListComponent implements OnInit {
  private router = inject(Router);
  private lessonService = inject(LessonService);
  private courseService = inject(CourseService);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  courses = signal<{ id: string; name: string }[]>([]);
  selectedCourseId = signal<string | null>(null);
  lessons = signal<LessonModel[]>([]);
  loading = signal(false);
  loadingCourses = signal(true);
  saving = signal(false);
  reordering = signal(false);
  showDialog = signal(false);
  isEditMode = signal(false);
  editingId: string | null = null;

  /** Lessons with no bank yet — the teacher's next job, so it's worth surfacing. */
  emptyBankCount = computed(() => this.lessons().filter((l) => !l.questionCount).length);

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
  });

  get name() { return this.form.get('name'); }

  ngOnInit() {
    this.loadCourses();
  }

  loadCourses() {
    this.loadingCourses.set(true);
    this.courseService.getAllCourses().subscribe({
      next: (courses) => {
        this.courses.set(courses.map((c) => ({ id: c.id, name: c.name })));
        this.loadingCourses.set(false);
        // Land on something useful: with one course there is nothing to choose.
        if (courses.length === 1) {
          this.selectedCourseId.set(courses[0].id);
          this.loadLessons();
        }
      },
      error: () => {
        this.notificationService.error(this.translate.instant('LESSONS.LIST.COURSES_LOAD_ERROR'));
        this.loadingCourses.set(false);
      },
    });
  }

  onCourseChange(courseId: string | null) {
    this.selectedCourseId.set(courseId);
    this.lessons.set([]);
    if (courseId) this.loadLessons();
  }

  loadLessons() {
    const courseId = this.selectedCourseId();
    if (!courseId) return;
    this.loading.set(true);
    this.lessonService.getAll({ courseId }).subscribe({
      next: (lessons) => {
        this.lessons.set(lessons);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error(this.translate.instant('LESSONS.LIST.LOAD_ERROR'));
        this.loading.set(false);
      },
    });
  }

  openCreate() {
    this.isEditMode.set(false);
    this.editingId = null;
    this.form.reset({ name: '', description: '' });
    this.showDialog.set(true);
  }

  openEdit(lesson: LessonModel) {
    this.isEditMode.set(true);
    this.editingId = lesson.id;
    this.form.reset({ name: lesson.name, description: lesson.description ?? '' });
    this.showDialog.set(true);
  }

  closeDialog() {
    this.showDialog.set(false);
    this.editingId = null;
  }

  save() {
    const courseId = this.selectedCourseId();
    if (this.form.invalid || !courseId) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const name = (this.form.value.name ?? '').trim();
    const description = (this.form.value.description ?? '').trim() || null;

    const done = () => {
      this.saving.set(false);
      this.closeDialog();
      this.loadLessons();
    };
    const fail = () => this.saving.set(false);

    if (this.isEditMode() && this.editingId) {
      this.lessonService.update(this.editingId, { name, description }).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('LESSONS.FORM.UPDATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    } else {
      // No orderIndex: the server appends to the end of the course's list.
      this.lessonService.create({ courseId, name, description }).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('LESSONS.FORM.CREATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    }
  }

  /** Into the lesson's MCQ bank — the questions an exam will draw from. */
  openQuestions(lesson: LessonModel) {
    this.router.navigate(['/lessons', lesson.id, 'questions']);
  }

  deleteLesson(lesson: LessonModel) {
    this.confirmationService.confirm({
      header: this.translate.instant('LESSONS.LIST.DELETE_TITLE'),
      message: this.translate.instant('LESSONS.LIST.DELETE_MSG', { name: lesson.name }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.lessonService.delete(lesson.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('LESSONS.LIST.DELETED'));
            this.loadLessons();
          },
        });
      },
    });
  }

  /**
   * Swap a lesson with its neighbour and persist the whole order.
   *
   * The list is reordered locally first so the row moves under the finger, then the
   * server is told the full order; a failure reloads, which puts the stored order
   * back on screen.
   */
  move(lesson: LessonModel, direction: -1 | 1) {
    const courseId = this.selectedCourseId();
    if (!courseId || this.reordering()) return;

    const current = [...this.lessons()];
    const index = current.findIndex((l) => l.id === lesson.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;

    [current[index], current[target]] = [current[target], current[index]];
    this.lessons.set(current);

    this.reordering.set(true);
    this.lessonService.reorder(courseId, current.map((l) => l.id)).subscribe({
      next: () => {
        this.reordering.set(false);
        this.loadLessons();
      },
      error: () => {
        this.reordering.set(false);
        this.loadLessons();
      },
    });
  }

  isFirst(lesson: LessonModel): boolean {
    return this.lessons()[0]?.id === lesson.id;
  }

  isLast(lesson: LessonModel): boolean {
    const list = this.lessons();
    return list[list.length - 1]?.id === lesson.id;
  }
}
