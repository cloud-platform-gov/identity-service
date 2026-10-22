import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { Config } from '../../config/env.js';

const ALGORITHM = 'HS256';

type TokenConfig = Pick<Config, 'JWT_SECRET' | 'JWT_ISSUER' | 'JWT_ACCESS_TOKEN_TTL'>;

const subject = z.uuid();

function signingKey(config: TokenConfig): Uint8Array {
  return new TextEncoder().encode(config.JWT_SECRET);
}

/** Claims are limited to sub, iss, iat and exp; no personal data goes into the token. */
export function signAccessToken(config: TokenConfig, userId: string, now = new Date()): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT()
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(config.JWT_ISSUER)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + config.JWT_ACCESS_TOKEN_TTL)
    .sign(signingKey(config));
}

/** Returns the user ID, or null for any invalid, expired or unexpected token. */
export async function verifyAccessToken(config: TokenConfig, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(config), {
      algorithms: [ALGORITHM],
      issuer: config.JWT_ISSUER,
      requiredClaims: ['sub', 'iat', 'exp'],
    });
    const parsed = subject.safeParse(payload.sub);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
