/** A company row as the karim-admin-secret list returns it (snake_case). */
export interface AdminCompany {
  company_id: string;
  company_name?: string | null;
  company_type?: string | null;
  company_created_at?: string | null;
  currency?: string | null;
  mobile?: string | null;
  owner_email?: string | null;
  subscription_type?: string | null;
  price?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  employee_count?: number | null;
  branch_count?: number | null;
  student_count?: number | null;
  course_count?: number | null;
}

/** Per-company QR pool stats from /companies/:id/qr-cards. */
export interface QrCardStats {
  total?: number | null;
  linked?: number | null;
  printed?: number | null;
  unprinted?: number | null;
  /** Sum of every card's price, where one was recorded. */
  poolValue?: number | null;
  qr_cards_enabled?: boolean;
}

/** One card, as the owner endpoint returns it for printing. */
export interface AdminQrCard {
  id: string;
  token: string;
  serial: number;
  poolType: number;
  price: number | null;
  printedAt: string | null;
  printed: boolean;
  linked: boolean;
}

/** Which slice of a client's pool to fetch. */
export type CardStatus = 'unprinted' | 'printed' | 'free' | 'linked' | 'all';

/** A run to mint: how many, which type, and what each card costs. */
export interface GenerateCardsRequest {
  count: number;
  poolType: number;
  price: number | null;
}

/** An active client enriched with its card-pool numbers — what the table shows. */
export interface ClientRow {
  id: string;
  name: string;
  type: string;
  currency: string | null;
  createdAt: string | null;
  mobile: string | null;
  ownerEmail: string | null;
  subType: string | null;
  price: number | null;
  startDate: string | null;
  endDate: string | null;
  employees: number;
  branches: number;
  students: number;
  courses: number;
  /** Whether the client's QR card pool is switched on. */
  enabled: boolean;
  /** Size of the whole pool. */
  total: number;
  /** Cards handed out to a student. */
  linked: number;
  /** Cards still free in the pool. */
  unlinked: number;
  /** Already sent to the printer. */
  printed: number;
  /** The pending run — not printed and not handed out. */
  unprinted: number;
  /** Sum of recorded card prices. */
  poolValue: number;
}

export type SortKey = 'name' | 'type' | 'total' | 'linked' | 'unlinked';

export interface SortState {
  key: SortKey;
  /** 1 ascending, -1 descending. */
  dir: 1 | -1;
}
