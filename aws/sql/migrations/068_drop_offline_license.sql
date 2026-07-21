-- 068: drop the offline desktop product's license table.
--
-- The offline (Electron) build was discontinued. Its API routes, admin-console
-- screen, and signing key are gone; this table is the last thing left. Nothing
-- in the platform reads it — it was never a tenant table, just one row per
-- issued desktop license key.
--
-- Destructive and irreversible: back the rows up first if the trial/renewal
-- history is worth keeping for bookkeeping.
--   pg_dump --data-only --table=offline_license <db> > offline_license_backup.sql

DROP INDEX IF EXISTS idx_offline_license_key;
DROP TABLE IF EXISTS offline_license;
