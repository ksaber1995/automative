export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  state?: string;
  zipCode?: string;
  phone: string;
  email: string;
  managerId?: string | null;
  isActive: boolean;
  openingDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface BranchCreateDto {
  name: string;
  code: string;
  address: string;
  city: string;
  state?: string;
  zipCode?: string;
  phone: string;
  email: string;
  managerId?: string | null;
  openingDate: string;
}

export interface BranchUpdateDto {
  name?: string;
  code?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  email?: string;
  managerId?: string | null;
  isActive?: boolean;
}
