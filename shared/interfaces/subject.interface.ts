export interface Subject {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubjectCreateDto {
  name: string;
}

export interface SubjectUpdateDto {
  name?: string;
}
