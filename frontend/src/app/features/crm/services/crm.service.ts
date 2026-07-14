import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { CrmLead, CrmLeadWriteDto, CrmActivity, CrmActivityWriteDto, CrmTaskWriteDto, CrmLeadCall, CrmCallWriteDto, CrmList, CrmListWriteDto } from '@shared/interfaces/crm.interface';

export interface CrmAnalytics {
  totalLeads: number;
  won: number;
  lost: number;
  open: number;
  conversionRate: number;
  funnel: { stage: string; count: number }[];
  sources: { source: string; total: number; won: number }[];
  leaderboard: { ownerUserId: string | null; ownerName: string | null; total: number; won: number; openTasks: number; overdueTasks: number }[];
  tasks: { open: number; overdue: number };
  obstacles?: { obstacle: string; count: number }[];
}

export interface AtRiskStudent {
  studentId: string;
  fullName: string;
  phone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  branchId: string | null;
  outstanding: number;
  reasons: string[];
}

@Injectable({ providedIn: 'root' })
export class CrmService {
  private api = inject(ApiService);

  listLeads(params?: { stage?: string; ownerId?: string; branchId?: string; search?: string; toCall?: string }): Observable<CrmLead[]> {
    const clean: any = {};
    if (params?.stage) clean.stage = params.stage;
    if (params?.ownerId) clean.ownerId = params.ownerId;
    if (params?.branchId) clean.branchId = params.branchId;
    if (params?.search) clean.search = params.search;
    if (params?.toCall) clean.toCall = params.toCall;
    return this.api.get<CrmLead[]>('crm/leads', Object.keys(clean).length ? clean : undefined);
  }

  createLead(dto: CrmLeadWriteDto): Observable<CrmLead> {
    return this.api.post<CrmLead>('crm/leads', dto);
  }

  updateLead(id: string, dto: Partial<CrmLeadWriteDto>): Observable<CrmLead> {
    return this.api.patch<CrmLead>(`crm/leads/${id}`, dto);
  }

  deleteLead(id: string): Observable<{ message: string; code: string }> {
    return this.api.delete<{ message: string; code: string }>(`crm/leads/${id}`);
  }

  convertLead(id: string, branchId?: string): Observable<{ studentId: string; leadId: string }> {
    return this.api.post<{ studentId: string; leadId: string }>(`crm/leads/${id}/convert`, branchId ? { branchId } : {});
  }

  // Activities & tasks
  listActivities(leadId: string): Observable<CrmActivity[]> {
    return this.api.get<CrmActivity[]>(`crm/leads/${leadId}/activities`);
  }

  createActivity(leadId: string, dto: CrmActivityWriteDto): Observable<CrmActivity> {
    return this.api.post<CrmActivity>(`crm/leads/${leadId}/activities`, dto);
  }

  updateActivity(id: string, dto: CrmActivityWriteDto): Observable<CrmActivity> {
    return this.api.patch<CrmActivity>(`crm/activities/${id}`, dto);
  }

  deleteActivity(id: string): Observable<{ message: string; code: string }> {
    return this.api.delete<{ message: string; code: string }>(`crm/activities/${id}`);
  }

  // Tasks (dedicated page)
  listTasks(filters?: { assigneeId?: string; status?: string; leadId?: string; search?: string }): Observable<CrmActivity[]> {
    const clean: any = {};
    if (filters?.assigneeId) clean.assigneeId = filters.assigneeId;
    if (filters?.status) clean.status = filters.status;
    if (filters?.leadId) clean.leadId = filters.leadId;
    if (filters?.search) clean.search = filters.search;
    return this.api.get<CrmActivity[]>('crm/tasks', Object.keys(clean).length ? clean : undefined);
  }

  createTask(dto: CrmTaskWriteDto): Observable<CrmActivity> {
    return this.api.post<CrmActivity>('crm/tasks', dto);
  }

  updateTask(id: string, dto: CrmTaskWriteDto): Observable<CrmActivity> {
    return this.api.patch<CrmActivity>(`crm/tasks/${id}`, dto);
  }

  // Call log
  listCalls(leadId: string): Observable<CrmLeadCall[]> {
    return this.api.get<CrmLeadCall[]>(`crm/leads/${leadId}/calls`);
  }

  logCall(leadId: string, dto: CrmCallWriteDto): Observable<CrmLeadCall> {
    return this.api.post<CrmLeadCall>(`crm/leads/${leadId}/calls`, dto);
  }

  deleteCall(id: string): Observable<{ message: string; code: string }> {
    return this.api.delete<{ message: string; code: string }>(`crm/calls/${id}`);
  }

  getAnalytics(): Observable<CrmAnalytics> {
    return this.api.get<CrmAnalytics>('crm/analytics');
  }

  getAtRisk(): Observable<AtRiskStudent[]> {
    return this.api.get<AtRiskStudent[]>('crm/at-risk');
  }

  // ── Lists — named groups of leads (a lead can be in many) ───────────────────

  listLists(): Observable<CrmList[]> {
    return this.api.get<CrmList[]>('crm/lists');
  }

  createList(dto: CrmListWriteDto): Observable<CrmList> {
    return this.api.post<CrmList>('crm/lists', dto);
  }

  updateList(id: string, dto: CrmListWriteDto): Observable<CrmList> {
    return this.api.patch<CrmList>(`crm/lists/${id}`, dto);
  }

  deleteList(id: string): Observable<{ success: boolean }> {
    return this.api.delete<{ success: boolean }>(`crm/lists/${id}`);
  }

  /** The leads in a list — full lead rows, so they can be messaged or exported. */
  listMembers(id: string): Observable<CrmLead[]> {
    return this.api.get<CrmLead[]>(`crm/lists/${id}/leads`);
  }

  /** Add leads to a list. Idempotent — re-adding a member changes nothing. */
  addMembers(id: string, leadIds: string[]): Observable<{ added: number; memberCount: number }> {
    return this.api.post<{ added: number; memberCount: number }>(`crm/lists/${id}/leads`, { leadIds });
  }

  removeMember(id: string, leadId: string): Observable<{ success: boolean }> {
    return this.api.delete<{ success: boolean }>(`crm/lists/${id}/leads/${leadId}`);
  }
}
