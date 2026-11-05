import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { unauthorized } from './authenticate.js';

const BEARER = /^Bearer (\S+)$/;

// Hashing first gives equal-length buffers, so timingSafeEqual never throws and leaks no length.
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/** Requires `Authorization: Bearer <INTERNAL_API_TOKEN>`; every failure is the same generic 401. */
export function requireInternalToken(token: string): RequestHandler {
  const expected = digest(token);
  return (req, _res, next) => {
    const presented = BEARER.exec(req.headers.authorization ?? '')?.[1];
    if (!presented || !timingSafeEqual(digest(presented), expected)) throw unauthorized();
    next();
  };
}
