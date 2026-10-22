import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { users } from '../src/db/schema.js';
import { testConfig, validUser } from './helpers/app.js';
import { createTestDb, resetDatabase } from './helpers/test-db.js';

const { db, pool } = createTestDb();
const app = buildApp({ config: testConfig(), db });
const register = (body: unknown) => request(app).post('/identity/register').send(body as object);

beforeEach(() => resetDatabase(db));
afterAll(() => pool.end());

describe('POST /identity/register', () => {
  it('creates a user and returns its public profile without a token', async () => {
    const res = await register(validUser);

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: validUser.name,
      email: validUser.email,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(res.body).not.toHaveProperty('accessToken');
    expect(JSON.stringify(res.body)).not.toMatch(/password|argon2/i);
  });

  it('stores an argon2id hash, never the plaintext password', async () => {
    await register(validUser);
    const [row] = await db.select().from(users).where(eq(users.email, validUser.email));

    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordHash).not.toContain(validUser.password);
    expect(await argon2.verify(row!.passwordHash, validUser.password)).toBe(true);
  });

  it('normalizes email and name', async () => {
    const res = await register({ ...validUser, name: '  Maria Silva ', email: '  Maria@Example.ORG ' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Maria Silva', email: 'maria@example.org' });
  });

  it('returns 409 for a duplicate email, including a case variant', async () => {
    expect((await register(validUser)).status).toBe(201);

    for (const email of [validUser.email, 'MARIA@example.org']) {
      const res = await register({ ...validUser, email });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED', requestId: expect.any(String) });
    }
    expect(await db.$count(users)).toBe(1);
  });

  it.each([
    ['missing name', { email: validUser.email, password: validUser.password }],
    ['blank name', { ...validUser, name: '   ' }],
    ['invalid email', { ...validUser, email: 'not-an-email' }],
    ['short password', { ...validUser, password: 'short' }],
    ['overlong password', { ...validUser, password: 'x'.repeat(129) }],
    ['non-string password', { ...validUser, password: 12345678 }],
    ['unknown field', { ...validUser, role: 'admin' }],
    ['array body', [validUser]],
  ])('returns 400 for %s', async (_case, body) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.details).toEqual(expect.any(Array));
    expect(JSON.stringify(res.body)).not.toContain(validUser.password);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/identity/register')
      .set('Content-Type', 'application/json')
      .send('{"name": "x",');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'BAD_REQUEST', message: 'Malformed JSON body' });
  });

  it('returns 415 for a non-JSON body', async () => {
    const res = await request(app).post('/identity/register').type('form').send('name=x&email=y');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('returns 413 for an oversized body', async () => {
    const res = await register({ ...validUser, name: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
