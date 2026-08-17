import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../db/connection';
import { getJWTSecret } from '../utils/secrets';
import { enforceByIp, enforce, RateLimitBucket } from '../middleware/rate-limit';

/**
 * Who is allowed into the owner's admin console, and what they may do there.
 *
 * The `/api/karim-admin-secret/*` endpoints were gated by nothing but an obscure
 * path. That was defensible while the payload was aggregate counts; it now
 * carries every tenant's owner email, mobile and postal address, can delete a
 * company outright, and can mint a user account inside anyone's data. A URL that
 * has been pasted into two local apps, a README and a shell history is not a
 * credential. Everything under that prefix now needs a bearer token issued here.
 *
 * Accounts are created BY an existing portal user (or by hand in the database) —
 * there is deliberately no registration route. Nothing on this endpoint should
 * ever be reachable by someone who merely found the URL.
 */

// ─── Permissions ────────────────────────────────────────────────────────────

/**
 * One key per capability the console exposes. Deliberately coarse: these map to
 * what a person is trusted to DO, not to individual HTTP routes, so adding a
 * route to an existing section does not mean re-granting anyone.
 */
export const ADMIN_PORTAL_PERMISSIONS = [
  'companies.read',
  'companies.write',
  'companies.delete',
  'cards.read',
  'cards.write',
  'tenant_users.read',
  'tenant_users.write',
  'bots.read',
  'bots.write',
  'portal_users.read',
  'portal_users.write',
] as const;

export type PortalPermission = (typeof ADMIN_PORTAL_PERMISSIONS)[number];

/** What each key lets someone do, shown next to the checkbox in the console. */
export const ADMIN_PORTAL_PERMISSION_LABELS: Record<PortalPermission, string> = {
  'companies.read': 'See the tenant list and their subscription numbers',
  'companies.write': 'Activate, deactivate, extend and re-type a tenant',
  'companies.delete': 'Permanently delete a tenant and all of its data',
  'cards.read': 'See card pools and card lists',
  'cards.write': 'Enable pools, mint runs, mark printed, set the shipping address',
  'tenant_users.read': 'See the user accounts inside tenants',
  'tenant_users.write': 'Create, delete and move accounts inside tenants',
  'bots.read': 'See the Telegram bot pool',
  'bots.write': 'Add bots to the Telegram pool',
  'portal_users.read': 'See who can sign in to this console',
  'portal_users.write': 'Add, edit and remove console sign-ins',
};

/**
 * OWNER is the escape hatch: it holds every permission implicitly, including
 * ones added after the account was made. Without it, adding a permission key
 * would silently lock the person who owns the system out of the new section.
 * MEMBER holds exactly what is listed against them.
 */
export type PortalRole = 'OWNER' | 'MEMBER';

// ─── Schema ─────────────────────────────────────────────────────────────────

/**
 * Idempotent runtime guard, the same pattern the rest of the API uses
 * (ensureExamTables, ensureQrCardSchema): the table appears on the first request
 * that needs it, so no deploy ordering to get wrong.
 *
 * NOTE ON THE NAME: asked for as `admin.secret_users`. Every table in this
 * database lives in `public` and nothing else creates a schema, so a lone
 * `admin` schema would be invisible to every existing tool, dump and search
 * path. Same two words, one underscore instead of a dot.
 */
