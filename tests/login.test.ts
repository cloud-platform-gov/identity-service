import { decodeJwt, decodeProtectedHeader } from 'jose';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { testConfig, validCredentials, validUser } from './helpers/app.js';
import { createTestDb, resetDatabase } from './helpers/test-db.js';

const { db, pool } = createTestDb();
const app = buildApp({ config: testConfig({ JWT_ACCESS_TOKEN_TTL: '10m' }), db });
const login = (body: object) => request(app).post('/identity/login').send(body);

let userId: string;

beforeEach(async () => {
  await resetDatabase(db);
  const res = await request(app).post('/identity/register').send(validUser);
  userId = res.body.user.id;
});
afterAll(() => pool.end());

describe('POST /identity/login', () => {
  it('returns a signed HS256 access token with minimal claims', async () => {
    const res = await login(validCredentials);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accessToken: expect.any(String), tokenType: 'Bearer', expiresIn: 600 });

    expect(decodeProtectedHeader(res.body.accessToken)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = decodeJwt(res.body.accessToken);
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'iss', 'sub']);
    expect(claims).toMatchObject({ sub: userId, iss: 'test-issuer' });
    expect(claims.exp! - claims.iat!).toBe(600);
  });

  it('accepts the email in any case and with surrounding whitespace', async () => {
    const res = await login({ email: '  MARIA@Example.org', password: validUser.password });
    expect(res.status).toBe(200);
  });

  it('returns the same generic 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await login({ email: validUser.email, password: 'wrong password!' });
    const unknownEmail = await login({ email: 'nobody@example.org', password: validUser.password });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
      expect(res.body).not.toHaveProperty('accessToken');
    }
  });

  it.each([
    ['missing password', { email: validUser.email }],
    ['invalid email', { email: 'nope', password: 'x' }],
    ['empty password', { email: validUser.email, password: '' }],
  ])('returns 400 for %s', async (_case, body) => {
    const res = await login(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
