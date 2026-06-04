export interface Level {
  id: string;
  companyId: string;
  name: string;
  age: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LevelCreateDto {
  name: string;
  age?: number | null;
}

export interface LevelUpdateDto {
  name?: string;
  age?: number | null;
}
