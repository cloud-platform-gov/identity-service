import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';

const required = {
  DATABASE_URL: 'postgres://identity:identity@localhost:5432/identity',
  JWT_SECRET: 'x'.repeat(32),
};

function issuesFor(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(required)).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 4001,
      JWT_ISSUER: 'cloud-platform-gov-identity',
      JWT_ACCESS_TOKEN_TTL: 900,
      CORS_ORIGIN: [],
    });
  });

  it('requires DATABASE_URL and JWT_SECRET, treating empty values as unset', () => {
    const issues = issuesFor({ DATABASE_URL: '', JWT_SECRET: '  ' });
    expect(issues).toHaveLength(2);
    expect(issues.join('\n')).toMatch(/DATABASE_URL/);
    expect(issues.join('\n')).toMatch(/JWT_SECRET/);
  });

  it('rejects a JWT_SECRET shorter than 32 bytes', () => {
    expect(issuesFor({ ...required, JWT_SECRET: 'x'.repeat(31) })).toEqual(['JWT_SECRET: must be at least 32 bytes']);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(issuesFor({ ...required, DATABASE_URL: 'mysql://localhost/db' })[0]).toMatch(/^DATABASE_URL:/);
  });

  it.each([
    ['30s', 30],
    ['15m', 900],
    ['2h', 7_200],
    ['1d', 86_400],
  ])('parses JWT_ACCESS_TOKEN_TTL=%s', (ttl, seconds) => {
    expect(loadConfig({ ...required, JWT_ACCESS_TOKEN_TTL: ttl }).JWT_ACCESS_TOKEN_TTL).toBe(seconds);
  });

  it.each(['0m', '15', '15 m', '-1h', '1w'])('rejects JWT_ACCESS_TOKEN_TTL=%s', (ttl) => {
    expect(issuesFor({ ...required, JWT_ACCESS_TOKEN_TTL: ttl })[0]).toMatch(/^JWT_ACCESS_TOKEN_TTL:/);
  });

  it('parses a CORS_ORIGIN list and rejects non-origins', () => {
    expect(loadConfig({ ...required, CORS_ORIGIN: 'http://localhost:5173, https://gov.example' }).CORS_ORIGIN).toEqual([
      'http://localhost:5173',
      'https://gov.example',
    ]);
    expect(issuesFor({ ...required, CORS_ORIGIN: 'https://gov.example/path' })[0]).toMatch(/^CORS_ORIGIN:/);
    expect(issuesFor({ ...required, CORS_ORIGIN: '*' })[0]).toMatch(/^CORS_ORIGIN:/);
  });
});
