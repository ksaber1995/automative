import { Routes } from '@angular/router';

export const LESSONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./lesson-list/lesson-list.component').then((m) => m.LessonListComponent),
  },
  {
    path: ':id/questions',
    data: { breadcrumb: 'BREADCRUMBS.LESSON_QUESTIONS' },
    loadComponent: () =>
      import('./lesson-questions/lesson-questions.component').then((m) => m.LessonQuestionsComponent),
  },
];
