/**
 * A SCHOOL tenant's "Educational Stage" — the grade/class-year ladder shown on
 * their sidebar instead of Levels. Deliberately simpler than Level (no age
 * range) and backed by its own `school.levels` table (migration 094).
 */
export interface SchoolLevel {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolLevelCreateDto {
  name: string;
}

export interface SchoolLevelUpdateDto {
  name?: string;
}
