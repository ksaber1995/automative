import type { APIGatewayProxyResult } from 'aws-lambda';
import { queryOne } from '../db/connection';
import { ensureOfflineReleaseTables } from '../utils/ensure-offline-release';
import {
  buildLatestYml,
  buildNoUpdateYml,
  resolveTargetVersion,
  ChannelConfig,
  DeviceOverride,
  ReleaseRow,
} from '../utils/update-gate';

/**
 * The offline desktop app's electron-updater feed. This is NOT a ts-rest route:
 * electron-updater speaks a fixed HTTP dialect (a raw `latest.yml` body, then a
 * binary download that may be redirected), so we intercept the path in the
 * Lambda handler before ts-rest and answer it directly.
 *
 *   GET /api/public/update/<channel>.yml   → gated latest.yml for this device
 *   GET /api/public/update/<artifact>      → 302 to the artifact in S3
 *
 * Per-device gating (staged rollout / pin / freeze) is applied only to the
 * `.yml` decision; once the client knows the version it wants, the artifact
 * requests are pure redirects to S3, so the 91 MB installer never flows through
 * (or is billed against) Lambda.
 */

const PREFIX = '/api/public/update/';

interface RawEventLike {
  path?: string;
  rawPath?: string;
  httpMethod?: string;
  requestContext?: { http?: { method?: string } };
  headers?: Record<string, string | undefined> | null;
}

function getMethod(event: RawEventLike): string {
  return (event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();
}

function getPath(event: RawEventLike): string {
  return event.path || event.rawPath || '';
}

function header(event: RawEventLike, name: string): string {
  const headers = event.headers || {};
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === want) return (headers[key] || '').trim();
  }
  return '';
}

function text(status: number, body: string, contentType = 'text/plain'): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
    body,
  };
}

/**
 * Returns a response when the request targets the update feed, or `null` to let
 * the normal ts-rest router handle everything else.
 */
export async function handleUpdateFeedRequest(
  event: RawEventLike
): Promise<APIGatewayProxyResult | null> {
  const path = getPath(event);
  if (!path.startsWith(PREFIX)) return null;
  if (getMethod(event) !== 'GET') return text(405, 'Method Not Allowed');

  const file = decodeURIComponent(path.slice(PREFIX.length).split('/')[0] || '');
  const deviceId = header(event, 'x-device-id');
  const currentVersion = header(event, 'x-app-version') || '0.0.0';

  try {
    await ensureOfflineReleaseTables();

    // ── Manifest request: /api/public/update/<channel>.yml ──────────────────
    if (file.endsWith('.yml')) {
      const channel = file.slice(0, -'.yml'.length) || 'latest';

      const config = await queryOne<ChannelConfig>(
        `SELECT target_version, rollout_percent, previous_version
           FROM offline_update_channel WHERE channel = $1`,
        [channel]
      );
      const device = deviceId
        ? await queryOne<DeviceOverride>(
            `SELECT pinned_version, update_blocked FROM offline_license WHERE device_id = $1`,
            [deviceId]
          )
        : null;

      const targetVersion = resolveTargetVersion(config, device, deviceId);
      if (!targetVersion) return text(200, buildNoUpdateYml(currentVersion), 'text/yaml');

      const release = await queryOne<ReleaseRow>(
        `SELECT channel, version, exe_filename, sha512, size, release_date
           FROM offline_release WHERE channel = $1 AND version = $2`,
        [channel, targetVersion]
      );
      // Never point a client at a version whose artifact we don't actually have.
      if (!release) return text(200, buildNoUpdateYml(currentVersion), 'text/yaml');

      return text(200, buildLatestYml(release), 'text/yaml');
    }

    // ── Artifact request: /api/public/update/<Setup-x.y.z.exe[.blockmap]> ────
    const base = (process.env.UPDATE_ARTIFACT_BASE_URL || '').replace(/\/+$/, '');
    if (!base) {
      console.error('UPDATE_ARTIFACT_BASE_URL is not configured');
      return text(500, 'Update storage not configured');
    }
    const exeName = file.replace(/\.blockmap$/, '');
    const release = await queryOne<ReleaseRow>(
      `SELECT channel, version FROM offline_release WHERE exe_filename = $1`,
      [exeName]
    );
    if (!release) return text(404, 'Unknown artifact');

    const location = `${base}/${release.channel}/${release.version}/${file}`;
    return {
      statusCode: 302,
      headers: { Location: location, 'Cache-Control': 'no-store' },
      body: '',
    };
  } catch (error: any) {
    console.error('Update feed error:', error);
    // Fail closed as "no update" rather than erroring the client's updater.
    if (file.endsWith('.yml')) return text(200, buildNoUpdateYml(currentVersion), 'text/yaml');
    return text(500, 'Update feed error');
  }
}
