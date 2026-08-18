import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  FormArray,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LessonService } from '../services/lesson.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { LessonModel, LessonQuestionModel } from '@shared/interfaces/lesson.interface';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

/**
 * Exactly one option must be marked correct — the same rule the API enforces.
 * Checked here too so the teacher is told before the round trip, not by a 400.
 */
function oneCorrectValidator(group: AbstractControl): ValidationErrors | null {
  const correctIndex = group.get('correctIndex')?.value;
  return correctIndex === null || correctIndex === undefined ? { noCorrect: true } : null;
}

/**
 * One lesson's MCQ bank.
 *
 * The exam draws its paper from these, so the two things that matter per question
 * are the stem and which single option is right. Everything else is optional.
 */
@Component({
  selector: 'app-lesson-questions',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    TooltipModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    RadioButtonModule,
    ConfirmDialogModule,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './lesson-questions.component.html',
})
export class LessonQuestionsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private lessonService = inject(LessonService);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  lessonId!: string;
  lesson = signal<LessonModel | null>(null);
  questions = signal<LessonQuestionModel[]>([]);
  loading = signal(true);
  saving = signal(false);
  showDialog = signal(false);
  isEditMode = signal(false);
  editingId: string | null = null;

  readonly maxOptions = MAX_OPTIONS;

  form: FormGroup = this.fb.group({
    questionText: ['', [Validators.required, Validators.minLength(2)]],
    explanation: [''],
    // The correct answer is a single index rather than a flag per option: it is one
    // choice, and modelling it as one control makes "exactly one" impossible to
    // violate in the UI. Starts unset on purpose — pre-marking the first answer
    // would let a wrong key through on nothing but a fast Enter.
    correctIndex: [null as number | null],
    options: this.fb.array([] as any[]),
  }, { validators: oneCorrectValidator });

  get questionText() { return this.form.get('questionText'); }
  get options(): FormArray { return this.form.get('options') as FormArray; }
  get noCorrect() { return this.form.errors?.['noCorrect'] === true; }
  get canAddOption() { return this.options.length < MAX_OPTIONS; }
  get canRemoveOption() { return this.options.length > MIN_OPTIONS; }

  ngOnInit() {
    this.lessonId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.lessonId) {
      this.router.navigate(['/lessons']);
      return;
    }
    this.loadLesson();
    this.loadQuestions();
  }

  loadLesson() {
    this.lessonService.getById(this.lessonId).subscribe({
      next: (lesson) => this.lesson.set(lesson),
      // A missing or forbidden lesson has no bank to show, so go back to the list
      // rather than leaving a header with nothing under it.
      error: () => this.router.navigate(['/lessons']),
    });
  }

  loadQuestions() {
    this.loading.set(true);
    this.lessonService.getQuestions(this.lessonId).subscribe({
      next: (questions) => {
        this.questions.set(questions);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error(this.translate.instant('LESSONS.QUESTIONS.LOAD_ERROR'));
        this.loading.set(false);
      },
    });
  }

  private optionControl(text = '') {
    return this.fb.group({ optionText: [text, [Validators.required]] });
  }

  private setOptions(texts: string[]) {
    this.options.clear();
    texts.forEach((t) => this.options.push(this.optionControl(t)));
  }

  openCreate() {
    this.isEditMode.set(false);
    this.editingId = null;
    this.form.reset({ questionText: '', explanation: '', correctIndex: null });
    // Four blanks: the shape of a multiple-choice question most people expect, and
    // two of them can be removed.
    this.setOptions(['', '', '', '']);
    this.showDialog.set(true);
  }

  openEdit(question: LessonQuestionModel) {
    this.isEditMode.set(true);
    this.editingId = question.id;
    const correctIndex = question.options.findIndex((o) => o.isCorrect);
    this.form.reset({
      questionText: question.questionText,
      explanation: question.explanation ?? '',
      correctIndex: correctIndex >= 0 ? correctIndex : null,
    });
    this.setOptions(question.options.map((o) => o.optionText));
    this.showDialog.set(true);
  }

  closeDialog() {
    this.showDialog.set(false);
    this.editingId = null;
  }

  addOption() {
    if (!this.canAddOption) return;
    this.options.push(this.optionControl());
  }

  removeOption(index: number) {
    if (!this.canRemoveOption) return;
    this.options.removeAt(index);

    // The correct answer is held as an index, so removing a row above it would
    // silently move it onto a different option. Keep it pointing at what the
    // teacher chose, and clear it if that is the row that just went.
    const correct = this.form.value.correctIndex as number | null;
    if (correct === null || correct === undefined) return;
    if (correct === index) this.form.patchValue({ correctIndex: null });
    else if (correct > index) this.form.patchValue({ correctIndex: correct - 1 });
  }

  /** The correct option's text, for the list — what a teacher scans the bank for. */
  correctAnswer(question: LessonQuestionModel): string {
    return question.options.find((o) => o.isCorrect)?.optionText ?? '—';
  }

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const correctIndex = this.form.value.correctIndex as number;
    const options = (this.form.value.options as { optionText: string }[]).map((o, i) => ({
      optionText: (o.optionText ?? '').trim(),
      isCorrect: i === correctIndex,
    }));

    this.saving.set(true);
    const payload = {
      questionText: (this.form.value.questionText ?? '').trim(),
      explanation: (this.form.value.explanation ?? '').trim() || null,
      options,
    };

    const done = () => {
      this.saving.set(false);
      this.closeDialog();
      this.loadQuestions();
    };
    const fail = () => this.saving.set(false);

    if (this.isEditMode() && this.editingId) {
      this.lessonService.updateQuestion(this.lessonId, this.editingId, payload).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('LESSONS.QUESTIONS.UPDATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    } else {
      this.lessonService.createQuestion(this.lessonId, payload).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('LESSONS.QUESTIONS.CREATE_SUCCESS'));
          done();
        },
        error: fail,
      });
    }
  }

  deleteQuestion(question: LessonQuestionModel) {
    this.confirmationService.confirm({
      header: this.translate.instant('LESSONS.QUESTIONS.DELETE_TITLE'),
      message: this.translate.instant('LESSONS.QUESTIONS.DELETE_MSG'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.lessonService.deleteQuestion(this.lessonId, question.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('LESSONS.QUESTIONS.DELETED'));
            this.loadQuestions();
          },
        });
      },
    });
  }

  back() {
    this.router.navigate(['/lessons']);
  }
}
