import { defineConfig } from 'drizzle-kit';

// Only `drizzle-kit generate` is used, which needs no database connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
