import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const DURATION_UNITS = { s: 1, m: 60, h: 3_600, d: 86_400 } as const;

/** "15m" -> 900. Kept to a small, explicit syntax so the value is easy to audit. */
const duration = z
  .string()
  .regex(/^[1-9]\d*[smhd]$/, 'must be a positive duration such as 900s, 15m, 1h or 1d')
  .transform((value) => Number(value.slice(0, -1)) * DURATION_UNITS[value.slice(-1) as keyof typeof DURATION_UNITS]);

const databaseUrl = z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' });

/** Comma-separated list of exact origins allowed by CORS. Empty means no cross-origin access. */
const corsOrigins = z
  .string()
  .default('')
  .transform((value, ctx): string[] => {
    const origins = value.split(',').map((entry) => entry.trim()).filter(Boolean);
    for (const origin of origins) {
      if (!URL.canParse(origin) || new URL(origin).origin !== origin) {
        ctx.addIssue({ code: 'custom', message: `"${origin}" is not an origin like https://example.org` });
        return z.NEVER;
      }
    }
    return origins;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  DATABASE_URL: databaseUrl,

  // HS256 requires a key of at least 256 bits.
  JWT_SECRET: z.string().refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'must be at least 32 bytes'),
  JWT_ISSUER: z.string().min(1).default('cloud-platform-gov-identity'),
  JWT_ACCESS_TOKEN_TTL: duration.prefault('15m'),

  CORS_ORIGIN: corsOrigins,
});

export type Config = z.output<typeof envSchema>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Validates environment variables. Empty strings are treated as unset so that
 * `FOO=` in an env file falls back to the default (or fails if required).
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const input = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = envSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