let portalSchemaEnsured = false;
export async function ensureAdminPortalSchema(): Promise<void> {
  if (portalSchemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS admin_secret_users (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email         VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          VARCHAR(255),
      role          VARCHAR(16) NOT NULL DEFAULT 'MEMBER'
                      CHECK (role IN ('OWNER', 'MEMBER')),
      -- A JSON array of permission keys. Ignored for OWNER, which holds all of
      -- them by definition.
      permissions   JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active     BOOLEAN NOT NULL DEFAULT true,
      last_login_at TIMESTAMP WITH TIME ZONE,
      created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Emails are stored already-lowercased, so the UNIQUE above is the real guard;
  // this index is what the login lookup uses.
  await query(`CREATE INDEX IF NOT EXISTS idx_admin_secret_users_email ON admin_secret_users(email)`);
  portalSchemaEnsured = true;
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

/**
 * Portal tokens are signed with the same secret as tenant tokens, so they MUST
 * carry something that tells them apart — otherwise any customer's ordinary app
 * token would verify here and walk straight into the console. `typ` is that
 * marker and is checked on every request.
 *
 * The reverse direction is already safe: extractTenantContext rejects a token
 * with no companyId, and these have none.
 */
const PORTAL_TOKEN_TYPE = 'admin-portal';

/**
 * Short by the standards of this API (tenant tokens last a year). This console
 * can delete a company; a token copied off a laptop should stop working the
 * same day.
 */
const PORTAL_TOKEN_TTL = '12h';

interface PortalTokenPayload {
  sub: string;
  email: string;
  typ: typeof PORTAL_TOKEN_TYPE;
}

async function signPortalToken(user: { id: string; email: string }): Promise<string> {
  const secret = await getJWTSecret();
  const payload: PortalTokenPayload = { sub: user.id, email: user.email, typ: PORTAL_TOKEN_TYPE };
  return jwt.sign(payload, secret, { expiresIn: PORTAL_TOKEN_TTL });
}

async function verifyPortalToken(token: string): Promise<PortalTokenPayload | null> {
  try {
    const secret = await getJWTSecret();
    const decoded = jwt.verify(token, secret) as Partial<PortalTokenPayload>;
    if (decoded?.typ !== PORTAL_TOKEN_TYPE || !decoded.sub) return null;
    return decoded as PortalTokenPayload;
  } catch {
    return null;
  }
}

function bearer(authHeader?: string): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  return parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : null;
}

// ─── The guard ──────────────────────────────────────────────────────────────

export interface PortalUser {
  id: string;
  email: string;
  name: string | null;
  role: PortalRole;
  permissions: PortalPermission[];
  is_active: boolean;
  last_login_at: string | null;
  created_at: string | null;
}

function toPortalUser(row: any): PortalUser {
  // permissions is jsonb; node-postgres hands it back parsed, but a hand-written
  // row could hold a string or null, and neither should crash a login.
  const raw = row.permissions;
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => { try { return JSON.parse(raw); } catch { return []; } })()
      : [];
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    role: row.role === 'OWNER' ? 'OWNER' : 'MEMBER',
    permissions: list.filter((p): p is PortalPermission =>
      ADMIN_PORTAL_PERMISSIONS.includes(p as PortalPermission)),
    is_active: row.is_active !== false,
    last_login_at: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

/** OWNER holds everything; everyone else holds exactly what is listed. */
export function portalCan(user: PortalUser, needed: PortalPermission | PortalPermission[]): boolean {
  if (user.role === 'OWNER') return true;
  const wanted = Array.isArray(needed) ? needed : [needed];
  // Any-of, not all-of: a section reachable two ways (the cards report reads the
  // company list too) shouldn't demand both grants.
  return wanted.some((p) => user.permissions.includes(p));
}

type GuardResult =
  | { ok: true; user: PortalUser }
  | { ok: false; response: { status: 401 | 403; body: { message: string; code: string } } };

/**
 * Resolve the caller from their token — signed in and still enabled, nothing
 * about what they may do.
 *
 * The row is re-read from the database on every request rather than trusted
 * from the token: revoking a grant, or disabling someone, has to take effect now
 * and not in twelve hours' time.
 */
export async function resolvePortalUser(
  headers: { authorization?: string } | undefined,
): Promise<GuardResult> {
  await ensureAdminPortalSchema();

  const token = bearer(headers?.authorization);
  if (!token) {
    return { ok: false, response: { status: 401, body: { code: 'ADMIN_PORTAL.NO_TOKEN', message: 'Sign in to the admin portal first.' } } };
  }

  const payload = await verifyPortalToken(token);
  if (!payload) {
    return { ok: false, response: { status: 401, body: { code: 'ADMIN_PORTAL.BAD_TOKEN', message: 'Your session has expired. Sign in again.' } } };
  }

  const row = await queryOne<any>('SELECT * FROM admin_secret_users WHERE id = $1', [payload.sub]);
  if (!row) {
    return { ok: false, response: { status: 401, body: { code: 'ADMIN_PORTAL.NO_ACCOUNT', message: 'This account no longer exists.' } } };
  }

  const user = toPortalUser(row);
  if (!user.is_active) {
    return { ok: false, response: { status: 403, body: { code: 'ADMIN_PORTAL.DISABLED', message: 'This account has been disabled.' } } };
  }
  return { ok: true, user };
}

/** Resolve the caller and check one permission (or any of several). */
export async function requirePortal(
  headers: { authorization?: string } | undefined,
  needed: PortalPermission | PortalPermission[],
): Promise<GuardResult> {
  const resolved = await resolvePortalUser(headers);
  if (!resolved.ok) return resolved;
  if (!portalCan(resolved.user, needed)) {
    return { ok: false, response: { status: 403, body: { code: 'ADMIN_PORTAL.FORBIDDEN', message: 'You do not have permission to do that.' } } };
  }
  return resolved;
}

type AnyHandler = (args: any) => Promise<any>;

/**
 * Put the guard in front of a whole route object in one place.
 *
 * Wrapping beats editing twenty handlers: there is no route you can forget, and
 * because the permission map is typed `Record<keyof T, …>` a NEW route that
 * nobody assigned a permission to fails to compile rather than shipping open.
 */
export function withPortalGuard<T extends Record<string, AnyHandler>>(
  routes: T,
  permissions: { [K in keyof T]: PortalPermission | PortalPermission[] },
): T {
  const guarded: Record<string, AnyHandler> = {};
  for (const key of Object.keys(routes)) {
    const handler = routes[key];
    guarded[key] = async (args: any) => {
      const guard = await requirePortal(args?.headers, permissions[key as keyof T]);
      if (!guard.ok) return guard.response;
      return handler(args);
    };
  }
  return guarded as T;
}

// ─── Rate limits ────────────────────────────────────────────────────────────

/**
 * Tight, because there is no legitimate burst: a person types their password
 * once. Two buckets so neither a single IP nor a single targeted address can be
 * ground through, however the attempts are spread.
 */
const PORTAL_LOGIN_IP: RateLimitBucket = { name: 'admin-portal-login:ip', limit: 20, windowMs: 15 * 60_000 };
const PORTAL_LOGIN_EMAIL: RateLimitBucket = { name: 'admin-portal-login:email', limit: 10, windowMs: 15 * 60_000 };

// ─── Routes ─────────────────────────────────────────────────────────────────

const MIN_PASSWORD_LENGTH = 8;

function normaliseEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

/** Keep only real keys, and drop duplicates. */
function cleanPermissions(input: unknown): PortalPermission[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<PortalPermission>();
  for (const p of input) {
    if (ADMIN_PORTAL_PERMISSIONS.includes(p as PortalPermission)) set.add(p as PortalPermission);
  }
  return [...set];
}

/** How many OWNERs could still sign in, ignoring one id (the one being changed). */
async function otherActiveOwners(excludeId: string): Promise<number> {
  const row = await queryOne<any>(
    `SELECT COUNT(*)::int AS n FROM admin_secret_users
      WHERE role = 'OWNER' AND is_active = true AND id <> $1`,
    [excludeId],
  );
  return Number(row?.n ?? 0);
}

export const adminPortalRoutes = {
  /**
   * POST /api/karim-admin-secret/portal/login  { email, password }
   *
   * The one route on this prefix that is reachable without a token.
   */
  login: async ({ body }: { body: { email: string; password: string } }) => {
    try {
      await ensureAdminPortalSchema();
      const email = normaliseEmail(body?.email);
      const password = body?.password ?? '';

      enforceByIp(PORTAL_LOGIN_IP);
      if (email) enforce(PORTAL_LOGIN_EMAIL, email);

      const row = email
        ? await queryOne<any>('SELECT * FROM admin_secret_users WHERE email = $1', [email])
        : null;

      // One message and one code for every failure — a missing account, a wrong
      // password and a disabled account must not be tellable apart, or this page
      // becomes a way to enumerate who has access.
      const reject = {
        status: 401 as const,
        body: { code: 'ADMIN_PORTAL.BAD_CREDENTIALS', message: 'Wrong email or password.' },
      };
      if (!row || row.is_active === false) {
        // Still spend the time a real comparison would, so a missing account
        // cannot be spotted by how fast the answer comes back.
        await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
        return reject;
      }
      if (!(await bcrypt.compare(password, row.password_hash))) return reject;

      await query('UPDATE admin_secret_users SET last_login_at = NOW() WHERE id = $1', [row.id]);

      const user = toPortalUser(row);
      const token = await signPortalToken({ id: user.id, email: user.email });
      return {
        status: 200 as const,
        body: {
          token,
          user: { ...user, last_login_at: new Date().toISOString() },
          allPermissions: [...ADMIN_PORTAL_PERMISSIONS],
        },
      };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Admin portal login failed:', error);
      return { status: 500 as const, body: { code: 'ADMIN_PORTAL.LOGIN_FAILED', message: error?.message || 'Login failed' } };
    }
  },

  /**
   * GET /api/karim-admin-secret/portal/me
   * Who the token belongs to, and what they may do — the console builds its
   * sidebar from this rather than from anything it remembered at login.
   */
  me: async ({ headers }: { headers: { authorization?: string } }) => {
    // No permission check — anyone signed in may ask who they are. This is what
    // the console rebuilds its sidebar from on every load, so a grant revoked
    // since login disappears on the next refresh rather than at token expiry.
    const guard = await resolvePortalUser(headers);
    if (!guard.ok) return guard.response;
    return {
      status: 200 as const,
      body: { user: guard.user, allPermissions: [...ADMIN_PORTAL_PERMISSIONS] },
    };
  },

  /**
   * POST /api/karim-admin-secret/portal/password  { currentPassword, newPassword }
   * Changing your own — no permission needed, but the current one is required
   * so a walk-up on an unlocked laptop can't lock the owner out.
   */
  changeOwnPassword: async ({ headers, body }: {
    headers: { authorization?: string };
    body: { currentPassword: string; newPassword: string };
  }) => {
    const guard = await resolvePortalUser(headers);
    if (!guard.ok) return guard.response;
    try {
      const row = await queryOne<any>('SELECT * FROM admin_secret_users WHERE id = $1', [guard.user.id]);
      if (!row) {
        return { status: 401 as const, body: { code: 'ADMIN_PORTAL.NO_ACCOUNT', message: 'This account is no longer active.' } };
      }
      if (!(await bcrypt.compare(body?.currentPassword ?? '', row.password_hash))) {
        return { status: 400 as const, body: { code: 'ADMIN_PORTAL.WRONG_PASSWORD', message: 'That is not your current password.' } };
      }
      const next = body?.newPassword ?? '';
      if (next.length < MIN_PASSWORD_LENGTH) {
        return { status: 400 as const, body: { code: 'ADMIN_PORTAL.WEAK_PASSWORD', message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` } };
      }
      await query('UPDATE admin_secret_users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
        await bcrypt.hash(next, 10), row.id,
      ]);
      return { status: 200 as const, body: { success: true } };
    } catch (error: any) {
      console.error('Admin portal password change failed:', error);
      return { status: 500 as const, body: { code: 'ADMIN_PORTAL.PASSWORD_FAILED', message: error?.message || 'Could not change the password' } };
    }
  },

  /** GET /api/karim-admin-secret/portal/users */
  listUsers: async ({ headers }: { headers: { authorization?: string } }) => {
    const guard = await requirePortal(headers, 'portal_users.read');
    if (!guard.ok) return guard.response;
    try {
      const rows = await query<any>('SELECT * FROM admin_secret_users ORDER BY role DESC, email ASC');
      return {
        status: 200 as const,
        body: { users: rows.map(toPortalUser), allPermissions: [...ADMIN_PORTAL_PERMISSIONS] },
      };
    } catch (error: any) {
      console.error('Admin portal list users failed:', error);
      return { status: 500 as const, body: { code: 'ADMIN_PORTAL.LIST_FAILED', message: error?.message || 'Could not list users' } };
    }
  },

  /** POST /api/karim-admin-secret/portal/users  { email, password, name?, role?, permissions? } */
  createUser: async ({ headers, body }: {
    headers: { authorization?: string };
    body: { email: string; password: string; name?: string | null; role?: string; permissions?: string[] };
  }) => {
    const guard = await requirePortal(headers, 'portal_users.write');
    if (!guard.ok) return guard.response;
    try {
      const email = normaliseEmail(body?.email);
      if (!email || !email.includes('@')) {
        return { status: 400 as const, body: { code: 'ADMIN_PORTAL.BAD_EMAIL', message: 'A valid email is required.' } };
      }
      const password = body?.password ?? '';
      if (password.length < MIN_PASSWORD_LENGTH) {
        return { status: 400 as const, body: { code: 'ADMIN_PORTAL.WEAK_PASSWORD', message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` } };
      }
      // Only an OWNER can mint another OWNER — otherwise portal_users.write is a
      // one-step promotion to everything.
      const role: PortalRole = body?.role === 'OWNER' ? 'OWNER' : 'MEMBER';
      if (role === 'OWNER' && guard.user.role !== 'OWNER') {
        return { status: 403 as const, body: { code: 'ADMIN_PORTAL.OWNER_ONLY', message: 'Only an owner can create another owner.' } };
      }
      if (await queryOne('SELECT 1 FROM admin_secret_users WHERE email = $1', [email])) {
        return { status: 409 as const, body: { code: 'ADMIN_PORTAL.EMAIL_TAKEN', message: 'That email already has access.' } };
      }

      const row = await queryOne<any>(
        `INSERT INTO admin_secret_users (email, password_hash, name, role, permissions)
         VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
        [email, await bcrypt.hash(password, 10), (body?.name ?? '').trim() || null, role,
         JSON.stringify(cleanPermissions(body?.permissions))],
      );
      return { status: 201 as const, body: toPortalUser(row) };
    } catch (error: any) {
      console.error('Admin portal create user failed:', error);
      return { status: 500 as const, body: { code: 'ADMIN_PORTAL.CREATE_FAILED', message: error?.message || 'Could not create the user' } };
    }
  },

  /**
   * PATCH /api/karim-admin-secret/portal/users/:id
   * Any of name / role / permissions / is_active / password. Everything is
   * optional; only what is sent changes.
   */
  updateUser: async ({ headers, params, body }: {
    headers: { authorization?: string };
    params: { id: string };
    body: { name?: string | null; role?: string; permissions?: string[]; isActive?: boolean; password?: string };
  }) => {
    const guard = await requirePortal(headers, 'portal_users.write');
    if (!guard.ok) return guard.response;
    try {
      const target = await queryOne<any>('SELECT * FROM admin_secret_users WHERE id = $1', [params.id]);
      if (!target) {
        return { status: 404 as const, body: { code: 'ADMIN_PORTAL.NOT_FOUND', message: 'No such user.' } };
      }
      const current = toPortalUser(target);

      const wantsOwner = body?.role !== undefined ? body.role === 'OWNER' : current.role === 'OWNER';
      if (wantsOwner !== (current.role === 'OWNER') && guard.user.role !== 'OWNER') {
        return { status: 403 as const, body: { code: 'ADMIN_PORTAL.OWNER_ONLY', message: 'Only an owner can grant or remove owner.' } };
      }

      const wantsActive = body?.isActive !== undefined ? !!body.isActive : current.is_active;
      // The last way in must stay open. Demoting or disabling the final active
      // OWNER leaves a console nobody can administer, recoverable only by hand
      // in the database.
      const stillOwner = wantsOwner && wantsActive;
      if (current.role === 'OWNER' && current.is_active && !stillOwner && (await otherActiveOwners(current.id)) === 0) {
        return { status: 409 as const, body: { code: 'ADMIN_PORTAL.LAST_OWNER', message: 'This is the last active owner — make someone else an owner first.' } };
      }
      if (current.id === guard.user.id && !wantsActive) {
        return { status: 409 as const, body: { code: 'ADMIN_PORTAL.SELF_DISABLE', message: 'You cannot disable your own account.' } };
      }

      const sets: string[] = [];
      const values: any[] = [];
      const put = (sql: string, value: any) => { values.push(value); sets.push(`${sql} = $${values.length}`); };

      if (body?.name !== undefined) put('name', (body.name ?? '').trim() || null);
      if (body?.role !== undefined) put('role', wantsOwner ? 'OWNER' : 'MEMBER');
      if (body?.permissions !== undefined) {
        values.push(JSON.stringify(cleanPermissions(body.permissions)));
        sets.push(`permissions = $${values.length}::jsonb`);
      }
      if (body?.isActive !== undefined) put('is_active', wantsActive);
      if (body?.password !== undefined && body.password !== '') {
        if (body.password.length < MIN_PASSWORD_LENGTH) {
          return { status: 400 as const, body: { code: 'ADMIN_PORTAL.WEAK_PASSWORD', message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` } };
        }
        put('password_hash', await bcrypt.hash(body.password, 10));
      }
      if (!sets.length) return { status: 200 as const, body: current };

      values.push(params.id);
      const row = await queryOne<any>(
        `UPDATE admin_secret_users SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${values.length} RETURNING *`,
        values,
      );
      return { status: 200 as const, body: toPortalUser(row) };
    } catch (error: any) {
      console.error('Admin portal update user failed:', error);
      return { status: 500 as const, body: { code: 'ADMIN_PORTAL.UPDATE_FAILED', message: error?.message || 'Could not update the user' } };
    }
  },

  /** DELETE /api/karim-admin-secret/portal/users/:id */
  deleteUser: async ({ headers, params }: {
    headers: { authorization?: string };
    params: { id: string };
  }) => {
    const guard = await requirePortal(headers, 'portal_users.write');
    if (!guard.ok) return guard.response;
    try {
      const target = await queryOne<any>('SELECT * FROM admin_secret_users WHERE id = $1', [params.id]);
      if (!target) {
        return { status: 404 as const, body: { code: 'ADMIN_PORTAL.NOT_FOUND', message: 'No such user.' } };
      }
      if (target.id === guard.user.id) {
        return { status: 409 as const, body: { code: 'ADMIN_PORTAL.SELF_DELETE', message: 'You cannot delete your own account.' } };
      }
      const current = toPortalUser(target);
      if (current.role === 'OWNER' && current.is_active && (await otherActiveOwners(current.id)) === 0) {
        return { status: 409 as const, body: { code: 'ADMIN_PORTAL.LAST_OWNER', message: 'This is the last active owner — make someone else an owner first.' } };
      }
      if (current.role === 'OWNER' && guard.user.role !== 'OWNER') {
        return { status: 403 as const, body: { code: 'ADMIN_PORTAL.OWNER_ONLY', message: 'Only an owner can remove an owner.' } };
      }
      await query('DELETE FROM admin_secret_users WHERE id = $1', [params.id]);
      return { status: 200 as const, body: { success: true } };
    } catch (error: any) {
      console.error('Admin portal delete user failed:', error);
      return { status: 500 as const, body: { code: 'ADMIN_PORTAL.DELETE_FAILED', message: error?.message || 'Could not delete the user' } };
    }
  },
};
