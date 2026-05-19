export type AcquisitionChannel =
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'TWITTER'
  | 'TIKTOK'
  | 'REFERRAL'
  | 'WALK_IN'
  | 'OTHER';

export const ACQUISITION_CHANNELS: AcquisitionChannel[] = [
  'FACEBOOK',
  'INSTAGRAM',
  'TWITTER',
  'TIKTOK',
  'REFERRAL',
  'WALK_IN',
  'OTHER',
];

export interface Student {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email?: string;
  phone?: string;
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
  address?: string;
  branchId: string;
  isActive: boolean;
  enrollmentDate: string;
  churnDate?: string;
  churnReason?: string;
  notes?: string;
  acquisitionChannel?: AcquisitionChannel | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentCreateDto {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email?: string;
  phone?: string;
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
  address?: string;
  branchId: string;
  enrollmentDate: string;
  notes?: string;
  acquisitionChannel?: AcquisitionChannel;
}

export interface StudentUpdateDto {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  address?: string;
  branchId?: string;
  isActive?: boolean;
  notes?: string;
  acquisitionChannel?: AcquisitionChannel | null;
}
