/**
 * Types for the Cards section — the per-client card-pool report.
 *
 * Ported wholesale from the standalone `cards/` app so the two read the same
 * endpoint the same way. Keep them in step: a field added here almost certainly
 * belongs there too.
 */

/** A company row as the karim-admin-secret list returns it (snake_case). */
export interface AdminCompany {
  company_id: string;
  company_name?: string | null;
  company_type?: string | null;
  company_created_at?: string | null;
  currency?: string | null;
  /** Where this client's printed cards get shipped (companies.address). */
  address?: string | null;
  mobile?: string | null;
  owner_email?: string | null;
  subscription_type?: string | null;
  price?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  employee_count?: number | null;
  branch_count?: number | null;
  student_count?: number | null;
  /** Students still on the roll, as opposed to everyone ever enrolled. */
  active_student_count?: number | null;
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

/**
 * A link handed to an outside print shop: the cards, and where to ship them.
 * `open` folds "not revoked and not past its date" into the one flag the UI
 * should branch on.
 */
export interface PrintLink {
  id: string;
  token: string;
  /** What gets pasted into a message to the printer. */
  url: string;
  note: string | null;
  cardCount: number;
  createdBy: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  /** So the office can see the printer actually opened it. */
  firstOpenedAt: string | null;
  lastDownloadedAt: string | null;
  downloadCount: number;
  open: boolean;
}

/** Which slice of a client's pool to fetch. */
export type CardStatus = 'unprinted' | 'printed' | 'free' | 'linked' | 'all';

/** A run to mint: how many, which type, and what each card costs. */
export interface GenerateCardsRequest {
  count: number;
  poolType: number;
  price: number | null;
  /**
   * The PRINTED number the run starts at — 500 makes the first card read
   * "0500". Null continues from the client's last card.
   */
  startFrom: number | null;
}

/** An active client enriched with its card-pool numbers — what the table shows. */
export interface ClientRow {
  id: string;
  name: string;
  type: string;
  currency: string | null;
  createdAt: string | null;
  /** Shipping destination for this client's cards; null when nobody has set one. */
  address: string | null;
  mobile: string | null;
  ownerEmail: string | null;
  subType: string | null;
  price: number | null;
  startDate: string | null;
  endDate: string | null;
  employees: number;
  branches: number;
  students: number;
  /**
   * Students still on the roll. The number that says how big a client actually
   * is — `students` counts every leaver they ever had as well.
   */
  activeStudents: number;
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

/**
 * The sortable columns, as a runtime list so a `?sort=` value arriving from the
 * address bar can be checked against something rather than cast. The type is
 * derived from it, so the two can never drift.
 */
export const SORT_KEYS = [
  'name', 'type', 'activeStudents', 'students', 'total', 'linked', 'unlinked',
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

export interface SortState {
  key: SortKey;
  /** 1 ascending, -1 descending. */
  dir: 1 | -1;
}

/** What the table sorts by until someone says otherwise: biggest pool first. */
export const DEFAULT_SORT: SortState = { key: 'total', dir: -1 };
