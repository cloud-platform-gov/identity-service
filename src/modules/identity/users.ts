import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { users, type User } from '../../db/schema.js';

export type PublicUser = Omit<User, 'passwordHash'>;

const UNIQUE_VIOLATION = '23505';

export function toPublicUser({ passwordHash: _passwordHash, ...user }: User): PublicUser {
  return user;
}

function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps driver errors, so the PostgreSQL code may sit on `cause`.
  for (let current = err; current instanceof Error; current = current.cause) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
  }
  return false;
}

/** Inserts a user, or returns null if the email is taken. Uniqueness is enforced by the database. */
export async function createUser(
  db: Database,
  values: { name: string; email: string; passwordHash: string },
): Promise<User | null> {
  try {
    const [user] = await db.insert(users).values(values).returning();
    return user ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function findUserByEmail(db: Database, email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

export async function findUserById(db: Database, id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}
