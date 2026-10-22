import { z } from 'zod';

/** Emails are compared and stored in this form; the unique constraint relies on it. */
export const normalizedEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));

// The upper bound caps the work Argon2 does per request.
const password = z.string().min(8).max(128);

export const registerSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: normalizedEmail,
  password,
});

// Login does not apply the password policy, so a policy change never locks out existing accounts.
export const loginSchema = z.strictObject({
  email: normalizedEmail,
  password: z.string().min(1).max(128),
});

export type RegisterInput = z.output<typeof registerSchema>;
export type LoginInput = z.output<typeof loginSchema>;
