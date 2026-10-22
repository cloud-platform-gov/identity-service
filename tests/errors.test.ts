import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { testConfig, validCredentials, validUser } from './helpers/app.js';

// Port 1 is closed, so every query fails to connect: a real database outage, not a mock.
const { db, pool } = createDb('postgres://identity:identity@127.0.0.1:1/identity_test', {
  connectionTimeoutMillis: 1_000,
});

afterAll(() => pool.end());

describe('error handling', () => {
  it('returns a generic 500 in production when the database is unavailable', async () => {
    const app = buildApp({ config: testConfig({ NODE_ENV: 'production' }), db });

    for (const [path, body] of [['/identity/register', validUser], ['/identity/login', validCredentials]] as const) {
      const res = await request(app).post(path).send(body);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: expect.any(String) },
      });
      expect(res.text).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|stack|at /);
    }
  });

  it('returns 404 in the common error format for unknown routes', async () => {
    const app = buildApp({ config: testConfig(), db });
    const res = await request(app).get('/api/v1/identity/me');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', requestId: expect.any(String) });
  });
});
