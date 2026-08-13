/**
 * A SCHOOL tenant's class — one-to-many under an educational stage
 * (SchoolLevel), same relationship as SchoolSubject. Deliberately not the
 * academy Class shape: no course, no timetable — just a name and which of
 * the company's existing rooms it meets in. Backed by `school.classes`
 * (migration 096).
 */
export interface SchoolClass {
  id: string;
  companyId: string;
  levelId: string;
  roomId: string | null;
  name: string;
  /** Present on list/getById (joined); absent right after create/update. */
  levelName?: string;
  roomCode?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolClassCreateDto {
  name: string;
  levelId: string;
  roomId?: string | null;
}

export interface SchoolClassUpdateDto {
  name?: string;
  levelId?: string;
  roomId?: string | null;
}
