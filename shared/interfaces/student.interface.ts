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
  /** The student's full name, as one field. Split first/last was removed. */
  name: string;
  dateOfBirth: string;
  gender?: Gender | null;
  email?: string;
  phone?: string;
  parentName?: string | null;
  parentPhone?: string | null;
  address?: string;
  branchId: string;
  isActive: boolean;
  inactiveDate?: string;
  inactiveReason?: string;
  notes?: string;
  acquisitionChannel?: AcquisitionChannel | null;
  /** Short sequential per-company number (1, 2, 3…) for QR-less attendance/payment lookup. */
  studentCode?: number | null;
  /** Random token encoded in the student's QR code (public profile + check-in). */
  qrToken?: string | null;
  hasSubscriptions?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentCreateDto {
  name: string;
  dateOfBirth: string;
  gender?: Gender;
  email?: string;
  phone?: string;
  parentName?: string;
  parentPhone?: string;
  address?: string;
  branchId: string;
  notes?: string;
  acquisitionChannel?: AcquisitionChannel;
}

/** One parsed spreadsheet row sent to the bulk-import endpoint. */
export interface StudentImportRow {
  name: string;
  gender?: Gender | null;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface StudentImportResult {
  created: number;
  failed: number;
  errors: { row: number; message: string }[];
}

export interface StudentUpdateDto {
  name?: string;
  dateOfBirth?: string;
  gender?: Gender | null;
  email?: string;
  phone?: string;
  parentName?: string;
  parentPhone?: string;
  address?: string;
  branchId?: string;
  isActive?: boolean;
  notes?: string;
  acquisitionChannel?: AcquisitionChannel | null;
}
