import { loadConfig, type Config } from '../../src/config/env.js';

export const TEST_SECRET = 'test-secret-that-is-long-enough-for-hs256-and-hs512-keys-0123456789';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused@localhost:5432/unused',
    JWT_SECRET: TEST_SECRET,
    JWT_ISSUER: 'test-issuer',
    JWT_ACCESS_TOKEN_TTL: '15m',
    ...overrides,
  });
}

export const validUser = { name: 'Maria Silva', email: 'maria@example.org', password: 'correct horse battery' };
export const validCredentials = { email: validUser.email, password: validUser.password };
