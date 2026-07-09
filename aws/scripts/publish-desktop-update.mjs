#!/usr/bin/env node
// Publish an offline-desktop build to the auto-update feed.
//
//   1. reads electron/release/latest.yml (produced by `electron-builder`)
//   2. uploads the installer + blockmap to s3://<bucket>/updates/<channel>/<version>/
//   3. registers the version in the admin release registry
//   4. (optional) points the channel at it with a rollout percentage
//
// Clients then pick it up automatically on their next launch/hourly check.
// No per-client shipping.
//
// Usage (PowerShell):
//   $env:API_BASE="https://xnbgr057y1.execute-api.eu-west-1.amazonaws.com/prod"
//   $env:UPDATES_BUCKET="<account>-netrofit-desktop-updates-prod"
//   node aws/scripts/publish-desktop-update.mjs --rollout 10
//
// Flags:
//   --channel <name>    feed channel (default: latest)
//   --rollout <0-100>   also set the channel rollout to this % (target = this build)
//   --previous <ver>    version the non-rollout cohort stays on (default: current target)
//   --release-dir <dir> where latest.yml lives (default: ../electron/release)
//   --dry-run           print actions without uploading or calling the API

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const API_BASE = (process.env.API_BASE || arg('api-base', '')).replace(/\/+$/, '');
const BUCKET = process.env.UPDATES_BUCKET || arg('bucket', '');
const CHANNEL = String(arg('channel', 'latest'));
const RELEASE_DIR = String(arg('release-dir', join(__dirname, '..', '..', 'electron', 'release')));
const ROLLOUT = arg('rollout', null);
const PREVIOUS = arg('previous', null);
const DRY = arg('dry-run', false) === true;

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!API_BASE) fail('API_BASE (or --api-base) is required, e.g. https://…/prod');
if (!BUCKET) fail('UPDATES_BUCKET (or --bucket) is required — see the DesktopUpdatesBucketName stack output');

// ── Parse latest.yml (a small, flat YAML — avoid a dependency) ──────────────
const ymlPath = join(RELEASE_DIR, `${CHANNEL}.yml`);
let yml;
try {
  yml = readFileSync(ymlPath, 'utf-8');
} catch {
  fail(`Could not read ${ymlPath}. Run \`npm run dist\` in electron/ first.`);
}

const version = /^version:\s*(.+)$/m.exec(yml)?.[1]?.trim();
// The first files[].url is the installer; top-level sha512/size mirror it.
const exeFilename = /- url:\s*(.+)$/m.exec(yml)?.[1]?.trim();
const sha512 = /^\s{4}sha512:\s*(.+)$/m.exec(yml)?.[1]?.trim();
const size = Number(/^\s{4}size:\s*(\d+)$/m.exec(yml)?.[1]?.trim());

if (!version || !exeFilename || !sha512 || !Number.isFinite(size)) {
  fail(`Could not parse version/url/sha512/size from ${ymlPath}`);
}

console.log(`\nPublishing ${exeFilename}  (v${version}, ${(size / 1e6).toFixed(1)} MB)  → channel "${CHANNEL}"\n`);

const s3Prefix = `s3://${BUCKET}/updates/${CHANNEL}/${version}`;
const uploads = [exeFilename, `${exeFilename}.blockmap`];

for (const file of uploads) {
  const src = join(RELEASE_DIR, file);
  const dst = `${s3Prefix}/${file}`;
  console.log(`  s3 cp ${file} → ${dst}`);
  if (!DRY) {
    execFileSync('aws', ['s3', 'cp', src, dst, '--only-show-errors'], { stdio: 'inherit' });
  }
}

async function adminPost(path, body) {
  const url = `${API_BASE}${path}`;
  if (DRY) {
    console.log(`  POST ${url}  ${JSON.stringify(body)}`);
    return;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`POST ${path} → ${res.status}: ${text}`);
  return text;
}

console.log(`\n  register release in feed registry…`);
await adminPost('/api/karim-admin-secret/desktop/releases', {
  channel: CHANNEL,
  version,
  exeFilename,
  sha512,
  size,
});

if (ROLLOUT !== null) {
  const pct = Math.max(0, Math.min(100, Number(ROLLOUT)));
  console.log(`  set rollout → target v${version} @ ${pct}%`);
  await adminPost('/api/karim-admin-secret/desktop/rollout', {
    channel: CHANNEL,
    targetVersion: version,
    rolloutPercent: pct,
    previousVersion: PREVIOUS ? String(PREVIOUS) : undefined,
  });
} else {
  console.log(`  (no --rollout given: version registered but not yet targeted; set rollout from the admin console)`);
}

console.log(`\n✓ Done.${DRY ? ' (dry run — nothing was uploaded or changed)' : ''}\n`);
