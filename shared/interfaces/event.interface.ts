export type EventType = 'TRIP' | 'COMPETITION' | 'WORKSHOP' | 'SEMINAR' | 'CAMP' | 'OTHER';
export type EventStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface EventModel {
  id: string;
  companyId: string;
  branchId: string | null;
  name: string;
  code: string | null;
  eventType: EventType | string;
  description: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  budget: number | null;
  status: EventStatus | string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventCreateDto {
  branchId?: string | null;
  name: string;
  code?: string;
  eventType?: EventType;
  description?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  status?: EventStatus;
}

export interface EventUpdateDto extends Partial<EventCreateDto> {
  isActive?: boolean;
}

export interface EventPL {
  eventId: string;
  revenue: number;
  revenueCount: number;
  expenses: number;
  expenseCount: number;
  refunds: number;
  refundCount: number;
  productRevenue: number;
  productCost: number;
  productMargin: number;
  productSaleCount: number;
  netProfit: number;
  budget: number | null;
}
