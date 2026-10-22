# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Identity Service of `cloud-platform-gov`, a citizen-services platform for a Cloud Computing course. It is built with Express 5 + TypeScript (strict, ESM, `nodenext`), with PostgreSQL via Drizzle, Argon2id and JWT (`jose`, HS256). It runs behind `../api-gateway` (Fastify, separate repo), which proxies `/api/v1/identity/*` to this service's `/identity/*`.

Scope rules:
- Only identity: register, login, `/me`, logout. Don't implement other services here.
- Don't put logic in the gateway.
- No DI container or extra layers: route handlers call plain functions in `src/modules/identity/`.
- Logout is stateless: the server does not revoke tokens. Don't claim it does. Revocation needs a real mechanism, and the README and tests must change with it.

The README is the user-facing spec: API contract, error codes, env table, gateway integration, AWS notes. **Update it whenever behaviour changes.**

## Commands

npm is the package manager. Node ≥ 24.

- `npm run dev`: tsx watch on `:4001`; loads `.env` if present.
- `npm run typecheck`: `tsc` over `src` + `tests` (`noEmit`).
- `npm run build`: emits `dist/` via `tsconfig.build.json`.
- `npm start`: runs `dist/server.js`.
- `npm run test:db:up`: starts a disposable Postgres on `:5433` from `docker-compose.test.yml`. **The tests need it.**
- `npm test`: `vitest run`.
  - Single file or test: `npx vitest run tests/me-logout.test.ts -t "expired"`.
- `npm run db:generate -- --name <change>`: generates SQL in `drizzle/` after editing `src/db/schema.ts`. Commit it.
- `npm run db:migrate`: applies migrations to `DATABASE_URL`. Migrations never run on app startup.
- `docker compose up --build -d --wait`: runs postgres, the one-shot `migrate` job, then the service. It needs `JWT_SECRET` in the env or `.env`; every compose command against this file fails without it.

Before finishing a change, run `npm run typecheck && npm test`. If you touch the `Dockerfile` or the dependencies, also run `docker build`.

## Architecture

- **`src/server.ts`**: the only file that reads `process.env`. It also owns the `pg.Pool`, signals and `process.exit`, and runs graceful shutdown (`server.close` → `pool.end`, 10 s cap).
- **`src/app.ts`**: `buildApp({ config, db })` returns an Express app without listening, so tests use Supertest. Middleware order: pino-http (request ID, redaction) → helmet → cors → `express.json` (10 kB) → routes → 404 → error handler.
- **`src/config/env.ts`**: the Zod schema is the single source of truth for env vars. `loadConfig(source)` treats empty strings as unset and throws `ConfigError` with `"VAR: message"` entries. `JWT_ACCESS_TOKEN_TTL` is parsed to **seconds** (a number) in `Config`.
- **`src/errors.ts`**: `HttpError(status, code, message, details?)` is the only client-safe error. `sendError` writes the gateway-compatible body `{error:{code,message,requestId,details?}}`. `errorHandler` maps `ZodError` → 400 and body-parser errors → 400/413, with fixed messages. Anything else → 500, with a generic message in production.
- **Handlers**: Express 5 forwards async errors, so handlers just `throw`. Validation is `schema.parse(req.body)`, which throws a `ZodError`.
- **`src/routes/identity.routes.ts`**: the routes are mounted at `IDENTITY_PREFIX = '/identity'` to match the gateway, which strips `/api/v1`. Don't mount them at `/api/v1/identity`.
- **`src/modules/identity/`**:
  - `schemas.ts`: email normalization lives here, and the DB uniqueness relies on it.
  - `password.ts`: Argon2id, plus `verifyAgainstDummy` for timing-equal login failures.
  - `tokens.ts`: sign/verify. Claims are only `sub`/`iss`/`iat`/`exp`, and only `HS256` is accepted.
  - `users.ts`: Drizzle queries. `createUser` returns `null` on a unique violation (`23505`, found by walking `err.cause`).
- **`src/middlewares/authenticate.ts`**: puts the token's `sub` in `res.locals.userId`. Every failure throws the same `unauthorized()` error.
- **`src/db/migrate.ts`**: both a CLI and `runMigrations(url)`, which the test global setup uses. `MIGRATIONS_FOLDER` resolves relative to the file, so it works from `src/` and `dist/`.

## Conventions

- Code style:
  - 2-space indent, single quotes, semicolons, trailing commas.
  - Relative imports end in `.js`, and type-only imports use `import type`.
  - `noUncheckedIndexedAccess` is on.
- Error codes are `UPPER_SNAKE_CASE` and part of the public contract (README list). Auth errors stay generic.
- Never log or return passwords, hashes or tokens. pino redacts `authorization`/`cookie`, and bodies are never logged.
- Comments are sparse and explain *why*.
- **Adding an env var** takes four edits:
  - the schema in `env.ts`
  - `.env.example`
  - the README env table
  - `docker-compose.yml`, if it matters in containers

  Add a case to `tests/config.test.ts` too.

## Testing notes

- Tests hit a real Postgres via `TEST_DATABASE_URL`.
  - `vitest.config.ts` defaults it to the `:5433` container.
  - `tests/helpers/test-db.ts` refuses any database whose name doesn't end in `_test`.
  - Never point tests at `DATABASE_URL`.
- `fileParallelism: false`, because all files share one DB. Each file calls `resetDatabase(db)` in `beforeEach` and `pool.end()` in `afterAll`.
- `tests/helpers/app.ts`:
  - `testConfig(overrides)`: `LOG_LEVEL=silent`, issuer `test-issuer`.
  - `validUser`: the register body.
  - `validCredentials`: the login body. Login schemas are strict, so sending `validUser` to login → 400.
- Expired tokens: pass a past `now` to `signAccessToken(config, id, now)`. No sleeps.
- DB-failure tests use a real pool pointed at `127.0.0.1:1`, not mocks.
