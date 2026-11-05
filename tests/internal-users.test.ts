import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { testConfig, validUser } from './helpers/app.js';
import { createTestDb, resetDatabase } from './helpers/test-db.js';

const INTERNAL_TOKEN = 'internal-token-that-is-at-least-32-bytes-long';

const { db, pool } = createTestDb();
const app = buildApp({ config: testConfig({ INTERNAL_API_TOKEN: INTERNAL_TOKEN }), db });

let userId: string;

beforeEach(async () => {
  await resetDatabase(db);
  userId = (await request(app).post('/identity/register').send(validUser)).body.user.id;
});
afterAll(() => pool.end());

function expectUnauthorized(res: request.Response) {
  expect(res.status).toBe(401);
  expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED', message: 'Authentication required' });
}

describe('GET /internal/users/:id', () => {
  it('returns only id, name and email for a valid internal token', async () => {
    const res = await request(app).get(`/internal/users/${userId}`).auth(INTERNAL_TOKEN, { type: 'bearer' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: userId, name: validUser.name, email: validUser.email } });
  });

  it('rejects a missing token', async () => {
    expectUnauthorized(await request(app).get(`/internal/users/${userId}`));
  });

  it('rejects a wrong token', async () => {
    const res = await request(app).get(`/internal/users/${userId}`).auth(`${INTERNAL_TOKEN}x`, { type: 'bearer' });
    expectUnauthorized(res);
  });

  it('rejects a user access token', async () => {
    const login = await request(app)
      .post('/identity/login')
      .send({ email: validUser.email, password: validUser.password });
    const res = await request(app).get(`/internal/users/${userId}`).auth(login.body.accessToken, { type: 'bearer' });
    expectUnauthorized(res);
  });

  it('checks the token before the id', async () => {
    expectUnauthorized(await request(app).get('/internal/users/not-a-uuid'));
  });

  it('returns 400 for an id that is not a UUID', async () => {
    const res = await request(app).get('/internal/users/not-a-uuid').auth(INTERNAL_TOKEN, { type: 'bearer' });
    expect(res.status).toBe(400);
  });

  it('returns 404 USER_NOT_FOUND for an unknown id', async () => {
    const res = await request(app).get(`/internal/users/${randomUUID()}`).auth(INTERNAL_TOKEN, { type: 'bearer' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('does not exist when INTERNAL_API_TOKEN is unset', async () => {
    const closed = buildApp({ config: testConfig(), db });
    const res = await request(closed).get(`/internal/users/${userId}`).auth(INTERNAL_TOKEN, { type: 'bearer' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });
});
