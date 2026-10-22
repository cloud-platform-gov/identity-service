import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { users } from '../src/db/schema.js';
import { signAccessToken } from '../src/modules/identity/tokens.js';
import { TEST_SECRET, testConfig, validCredentials, validUser } from './helpers/app.js';
import { createTestDb, resetDatabase } from './helpers/test-db.js';

const config = testConfig();
const { db, pool } = createTestDb();
const app = buildApp({ config, db });
const key = new TextEncoder().encode(TEST_SECRET);
const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

let userId: string;
let token: string;

beforeEach(async () => {
  await resetDatabase(db);
  userId = (await request(app).post('/identity/register').send(validUser)).body.user.id;
  token = (await request(app).post('/identity/login').send(validCredentials)).body.accessToken;
});
afterAll(() => pool.end());

function expectUnauthorized(res: request.Response) {
  expect(res.status).toBe(401);
  expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED', message: 'Authentication required' });
}

describe('GET /identity/me', () => {
  it('returns the public profile for a valid token', async () => {
    const res = await request(app).get('/identity/me').auth(token, { type: 'bearer' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: userId, name: validUser.name, email: validUser.email });
    expect(JSON.stringify(res.body)).not.toMatch(/password|argon2/i);
  });

  it('rejects a missing Authorization header', async () => {
    expectUnauthorized(await request(app).get('/identity/me'));
  });

  it('rejects a non-Bearer scheme', async () => {
    expectUnauthorized(await request(app).get('/identity/me').set('Authorization', `Basic ${token}`));
  });

  it('rejects a malformed token', async () => {
    expectUnauthorized(await request(app).get('/identity/me').auth('not.a.jwt', { type: 'bearer' }));
  });

  it('rejects a token signed with another secret', async () => {
    const forged = await signAccessToken({ ...config, JWT_SECRET: 'another-secret-that-is-also-32-bytes-long' }, userId);
    expectUnauthorized(await request(app).get('/identity/me').auth(forged, { type: 'bearer' }));
  });

  it('rejects a token from another issuer', async () => {
    const foreign = await signAccessToken({ ...config, JWT_ISSUER: 'someone-else' }, userId);
    expectUnauthorized(await request(app).get('/identity/me').auth(foreign, { type: 'bearer' }));
  });

  it('rejects an expired token', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const expired = await signAccessToken(config, userId, twoHoursAgo);
    expectUnauthorized(await request(app).get('/identity/me').auth(expired, { type: 'bearer' }));
  });

  it('rejects other algorithms, even with the right secret', async () => {
    const hs512 = await new SignJWT()
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject(userId)
      .setIssuer(config.JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    expectUnauthorized(await request(app).get('/identity/me').auth(hs512, { type: 'bearer' }));

    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${base64url({ alg: 'none' })}.${base64url({ sub: userId, iss: config.JWT_ISSUER, iat: now, exp: now + 300 })}.`;
    expectUnauthorized(await request(app).get('/identity/me').auth(unsigned, { type: 'bearer' }));
  });

  it('rejects a token missing required claims or with a non-UUID subject', async () => {
    const noExp = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(config.JWT_ISSUER)
      .setIssuedAt()
      .sign(key);
    expectUnauthorized(await request(app).get('/identity/me').auth(noExp, { type: 'bearer' }));

    const badSubject = await signAccessToken(config, 'admin');
    expectUnauthorized(await request(app).get('/identity/me').auth(badSubject, { type: 'bearer' }));
  });

  it('rejects a valid token whose account no longer exists', async () => {
    await db.delete(users).where(eq(users.id, userId));
    expectUnauthorized(await request(app).get('/identity/me').auth(token, { type: 'bearer' }));
  });
});

describe('POST /identity/logout', () => {
  it('returns 204 for an authenticated client', async () => {
    const res = await request(app).post('/identity/logout').auth(token, { type: 'bearer' });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('requires a valid token', async () => {
    expectUnauthorized(await request(app).post('/identity/logout'));
  });

  it('does not revoke the token: it stays valid until it expires (documented behaviour)', async () => {
    await request(app).post('/identity/logout').auth(token, { type: 'bearer' }).expect(204);
    const res = await request(app).get('/identity/me').auth(token, { type: 'bearer' });
    expect(res.status).toBe(200);
  });
});
