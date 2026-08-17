import { randomBytes } from 'crypto';
import { query, queryOne } from '../db/connection';
import { enforceByIp, RateLimitBucket } from '../middleware/rate-limit';
import { apiError, mapThrownError } from '../utils/api-error';

/**
 * A link you can send to the print shop.
 *
 * The printer is not a user: no login, no tenant, no account. They need three
 * things — the cards to print, where to ship them, and who to ring if something
 * is wrong — and everything else about the tenant must stay invisible.
 *
 * The link is a snapshot, not a live query. The cards are pinned when it is
 * created, so minting another run tomorrow does not silently enlarge a job the
 * printer already quoted for, and marking a batch printed does not empty a link
 * that is still open on someone's screen.
 */

const PRINT_TOKEN_BYTES = 32;   // 64 hex characters
const DEFAULT_EXPIRY_DAYS = 30;

/**
 * Tight, per IP. The token is the only gate, so brute force is the thing to make
 * hopeless; a print shop opens one link a handful of times.
 */
const PRINT_JOB_IP: RateLimitBucket = { name: 'print-job:ip', limit: 120, windowMs: 15 * 60_000 };

let printJobSchemaEnsured = false;
export async function ensurePrintJobSchema(): Promise<void> {
  if (printJobSchemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS qr_card_print_jobs (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      -- The whole credential. 32 random bytes, hex.
      token         VARCHAR(64) NOT NULL UNIQUE,
      note          VARCHAR(200),
      -- The snapshot. An array rather than a join table: a run is capped at 2000
      -- and this is only ever read whole.
      card_ids      UUID[] NOT NULL DEFAULT '{}',
      -- Who made it, as free text: portal users are not rows in the users table.
      created_by    VARCHAR(255),
      created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      expires_at    TIMESTAMP WITH TIME ZONE NOT NULL,
      revoked_at    TIMESTAMP WITH TIME ZONE,
      -- So the office can see the printer actually got it.
      first_opened_at TIMESTAMP WITH TIME ZONE,
      last_downloaded_at TIMESTAMP WITH TIME ZONE,
      download_count INTEGER NOT NULL DEFAULT 0
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_print_jobs_company ON qr_card_print_jobs (company_id, created_at DESC)`);
  printJobSchemaEnsured = true;
}

/** Live = not revoked and not past its date. */
function jobIsOpen(row: any): boolean {
  if (!row) return false;
  if (row.revoked_at) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

export interface CreatePrintJobInput {
  companyId: string;
  /** Explicit cards, or undefined for "everything currently waiting to print". */
  ids?: string[];
  note?: string | null;
  expiresInDays?: number | null;
  createdBy?: string | null;
}

/**
 * Pin a set of cards to a new link.
 *
 * Only cards that are UNPRINTED and UNLINKED are eligible, and that is a
 * security rule as much as a workflow one — see the public route below for why a
 * linked card's token must never leave the building.
 */
export async function createPrintJob(input: CreatePrintJobInput) {
  await ensurePrintJobSchema();

  const rows = input.ids?.length
    ? await query<any>(
        `SELECT id FROM qr_cards
          WHERE company_id = $1 AND id = ANY($2::uuid[])
            AND student_id IS NULL AND printed_at IS NULL`,
        [input.companyId, input.ids],
      )
    : await query<any>(
        `SELECT id FROM qr_cards
          WHERE company_id = $1 AND student_id IS NULL AND printed_at IS NULL
          ORDER BY serial LIMIT 2000`,
        [input.companyId],
      );

  if (!rows.length) return null;

  const days = Math.min(Math.max(Number(input.expiresInDays) || DEFAULT_EXPIRY_DAYS, 1), 365);
  const job = await queryOne<any>(
    `INSERT INTO qr_card_print_jobs (company_id, token, note, card_ids, created_by, expires_at)
     VALUES ($1, $2, $3, $4::uuid[], $5, NOW() + ($6 || ' days')::interval)
     RETURNING *`,
    [
      input.companyId,
      randomBytes(PRINT_TOKEN_BYTES).toString('hex'),
      (input.note ?? '').trim().slice(0, 200) || null,
      rows.map((r) => r.id),
      input.createdBy ?? null,
      String(days),
    ],
  );
  return job;
}

export function mapPrintJob(row: any, appOrigin: string) {
  return {
    id: row.id,
    token: row.token,
    url: `${appOrigin}/p/print/${row.token}`,
    note: row.note ?? null,
    cardCount: Array.isArray(row.card_ids) ? row.card_ids.length : 0,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    firstOpenedAt: row.first_opened_at ? new Date(row.first_opened_at).toISOString() : null,
    lastDownloadedAt: row.last_downloaded_at ? new Date(row.last_downloaded_at).toISOString() : null,
    downloadCount: Number(row.download_count ?? 0),
    open: jobIsOpen(row),
  };
}

export const printJobRoutes = {
  /**
   * GET /api/public/print-jobs/:token
   *
   * Everything the print shop needs and nothing else: the academy's name so they
   * know whose job it is, the shipping address, a contact number, and the cards.
   *
   * LINKED CARDS ARE EXCLUDED, always. A card's token is the credential to a
   * student's public profile once it has been handed out — `/p/s/<token>` shows
   * their name, courses and attendance to anyone holding it. A card sitting in a
   * box has no student attached, so its token is worth nothing; the moment it is
   * linked, that token becomes personal data. Filtering here means a job created
   * last month cannot leak a student who was given one of its cards since.
   */
  get: async ({ params }: { params: { token: string } }) => {
    enforceByIp(PRINT_JOB_IP);
    try {
      await ensurePrintJobSchema();
      const token = (params.token || '').trim();
      // Cheap shape check before touching the database.
      if (!/^[a-f0-9]{32,64}$/i.test(token)) {
        return apiError(404, 'ERRORS.PRINT_JOB.NOT_FOUND', 'Not found');
      }

      const job = await queryOne<any>('SELECT * FROM qr_card_print_jobs WHERE token = $1', [token]);
      // One answer for missing, revoked and expired — a print link is a
      // credential, and telling them apart is a way to probe for live ones.
      if (!jobIsOpen(job)) {
        return apiError(404, 'ERRORS.PRINT_JOB.NOT_FOUND', 'Not found');
      }

      const company = await queryOne<any>(
        `SELECT c.name, c.address, c.card_design,
                NULLIF(CONCAT('+', u.country_code, u.phone), '+') AS mobile
           FROM companies c
           LEFT JOIN users u ON u.id = c.created_by
          WHERE c.id = $1`,
        [job.company_id],
      );

      const cards = await query<any>(
        `SELECT id, token, serial FROM qr_cards
          WHERE id = ANY($1::uuid[]) AND student_id IS NULL
          ORDER BY serial`,
        [job.card_ids],
      );

      // Best effort: the page is readable whether or not this write lands.
      if (!job.first_opened_at) {
        await query('UPDATE qr_card_print_jobs SET first_opened_at = NOW() WHERE id = $1', [job.id])
          .catch(() => {});
      }

      return {
        status: 200 as const,
        body: {
          academyName: company?.name ?? '',
          // The reason the link exists at all.
          address: (company?.address ?? '').trim() || null,
          contactPhone: company?.mobile ?? null,
          note: job.note ?? null,
          expiresAt: job.expires_at ? new Date(job.expires_at).toISOString() : null,
          // The tenant's own card artwork, so the printer gets real cards rather
          // than bare QR squares.
          cardDesign: company?.card_design ?? null,
          cards: cards.map((c) => ({ token: c.token, serial: Number(c.serial) })),
        },
      };
    } catch (error: any) {
      if (error?.statusCode === 429) throw error;
      console.error('Print job fetch failed:', error);
      return mapThrownError(error, 'ERRORS.PRINT_JOB.FAILED', 'Failed to load the print job');
    }
  },

  /**
   * POST /api/public/print-jobs/:token/downloaded
   * The page calls this once the zip has been handed to the browser, so the
   * office can see the printer actually took delivery.
   */
  markDownloaded: async ({ params }: { params: { token: string } }) => {
    enforceByIp(PRINT_JOB_IP);
    try {
      await ensurePrintJobSchema();
      const token = (params.token || '').trim();
      if (!/^[a-f0-9]{32,64}$/i.test(token)) {
        return apiError(404, 'ERRORS.PRINT_JOB.NOT_FOUND', 'Not found');
      }
      const job = await queryOne<any>('SELECT * FROM qr_card_print_jobs WHERE token = $1', [token]);
      if (!jobIsOpen(job)) return apiError(404, 'ERRORS.PRINT_JOB.NOT_FOUND', 'Not found');

      await query(
        `UPDATE qr_card_print_jobs
            SET download_count = download_count + 1, last_downloaded_at = NOW()
          WHERE id = $1`,
        [job.id],
      );
      return { status: 200 as const, body: { success: true } };
    } catch (error: any) {
      if (error?.statusCode === 429) throw error;
      return mapThrownError(error, 'ERRORS.PRINT_JOB.FAILED', 'Failed to record the download');
    }
  },
};
