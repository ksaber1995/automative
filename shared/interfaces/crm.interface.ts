export type LeadStage = 'NEW' | 'CONTACTED' | 'TRIAL' | 'NEGOTIATION' | 'WON' | 'LOST';

export const LEAD_STAGES: LeadStage[] = ['NEW', 'CONTACTED', 'TRIAL', 'NEGOTIATION', 'WON', 'LOST'];

export interface CrmLead {
  id: string;
  companyId: string;
  branchId?: string | null;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  interestedCourseId?: string | null;
  interestedCourseName?: string | null;
  stage: LeadStage;
  ownerUserId?: string | null;
  ownerName?: string | null;
  notes?: string | null;
  lostReason?: string | null;
  nextActionAt?: string | null;
  convertedStudentId?: string | null;
  lastActivityAt?: string | null;
  openTaskCount?: number;
  nextTaskDueAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ActivityType = 'NOTE' | 'CALL' | 'WHATSAPP' | 'MEETING' | 'TASK' | 'TRIAL';

export const ACTIVITY_TYPES: ActivityType[] = ['NOTE', 'CALL', 'WHATSAPP', 'MEETING', 'TASK', 'TRIAL'];

export interface CrmActivity {
  id: string;
  leadId: string;
  leadName?: string | null;
  type: ActivityType;
  subject?: string | null;
  body?: string | null;
  dueAt?: string | null;
  doneAt?: string | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmActivityWriteDto {
  type?: ActivityType;
  subject?: string | null;
  body?: string | null;
  dueAt?: string | null;
  ownerUserId?: string | null;
  done?: boolean;
}

export interface CrmLeadWriteDto {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  interestedCourseId?: string | null;
  branchId?: string | null;
  stage?: LeadStage;
  ownerUserId?: string | null;
  notes?: string | null;
  lostReason?: string | null;
  nextActionAt?: string | null;
}
