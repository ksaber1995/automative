import { query } from '../db/connection';

/**
 * Runtime, idempotent creation of the `offline_license` table. The prod DB is
 * migrated ad-hoc (no automatic migration pipeline), so — like the other
 * `ensure*` guards in this codebase — we create the table lazily on first use.
 * Standalone table: offline desktop installs are NOT tenants of this DB, so
 * there is no company_id FK. One row per issued license.
 */
let initPromise: Promise<void> | null = null;

export async function ensureOfflineLicenseTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await query(`
          CREATE TABLE IF NOT EXISTS offline_license (
            id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            license_key        VARCHAR(64) NOT NULL UNIQUE,
            tier               VARCHAR(20) NOT NULL DEFAULT 'TEACHER'
                                 CHECK (tier IN ('TEACHER', 'ACADEMY')),
            label              VARCHAR(255),
            -- Customer contact number (for calling them); not used for validation.
            phone              VARCHAR(32),
            notes              TEXT,
            -- Bound on first successful validate; locks the license to one machine.
            device_id          VARCHAR(128),
            -- Trial starts on first device bind (first run), not on creation.
            trial_started_at   TIMESTAMP WITH TIME ZONE,
            trial_ends_at      TIMESTAMP WITH TIME ZONE,
            -- Owner activation (paid). activation_ends_at NULL = never expires.
            activated          BOOLEAN NOT NULL DEFAULT false,
            activation_ends_at DATE,
            revoked            BOOLEAN NOT NULL DEFAULT false,
            created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await query(
          `CREATE INDEX IF NOT EXISTS idx_offline_license_key ON offline_license(license_key)`
        );
        // Backfill the phone column on tables created before it was added.
        await query(`ALTER TABLE offline_license ADD COLUMN IF NOT EXISTS phone VARCHAR(32)`);
      } catch (e) {
        initPromise = null; // allow a later retry
        throw e;
      }
    })();
  }
  return initPromise;
}
