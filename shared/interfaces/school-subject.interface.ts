/**
 * A SCHOOL tenant's subject — one-to-many under an educational stage
 * (SchoolLevel): every subject belongs to exactly one stage, unlike the
 * academy-wide `Subject`. Backed by `school.subjects` (migration 095).
 */
export interface SchoolSubject {
  id: string;
  companyId: string;
  levelId: string;
  name: string;
  /** Present on list/getById (joined); absent right after create/update. */
  levelName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolSubjectCreateDto {
  name: string;
  levelId: string;
}

export interface SchoolSubjectUpdateDto {
  name?: string;
  levelId?: string;
}
