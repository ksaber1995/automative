import jwt, { SignOptions } from 'jsonwebtoken';
import { getJWTSecret, getJWTRefreshSecret } from './secrets';

export interface JWTPayload {
  id: string;
  email: string;
  role: string;
  branchId?: string | null;
}

let jwtSecret: string | null = null;
let jwtRefreshSecret: string | null = null;

async function getOrFetchJWTSecret(): Promise<string> {
  if (!jwtSecret) {
    jwtSecret = await getJWTSecret();
  }
  return jwtSecret;
}

async function getOrFetchJWTRefreshSecret(): Promise<string> {
  if (!jwtRefreshSecret) {
    jwtRefreshSecret = await getJWTRefreshSecret();
  }
  return jwtRefreshSecret;
}

export async function signToken(payload: JWTPayload): Promise<string> {
  const secret = await getOrFetchJWTSecret();
  const expiration = (process.env.JWT_EXPIRATION || '365d') as string;

  return jwt.sign(payload, secret, { expiresIn: expiration } as SignOptions);
}

export async function signRefreshToken(payload: JWTPayload): Promise<string> {
  const secret = await getOrFetchJWTRefreshSecret();
  const expiration = (process.env.JWT_REFRESH_EXPIRATION || '365d') as string;

  return jwt.sign(payload, secret, { expiresIn: expiration } as SignOptions);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const secret = await getOrFetchJWTSecret();

  try {
    const decoded = jwt.verify(token, secret) as JWTPayload;
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

export async function verifyRefreshToken(token: string): Promise<JWTPayload> {
  const secret = await getOrFetchJWTRefreshSecret();

  try {
    const decoded = jwt.verify(token, secret) as JWTPayload;
    return decoded;
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
}

export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}
