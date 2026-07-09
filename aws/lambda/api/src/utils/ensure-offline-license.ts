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
            -- The product license key. NULL during self-service trial; set by the
            -- owner once the customer pays, then entered in-app to unlock.
            license_key        VARCHAR(64) UNIQUE,
            tier               VARCHAR(20) NOT NULL DEFAULT 'ACADEMY'
                                 CHECK (tier IN ('TEACHER', 'ACADEMY')),
            label              VARCHAR(255),
            -- Customer-supplied on first run (self-registration).
            name               VARCHAR(255),
            -- Customer contact number (for calling them); not used for validation.
            phone              VARCHAR(32),
            notes              TEXT,
            -- Bound on first run (registration); locks the record to one machine.
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
        // Backfill columns / relax constraints on tables created earlier.
        await query(`ALTER TABLE offline_license ADD COLUMN IF NOT EXISTS phone VARCHAR(32)`);
        await query(`ALTER TABLE offline_license ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
        // The annual renewal fee agreed with this customer. Owner-only bookkeeping
        // (never sent to the client); recorded at activation, editable later.
        await query(`ALTER TABLE offline_license ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2)`);
        // Usage telemetry the desktop app reports on its licence heartbeat:
        // aggregate counts (never any student PII) + when it last phoned home.
        // Used to size each client and target offers.
        await query(`ALTER TABLE offline_license ADD COLUMN IF NOT EXISTS student_count INTEGER`);
        await query(`ALTER TABLE offline_license ADD COLUMN IF NOT EXISTS course_count INTEGER`);
        await query(
          `ALTER TABLE offline_license ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE`
        );
        // Trials now create rows without a key; the key is issued later.
        await query(`ALTER TABLE offline_license ALTER COLUMN license_key DROP NOT NULL`);
      } catch (e) {
        initPromise = null; // allow a later retry
        throw e;
      }
    })();
  }
  return initPromise;
}
