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
  reachCount?: number;
  lastCallAt?: string | null;
  lastResponse?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const CALL_RESPONSES: string[] = ['NO_ANSWER', 'ANSWERED', 'INTERESTED', 'NOT_INTERESTED', 'CALL_BACK', 'WRONG_NUMBER'];
export const CALL_OBSTACLES: string[] = ['NONE', 'PRICE', 'SCHEDULE', 'DISTANCE', 'STILL_THINKING', 'COMPETITOR', 'NOT_INTERESTED', 'OTHER'];

export interface CrmLeadCall {
  id: string;
  leadId: string;
  response: string;
  obstacle?: string | null;
  notes?: string | null;
  calledBy?: string | null;
  calledByName?: string | null;
  calledAt: string;
  createdAt: string;
}

export interface CrmCallWriteDto {
  response: string;
  obstacle?: string | null;
  notes?: string | null;
  calledAt?: string;
}

export type ActivityType = 'NOTE' | 'CALL' | 'WHATSAPP' | 'MEETING' | 'TASK' | 'TRIAL';

export const ACTIVITY_TYPES: ActivityType[] = ['NOTE', 'CALL', 'WHATSAPP', 'MEETING', 'TASK', 'TRIAL'];

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH'];

export interface CrmActivity {
  id: string;
  leadId?: string | null;
  leadName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  type: ActivityType;
  subject?: string | null;
  body?: string | null;
  dueAt?: string | null;
  doneAt?: string | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
  assignedEmployeeId?: string | null;
  assigneeName?: string | null;
  priority?: TaskPriority;
  createdAt: string;
  updatedAt: string;
}

export interface CrmTaskWriteDto {
  subject?: string;
  body?: string | null;
  dueAt?: string | null;
  leadId?: string | null;
  branchId?: string | null;
  assignedEmployeeId?: string | null;
  priority?: TaskPriority;
  done?: boolean;
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

/**
 * A named group of leads — like a WhatsApp broadcast list. A lead can belong to
 * many lists; membership lives in crm_list_leads, unique per (list, lead).
 */
export interface CrmList {
  id: string;
  companyId: string;
  branchId?: string | null;
  branchName?: string | null;
  name: string;
  description?: string | null;
  /** How many leads are in the list (populated by the API). */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmListWriteDto {
  name?: string;
  description?: string | null;
  branchId?: string | null;
}
