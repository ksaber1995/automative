import { query, queryOne } from '../db/connection';
import { enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';
import { apiError } from '../utils/api-error';
import { ensureOfflineLicenseTable } from '../utils/ensure-offline-license';
import { signLicenseToken, LicenseTokenPayload } from '../utils/license-signing';

const TRIAL_DAYS = 7;

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/**
 * Public, UNAUTHENTICATED endpoint the offline desktop app phones home to on
 * each launch. The license key is the only credential; there is no tenant JWT.
 *
 * On first contact it binds the license to the calling device and starts the
 * 7-day trial. Thereafter it enforces the device lock and returns a signed
 * token the app verifies + caches (so trial/expiry hold up offline).
 */
export const publicLicenseRoutes = {
  validate: async ({ body }: { body: { licenseKey: string; deviceId: string } }) => {
    // Rate-limit by IP so license keys can't be brute-forced.
    enforceByIp(RATE_LIMITS.PUBLIC_LICENSE_IP);
    try {
      await ensureOfflineLicenseTable();

      const key = (body?.licenseKey || '').trim().toUpperCase();
      const deviceId = (body?.deviceId || '').trim();
      if (!key || !deviceId) {
        return apiError(400, 'ERRORS.LICENSE.INVALID_REQUEST', 'License key and device id are required');
      }

      const lic = await queryOne<any>(
        'SELECT * FROM offline_license WHERE license_key = $1',
        [key]
      );
      // Generic "not found" for unknown OR revoked keys — never reveal which.
      if (!lic || lic.revoked) {
        return apiError(404, 'ERRORS.LICENSE.NOT_FOUND', 'License not found');
      }

      // Device binding: the first bind locks the key to this device. A
      // different device on an already-bound key is rejected. (An owner "reset
      // device" clears device_id so it can re-bind on a new machine.)
      if (!lic.device_id) {
        // Start the trial only the first time ever — a device reset must NOT
        // hand the customer a fresh trial.
        if (!lic.trial_started_at) {
          const trialStart = new Date();
          const trialEnd = new Date(trialStart.getTime() + TRIAL_DAYS * 86_400_000);
          lic.trial_started_at = trialStart.toISOString();
          lic.trial_ends_at = trialEnd.toISOString();
        }
        await query(
          `UPDATE offline_license
             SET device_id = $1, trial_started_at = $2, trial_ends_at = $3,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = $4`,
          [deviceId, lic.trial_started_at, lic.trial_ends_at, lic.id]
        );
        lic.device_id = deviceId;
      } else if (lic.device_id !== deviceId) {
        return apiError(403, 'ERRORS.LICENSE.DEVICE_MISMATCH', 'This license is already in use on another device');
      }

      // Compute the current status.
      const now = new Date();
      const trialEndsAt = lic.trial_ends_at ? new Date(lic.trial_ends_at) : null;
      const activationEndsAt = lic.activation_ends_at ? new Date(lic.activation_ends_at) : null;

      let status: LicenseTokenPayload['status'];
      if (lic.activated && (!activationEndsAt || activationEndsAt >= startOfToday())) {
        status = 'ACTIVE';
      } else if (!lic.activated && trialEndsAt && now <= trialEndsAt) {
        status = 'TRIAL';
      } else {
        status = 'EXPIRED';
      }

      const payload: LicenseTokenPayload = {
        licenseKey: key,
        deviceId,
        tier: lic.tier,
        status,
        trialEndsAt: lic.trial_ends_at ? new Date(lic.trial_ends_at).toISOString() : null,
        activated: !!lic.activated,
        activationEndsAt: lic.activation_ends_at
          ? new Date(lic.activation_ends_at).toISOString()
          : null,
        issuedAt: now.toISOString(),
      };

      return { status: 200 as const, body: signLicenseToken(payload) };
    } catch (error: any) {
      console.error('License validate error:', error);
      return apiError(500, 'ERRORS.LICENSE.VALIDATE_FAILED', 'License validation failed');
    }
  },
};
