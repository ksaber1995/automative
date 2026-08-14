import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  PutSecretValueCommand,
  DeleteSecretCommand,
  ResourceExistsException,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});

// Secrets are cached to keep a hot Lambda off the Secrets Manager API, but only
// for a few minutes. The cache used to be unbounded, which was harmless while
// every secret here was static (DB password, JWT keys) and quietly wrong once
// per-tenant WhatsApp tokens arrived: a rotated or reconnected token would be
// shadowed by the old one until the container died. Writes invalidate their own
// entry, so the TTL only matters for changes made outside this process.
const CACHE_TTL_MS = 5 * 60 * 1000;
const secretsCache: Record<string, { value: any; expiresAt: number }> = {};

export async function getSecret(secretId: string): Promise<any> {
  const cached = secretsCache[secretId];
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const command = new GetSecretValueCommand({ SecretId: secretId });
    const response = await client.send(command);

    if (response.SecretString) {
      const secret = JSON.parse(response.SecretString);
      secretsCache[secretId] = { value: secret, expiresAt: Date.now() + CACHE_TTL_MS };
      return secret;
    }

    throw new Error('Secret not found');
  } catch (error) {
    console.error('Error fetching secret:', error);
    throw error;
  }
}

/**
 * Write a JSON secret, creating it if this is the first time. Secrets Manager
 * has no upsert: CreateSecret on an existing name throws ResourceExistsException,
 * so fall through to PutSecretValue on that one error and let anything else
 * (denied, throttled) surface.
 */
export async function putSecret(secretId: string, value: any): Promise<void> {
  const secretString = JSON.stringify(value);
  try {
    await client.send(new CreateSecretCommand({ Name: secretId, SecretString: secretString }));
  } catch (error) {
    if (error instanceof ResourceExistsException) {
      await client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: secretString }));
    } else {
      throw error;
    }
  }
  secretsCache[secretId] = { value, expiresAt: Date.now() + CACHE_TTL_MS };
}

/** Best-effort delete. A secret that was never written is not an error. */
export async function deleteSecret(secretId: string): Promise<void> {
  delete secretsCache[secretId];
  try {
    // No recovery window: a disconnected tenant reconnecting would otherwise hit
    // "scheduled for deletion" on the same name and be unable to create it.
    await client.send(new DeleteSecretCommand({ SecretId: secretId, ForceDeleteWithoutRecovery: true }));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      console.error('Error deleting secret:', error);
    }
  }
}

export async function getDBCredentials(): Promise<{ username: string; password: string }> {
  const secretArn = process.env.DB_CREDENTIALS_SECRET_ARN;
  if (!secretArn) {
    throw new Error('DB_CREDENTIALS_SECRET_ARN not set');
  }
  return await getSecret(secretArn);
}

export async function getJWTSecret(): Promise<string> {
  const secretArn = process.env.JWT_SECRET_ARN;
  if (!secretArn) {
    throw new Error('JWT_SECRET_ARN not set');
  }
  const secret = await getSecret(secretArn);
  return secret.secret;
}

export async function getJWTRefreshSecret(): Promise<string> {
  const secretArn = process.env.JWT_REFRESH_SECRET_ARN;
  if (!secretArn) {
    throw new Error('JWT_REFRESH_SECRET_ARN not set');
  }
  const secret = await getSecret(secretArn);
  return secret.secret;
}

// ─── WhatsApp Cloud API ──────────────────────────────────────────────────────

/** Netrofit's Meta app, shared by all tenants. Created by the CDK stack. */
export interface WaPlatformConfig {
  meta_app_id: string;
  meta_app_secret: string;
  meta_config_id: string;
  webhook_verify_token: string;
}

/** One tenant's connected number. Written when they finish Embedded Signup. */
export interface WaTenantCredentials {
  phone_number_id: string;
  waba_id: string;
  access_token: string;
  display_phone_number?: string;
}

export async function getWaPlatformConfig(): Promise<WaPlatformConfig> {
  const secretArn = process.env.WA_PLATFORM_SECRET_ARN;
  if (!secretArn) {
    throw new Error('WA_PLATFORM_SECRET_ARN not set');
  }
  return await getSecret(secretArn);
}

/**
 * True once the Meta app credentials have actually been pasted in. The secret
 * exists from the first deploy with those fields blank, so its presence proves
 * nothing — callers must check this before assuming they can reach Meta.
 */
export function isWaPlatformConfigured(config: WaPlatformConfig): boolean {
  return !!(config?.meta_app_id && config?.meta_app_secret && config?.meta_config_id);
}

function waTenantSecretId(companyId: string): string {
  const prefix = process.env.WA_TENANT_SECRET_PREFIX;
  if (!prefix) {
    throw new Error('WA_TENANT_SECRET_PREFIX not set');
  }
  return `${prefix}${companyId}`;
}

export async function getWaTenantCredentials(companyId: string): Promise<WaTenantCredentials | null> {
  try {
    return await getSecret(waTenantSecretId(companyId));
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return null;
    throw error;
  }
}

export async function putWaTenantCredentials(companyId: string, creds: WaTenantCredentials): Promise<void> {
  await putSecret(waTenantSecretId(companyId), creds);
}

export async function deleteWaTenantCredentials(companyId: string): Promise<void> {
  await deleteSecret(waTenantSecretId(companyId));
}

// ─── Web Push (parent PWA notifications) ────────────────────────────────────
// See docs/parent-pwa-notifications-plan.md.

/** The VAPID keypair sendPush signs with. Created by the CDK stack, pasted in by hand. */
export interface PushVapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export async function getPushVapidConfig(): Promise<PushVapidConfig> {
  const secretArn = process.env.PUSH_VAPID_SECRET_ARN;
  if (!secretArn) {
    throw new Error('PUSH_VAPID_SECRET_ARN not set');
  }
  return await getSecret(secretArn);
}

/**
 * True once a real keypair has been generated and pasted in. The secret
 * exists from the first deploy with blank fields, so its presence proves
 * nothing — same reasoning as isWaPlatformConfigured.
 */
export function isPushVapidConfigured(config: PushVapidConfig): boolean {
  return !!(config?.publicKey && config?.privateKey);
}
