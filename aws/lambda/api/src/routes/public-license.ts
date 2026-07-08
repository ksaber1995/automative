import { query, queryOne } from '../db/connection';
import { enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';
import { apiError } from '../utils/api-error';
import { ensureOfflineLicenseTable } from '../utils/ensure-offline-license';
import { signLicenseToken, LicenseTokenPayload } from '../utils/license-signing';

const TRIAL_DAYS = 7;

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/** Compute the live status of a license row and build the signed-token payload. */
function buildPayload(lic: any, deviceId: string): LicenseTokenPayload {
  const now = new Date();
  const trialEndsAt = lic.trial_ends_at ? new Date(lic.trial_ends_at) : null;
  const activationEndsAt = lic.activation_ends_at ? new Date(lic.activation_ends_at) : null;

  let status: LicenseTokenPayload['status'];
  if (lic.revoked) {
    status = 'EXPIRED';
  } else if (lic.activated && (!activationEndsAt || activationEndsAt >= startOfToday())) {
    status = 'ACTIVE';
  } else if (!lic.activated && trialEndsAt && now <= trialEndsAt) {
    status = 'TRIAL';
  } else {
    status = 'EXPIRED';
  }

  return {
    licenseKey: lic.license_key ?? null,
    deviceId,
    tier: lic.tier,
    status,
    trialEndsAt: lic.trial_ends_at ? new Date(lic.trial_ends_at).toISOString() : null,
    activated: !!lic.activated,
    activationEndsAt: activationEndsAt ? activationEndsAt.toISOString() : null,
    issuedAt: now.toISOString(),
  };
}

/**
 * Public, UNAUTHENTICATED endpoints the offline desktop app phones home to.
 * The device id (a hash of the machine GUID) is the identity — there is no
 * tenant JWT. The customer self-registers with their name + phone to start a
 * 7-day trial; after it ends the app locks until they enter a product license
 * the owner issues (and enters via `activate`).
 */
export const publicLicenseRoutes = {
  // Called on every launch. Looks the device up and returns its current signed
  // status. If the device was never seen, tells the app to show the sign-up form.
  validate: async ({ body }: { body: { deviceId: string } }) => {
    enforceByIp(RATE_LIMITS.PUBLIC_LICENSE_IP);
    try {
      await ensureOfflineLicenseTable();
      const deviceId = (body?.deviceId || '').trim();
      if (!deviceId) {
        return apiError(400, 'ERRORS.LICENSE.INVALID_REQUEST', 'Device id is required');
      }
      const lic = await queryOne<any>('SELECT * FROM offline_license WHERE device_id = $1', [deviceId]);
      if (!lic) {
        return { status: 200 as const, body: { registered: false } };
      }
      return { status: 200 as const, body: { registered: true, ...signLicenseToken(buildPayload(lic, deviceId)) } };
    } catch (error: any) {
      console.error('License validate error:', error);
      return apiError(500, 'ERRORS.LICENSE.VALIDATE_FAILED', 'License validation failed');
    }
  },

  // First run: create the trial for this device from the customer's name/phone.
  // Idempotent — re-registering the same device just returns its current status.
  register: async ({ body }: { body: { deviceId: string; name: string; phone: string } }) => {
    enforceByIp(RATE_LIMITS.PUBLIC_LICENSE_IP);
    try {
      await ensureOfflineLicenseTable();
      const deviceId = (body?.deviceId || '').trim();
      const name = (body?.name || '').trim();
      const phone = (body?.phone || '').trim();
      if (!deviceId || !name || !phone) {
        return apiError(400, 'ERRORS.LICENSE.INVALID_REQUEST', 'Name, phone and device id are required');
      }

      let lic = await queryOne<any>('SELECT * FROM offline_license WHERE device_id = $1', [deviceId]);
      if (!lic) {
        const start = new Date();
        const end = new Date(start.getTime() + TRIAL_DAYS * 86_400_000);
        lic = await queryOne<any>(
          `INSERT INTO offline_license (device_id, name, phone, tier, trial_started_at, trial_ends_at)
           VALUES ($1, $2, $3, 'ACADEMY', $4, $5) RETURNING *`,
          [deviceId, name, phone, start.toISOString(), end.toISOString()]
        );
      }
      return { status: 200 as const, body: signLicenseToken(buildPayload(lic, deviceId)) };
    } catch (error: any) {
      console.error('License register error:', error);
      return apiError(500, 'ERRORS.LICENSE.VALIDATE_FAILED', 'Registration failed');
    }
  },

  // After the trial, the customer enters the product license the owner issued.
  // Matches it to their device's record and activates it.
  activate: async ({ body }: { body: { deviceId: string; licenseKey: string } }) => {
    enforceByIp(RATE_LIMITS.PUBLIC_LICENSE_IP);
    try {
      await ensureOfflineLicenseTable();
      const deviceId = (body?.deviceId || '').trim();
      const key = (body?.licenseKey || '').trim().toUpperCase();
      if (!deviceId || !key) {
        return apiError(400, 'ERRORS.LICENSE.INVALID_REQUEST', 'License key and device id are required');
      }

      const lic = await queryOne<any>('SELECT * FROM offline_license WHERE device_id = $1', [deviceId]);
      // Generic rejection — never reveal whether the device or the key is the problem.
      if (!lic || lic.revoked || !lic.license_key || lic.license_key.toUpperCase() !== key) {
        return apiError(400, 'ERRORS.LICENSE.INVALID_KEY', 'That license key is not valid for this device');
      }

      const updated = await queryOne<any>(
        `UPDATE offline_license SET activated = true, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [lic.id]
      );
      return { status: 200 as const, body: signLicenseToken(buildPayload(updated, deviceId)) };
    } catch (error: any) {
      console.error('License activate error:', error);
      return apiError(500, 'ERRORS.LICENSE.VALIDATE_FAILED', 'Activation failed');
    }
  },
};
