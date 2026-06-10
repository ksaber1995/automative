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

export type Gender = 'MALE' | 'FEMALE';

export interface Student {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender?: Gender | null;
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
  /** Random token encoded in the student's QR code (public profile + check-in). */
  qrToken?: string | null;
  hasSubscriptions?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentCreateDto {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender?: Gender;
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
  gender?: Gender | null;
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
