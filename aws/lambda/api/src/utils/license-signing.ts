import { sign } from 'crypto';

/**
 * Signs the license-validate payload with an ed25519 private key so the
 * desktop app can verify it offline with the embedded public key. This stops a
 * user from forging a cached "activated forever" token: they can read the
 * cached token, but can't produce a valid signature for a tampered one.
 *
 * The private key (PEM, pkcs8) is provided via the LICENSE_SIGNING_KEY env var
 * (set on the Lambda, like the JWT secrets). The matching public key is baked
 * into the Electron build.
 *
 * Wire format returned to the client:
 *   { token: base64url(JSON(payload)), signature: base64url(ed25519(token)) }
 * The client verifies the signature over the exact `token` bytes, then decodes.
 */
export interface LicenseTokenPayload {
  licenseKey: string | null;
  deviceId: string;
  tier: 'TEACHER' | 'ACADEMY';
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED';
  trialEndsAt: string | null;
  activated: boolean;
  activationEndsAt: string | null;
  issuedAt: string;
}

export interface SignedLicense {
  token: string;
  signature: string;
}

function getPrivateKey(): string {
  const pem = process.env.LICENSE_SIGNING_KEY;
  if (!pem) {
    throw new Error('LICENSE_SIGNING_KEY is not configured');
  }
  // Allow the key to be provided with literal "\n" (some env UIs escape newlines).
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

export function signLicenseToken(payload: LicenseTokenPayload): SignedLicense {
  const token = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  // ed25519: the algorithm arg to sign() must be null.
  const signature = sign(null, Buffer.from(token, 'utf-8'), getPrivateKey()).toString('base64url');
  return { token, signature };
}
