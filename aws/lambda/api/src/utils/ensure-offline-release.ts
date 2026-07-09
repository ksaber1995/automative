import { query } from '../db/connection';
import { ensureOfflineLicenseTable } from './ensure-offline-license';

/**
 * Runtime, idempotent creation of the offline desktop auto-update tables. Like
 * `ensureOfflineLicenseTable`, the prod DB has no migration pipeline, so we
 * create these lazily on first use.
 *
 *  - `offline_release`      — one row per build the owner has published to the
 *                             update feed (version + the exact electron-updater
 *                             artifact metadata: filename, sha512, size).
 *  - `offline_update_channel` — the rollout control per channel: which version
 *                             is the target, what percentage of devices may take
 *                             it, and the version everyone else stays on. This is
 *                             what the owner edits from the admin console to
 *                             stage a rollout or roll a bad build back.
 *
 * Per-device overrides (pin a machine to a version, or freeze it) live as extra
 * columns on `offline_license`, keyed by the same device_id the app already
 * phones home with.
 */
let initPromise: Promise<void> | null = null;

export async function ensureOfflineReleaseTables(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        // The per-device override columns below hang off offline_license, so it
        // must exist first.
        await ensureOfflineLicenseTable();
        await query(`
          CREATE TABLE IF NOT EXISTS offline_release (
            id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            channel       VARCHAR(32)  NOT NULL DEFAULT 'latest',
            version       VARCHAR(32)  NOT NULL,
            -- The electron-updater artifact this version resolves to. These three
            -- fields are copied verbatim from the build's latest.yml so the feed
            -- endpoint can regenerate a valid latest.yml on the fly.
            exe_filename  VARCHAR(255) NOT NULL,
            sha512        TEXT         NOT NULL,
            size          BIGINT       NOT NULL,
            release_notes TEXT,
            release_date  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (channel, version)
          )
        `);

        await query(`
          CREATE TABLE IF NOT EXISTS offline_update_channel (
            channel          VARCHAR(32) PRIMARY KEY,
            -- The version this channel is currently rolling out.
            target_version   VARCHAR(32),
            -- 0..100. The fraction of devices (bucketed by a hash of their id)
            -- allowed onto target_version; everyone else stays on previous_version.
            rollout_percent  INTEGER NOT NULL DEFAULT 100
                               CHECK (rollout_percent BETWEEN 0 AND 100),
            -- The known-good version the non-rollout cohort stays on (and the
            -- rollback target). NULL means "hold on whatever they have".
            previous_version VARCHAR(32),
            updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Per-device overrides on the existing license row. pinned_version wins
        // over the channel rollout; update_blocked freezes a device entirely.
        await query(
          `ALTER TABLE offline_license ADD COLUMN IF NOT EXISTS pinned_version VARCHAR(32)`
        );
        await query(
          `ALTER TABLE offline_license ADD COLUMN IF NOT EXISTS update_blocked BOOLEAN NOT NULL DEFAULT false`
        );
      } catch (e) {
        initPromise = null; // allow a later retry
        throw e;
      }
    })();
  }
  return initPromise;
}
