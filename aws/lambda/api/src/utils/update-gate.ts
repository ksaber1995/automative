import { createHash } from 'crypto';

/**
 * Pure decision logic for the offline desktop auto-update feed. No I/O — the
 * caller loads the channel config, the device's overrides and the candidate
 * release rows from the DB, then asks these helpers what to serve. Kept
 * side-effect-free so it can be unit-tested without a database.
 */

export interface ReleaseRow {
  channel: string;
  version: string;
  exe_filename: string;
  sha512: string;
  size: number | string;
  release_date?: string | Date | null;
}

export interface ChannelConfig {
  target_version: string | null;
  rollout_percent: number; // 0..100
  previous_version: string | null;
}

export interface DeviceOverride {
  pinned_version?: string | null;
  update_blocked?: boolean | null;
}

/**
 * Stable 0..99 bucket for a device. Hashing the id (not a random draw) means a
 * device keeps the same bucket across launches, so raising rollout_percent only
 * ever adds devices to the new version — it never flip-flops one back.
 */
export function bucketFor(deviceId: string): number {
  const hex = createHash('sha256').update(deviceId || '').digest('hex').slice(0, 8);
  return parseInt(hex, 16) % 100;
}

/** Numeric semver compare of `a` vs `b`: -1, 0, or 1. Ignores pre-release tags. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Decide which version this device should be pointed at, given the channel
 * rollout and any per-device override. Returns a version string, or null to
 * mean "no opinion — hold the device on whatever it already runs".
 *
 * Precedence: a hard block > a per-device pin > the staged rollout.
 */
export function resolveTargetVersion(
  config: ChannelConfig | null,
  device: DeviceOverride | null,
  deviceId: string
): string | null {
  if (device?.update_blocked) return null; // frozen — never offer anything
  if (device?.pinned_version) return device.pinned_version;

  if (!config || !config.target_version) return null;
  const pct = Math.max(0, Math.min(100, Number(config.rollout_percent ?? 100)));
  if (pct >= 100) return config.target_version;
  if (pct <= 0) return config.previous_version ?? null;

  return bucketFor(deviceId) < pct
    ? config.target_version
    : config.previous_version ?? null;
}

function yamlDate(value: string | Date | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/**
 * Regenerate the electron-updater `latest.yml` for a resolved release. The file
 * `url` is left relative (just the artifact filename) exactly as electron-builder
 * emits it; the feed endpoint 302-redirects that filename to S3, so the large
 * binary never flows through Lambda.
 */
export function buildLatestYml(release: ReleaseRow): string {
  const size = Number(release.size);
  return (
    `version: ${release.version}\n` +
    `files:\n` +
    `  - url: ${release.exe_filename}\n` +
    `    sha512: ${release.sha512}\n` +
    `    size: ${size}\n` +
    `path: ${release.exe_filename}\n` +
    `sha512: ${release.sha512}\n` +
    `releaseDate: '${yamlDate(release.release_date)}'\n`
  );
}

/**
 * A syntactically-valid latest.yml whose version equals the client's current
 * version, so electron-updater cleanly reports "update-not-available" instead of
 * erroring. Used when the device is held/blocked or we have no artifact to offer.
 * The file fields are placeholders — nothing is ever downloaded because the
 * version is not newer.
 */
export function buildNoUpdateYml(currentVersion: string): string {
  const v = currentVersion && /^\d/.test(currentVersion) ? currentVersion : '0.0.0';
  return (
    `version: ${v}\n` +
    `files:\n` +
    `  - url: noop-${v}.exe\n` +
    `    sha512: AA==\n` +
    `    size: 0\n` +
    `path: noop-${v}.exe\n` +
    `sha512: AA==\n` +
    `releaseDate: '${new Date(0).toISOString()}'\n`
  );
}
