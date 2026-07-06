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
  inactiveDate?: string;
  inactiveReason?: string;
  notes?: string;
  acquisitionChannel?: AcquisitionChannel | null;
  /** Short sequential per-company number (1, 2, 3…) for QR-less attendance/payment lookup. */
  studentCode?: number | null;
  /** Random token encoded in the student's QR code (public profile + check-in). */
  qrToken?: string | null;
  /** Paid QR activation (TEACHER companies). For academies the QR is free. */
  qrActivated?: boolean;
  /** ISO date; null = lifelong (when activated) or not activated. */
  qrExpiration?: string | null;
  /** Amount billed for the current activation (EGP): 25 (1yr) or 40 (lifelong). */
  qrPrice?: number | null;
  /** Toggled by the owner once the teacher settles the activation bill. */
  qrPaid?: boolean;
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

/** One parsed spreadsheet row sent to the bulk-import endpoint. */
export interface StudentImportRow {
  firstName: string;
  lastName?: string;
  gender?: Gender | null;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentEmail?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface StudentImportResult {
  created: number;
  failed: number;
  errors: { row: number; message: string }[];
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
