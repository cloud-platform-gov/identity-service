# Identity Service

Citizen registration, authentication and identity for the **cloud-platform-gov** citizen services platform. It sits behind the [API Gateway](../api-gateway), which is the single public entry point.

**Responsibilities**
- Register citizens with a normalized, unique email and an Argon2id password hash.
- Authenticate citizens and issue short-lived JWT access tokens.
- Return the authenticated citizen's public profile.
- Expose a process health check (`GET /health`).

**Not** handled here: authorization rules for other services, refresh tokens, email verification, password reset (see [Future improvements](#future-improvements)).

## Stack

Node.js 24 LTS · TypeScript (strict, ESM) · Express 5 · Zod · PostgreSQL 17 · Drizzle ORM · Argon2id (`argon2`) · JWT (`jose`) · helmet · pino · Vitest + Supertest · Docker / Docker Compose

Why these:
- **Express 5** forwards rejected promises from async handlers to the error middleware, so there is no async wrapper boilerplate.
- **Drizzle** keeps queries typed and parameterized, and generates plain SQL migrations that are committed and reviewable.
- **Argon2id** is the OWASP-recommended password hash. The library defaults (m=64 MiB, t=3, p=4) are used.
- **`jose`** is a maintained, dependency-free JWT library. Verification is restricted to `HS256`.

## Prerequisites

- Node.js ≥ 24 and npm
- Docker with Compose v2+ (PostgreSQL, the test database, and container workflows)

## Getting started (service on the host, database in Docker)

```bash
npm install
cp .env.example .env
# set JWT_SECRET in .env, e.g. with: openssl rand -base64 48

JWT_SECRET=unused docker compose up -d --wait postgres   # PostgreSQL on localhost:5432
npm run db:migrate                                       # apply migrations to DATABASE_URL
npm run dev                                              # http://localhost:4001
```

Compose reads `JWT_SECRET` from `.env` automatically. Without it, every `docker compose` command for this file fails fast; `JWT_SECRET=unused` above just satisfies that check when only starting PostgreSQL.

| Command | Purpose |
|---|---|
| `npm run dev` | Run from TypeScript sources with reload (loads `.env` if present) |
| `npm run typecheck` | Type-check `src` and `tests` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run db:generate` | Generate a new migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` (from sources) |
| `npm run db:migrate:prod` | Same, from the compiled build (used in the image) |
| `npm run db:studio` | Open Drizzle Studio on `DATABASE_URL` (from `.env`, default local Compose DB) at https://local.drizzle.studio |
| `npm run test:db:up` / `test:db:down` | Start / remove the disposable test database |
| `npm test` | Run the Vitest suite once |
| `npx vitest run tests/login.test.ts -t "generic 401"` | Run one file / test by name |

## Configuration

All configuration comes from environment variables, validated at startup with Zod. If validation fails, the service exits with code 1 and lists every invalid variable. Empty values count as unset.

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production`. In `production`, 500 responses carry a generic message. |
| `HOST` | `0.0.0.0` | Listen address (`0.0.0.0` is required inside containers). |
| `PORT` | `4001` | Listen port. 4001 is what the API Gateway expects. |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, or `silent`. Logs are structured JSON (pino). |
| `DATABASE_URL` | **required** | `postgres://` or `postgresql://` connection string. |
| `JWT_SECRET` | **required** | HS256 signing key, at least 32 bytes. Never commit it. |
| `JWT_ISSUER` | `cloud-platform-gov-identity` | `iss` claim set on and required from tokens. |
| `JWT_ACCESS_TOKEN_TTL` | `15m` | Access-token lifetime: `<n>s`, `<n>m`, `<n>h` or `<n>d`. |
| `CORS_ORIGIN` | _empty_ | Comma-separated exact origins allowed by CORS. Empty means no cross-origin browser access. |
| `TEST_DATABASE_URL` | `postgres://identity:identity@localhost:5433/identity_test` | Tests only. The database name must end in `_test`. |

`.env.example` contains only local-development values. The `identity`/`identity` PostgreSQL credentials are local-only and exist solely in `docker-compose.yml`.

## API

Routes are served under `/identity`. Through the gateway, the public URLs are `/api/v1/identity/...` (see [API Gateway integration](#api-gateway-integration)).

| Method | Service path | Public path (via gateway) | Auth |
|---|---|---|---|
| `GET` | `/health` | n/a (gateway has its own `/health`) | none |
| `POST` | `/identity/register` | `/api/v1/identity/register` | none |
| `POST` | `/identity/login` | `/api/v1/identity/login` | none |
| `GET` | `/identity/me` | `/api/v1/identity/me` | Bearer |
| `POST` | `/identity/logout` | `/api/v1/identity/logout` | Bearer |

**`GET /health`** → `200 {"status":"ok","service":"identity-service","uptimeSeconds":12}`. This is liveness only: it does not query the database, so a database outage does not make the container restart in a loop.

**`POST /identity/register`**, with body `{"name", "email", "password"}` (`Content-Type: application/json`):
- `name`: trimmed, 1–100 chars.
- `email`: trimmed and lower-cased, then validated (max 254 chars).
- `password`: 8–128 chars.
- Unknown fields are rejected.

Responses:
- `201 {"user": {"id", "name", "email", "createdAt", "updatedAt"}}`. No token is issued; the client logs in separately.
- `409 EMAIL_ALREADY_REGISTERED`: the email is taken. The database unique constraint is the source of truth, so concurrent registrations can't both succeed.
- `400 BAD_REQUEST`: validation failed (with `details`) or the JSON is malformed.
- `413 PAYLOAD_TOO_LARGE`: the body is over 10 kB.
- `415 UNSUPPORTED_MEDIA_TYPE`: the body is not JSON.

**`POST /identity/login`**, with body `{"email", "password"}`:
- `200 {"accessToken": "<jwt>", "tokenType": "Bearer", "expiresIn": 900}`, where `expiresIn` is in seconds.
- `401 INVALID_CREDENTIALS`: the same body for an unknown email and a wrong password. For an unknown email, an Argon2 verification against a dummy hash still runs, so response time doesn't reveal whether the account exists.
- `400 BAD_REQUEST`: invalid payload.

**`GET /identity/me`**, with header `Authorization: Bearer <jwt>`:
- `200 {"user": {...}}`. The user is reloaded from the database on every call.
- `401 UNAUTHORIZED`: the header is missing or not `Bearer`, or the token is malformed, expired, signed with another key or algorithm, from another issuer, missing claims, or belongs to a deleted account. Every case gets the same generic message.

**`POST /identity/logout`**, with header `Authorization: Bearer <jwt>` → `204`, or `401` without a valid token. See [Logout semantics](#jwt-expiration-and-logout-semantics).

### Error format

Same shape as the API Gateway, plus optional validation `details`:

```json
{ "error": { "code": "BAD_REQUEST", "message": "Request validation failed", "requestId": "4f1c…",
             "details": [{ "path": "email", "message": "Invalid email address" }] } }
```

The codes are:
- `BAD_REQUEST`
- `UNAUTHORIZED`
- `INVALID_CREDENTIALS`
- `NOT_FOUND`
- `EMAIL_ALREADY_REGISTERED`
- `PAYLOAD_TOO_LARGE`
- `UNSUPPORTED_MEDIA_TYPE`
- `INTERNAL_ERROR`

Stack traces and database errors are only logged, never returned. In production, 500s always say `Internal server error`.

Every response carries `x-request-id`. The service reuses the gateway's ID if it is safe (`[A-Za-z0-9_.-]`, at most 128 chars); otherwise it generates a UUID.

### Access-token claims

The token is signed with `HS256` and has this header and payload:

```json
{ "alg": "HS256", "typ": "JWT" }
{ "sub": "<user uuid>", "iss": "cloud-platform-gov-identity", "iat": 1792690000, "exp": 1792690900 }
```

It carries no name, email or roles. Verification:
- Only `HS256` is accepted; `none`, `HS512` and the rest are rejected.
- `iss` must match `JWT_ISSUER`.
- `sub`, `iat` and `exp` are required, and `exp` is enforced.
- `sub` must be a UUID.

## Example requests

```bash
# Direct to the service
curl -i http://localhost:4001/health

curl -i -X POST http://localhost:4001/identity/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ana Souza","email":"Ana@Example.org","password":"s3cure-passphrase"}'
# 201 {"user":{"id":"804e…","name":"Ana Souza","email":"ana@example.org",...}}

TOKEN=$(curl -s -X POST http://localhost:4001/identity/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.org","password":"s3cure-passphrase"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

curl -i http://localhost:4001/identity/me -H "Authorization: Bearer $TOKEN"
# 200 {"user":{...}}

curl -i -X POST http://localhost:4001/identity/logout -H "Authorization: Bearer $TOKEN"
# 204 (the token itself remains valid until it expires)

# The same through the API Gateway (gateway on :3000 with IDENTITY_SERVICE_URL set)
curl -i -X POST http://localhost:3000/api/v1/identity/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.org","password":"s3cure-passphrase"}'
curl -i http://localhost:3000/api/v1/identity/me -H "Authorization: Bearer $TOKEN"
```

## Database and migrations

Schema: `src/db/schema.ts` defines one `users` table:
- `id`: uuid primary key, `gen_random_uuid()`.
- `name`.
- `email`: unique constraint `users_email_unique`.
- `password_hash`.
- `created_at` and `updated_at`: `timestamptz`.

Migrations are plain SQL in `drizzle/`, generated by drizzle-kit and committed.

```bash
npm run db:generate -- --name <change>   # after editing src/db/schema.ts
npm run db:migrate                       # apply to DATABASE_URL
```

Migrations are **never** run at application startup. They are applied explicitly:
- locally, with `npm run db:migrate`;
- in Compose, by the one-shot `migrate` service;
- in AWS, as a one-off task.

The migrator only applies pending forward migrations and never resets data.

## Docker

```bash
# Build the image only
docker build -t identity-service:local .

# Full stack: PostgreSQL -> migrate (one-shot) -> identity-service on :4001
echo "JWT_SECRET=$(openssl rand -base64 48)" >> .env     # or export JWT_SECRET
docker compose up --build -d --wait
docker compose ps -a        # migrate: Exited (0); identity-service: (healthy)
docker compose logs -f identity-service
docker compose down         # add -v to also delete the database volume
```

Startup order:
- `postgres` has a `pg_isready` healthcheck.
- `migrate` waits for `postgres` to be *healthy*, not just started.
- `identity-service` waits for `migrate` to *complete successfully*.

The image:
- Multi-stage build on `node:24-slim`, with only production dependencies in the final image. `argon2` uses its bundled prebuilt binary.
- Runs as the non-root `node` user and listens on `0.0.0.0:4001`.
- Has a `HEALTHCHECK` on `/health`.
- Contains the compiled `dist/` and the SQL migrations. `.env*` files are excluded from the build context; configuration comes only from the runtime environment.
- Handles `SIGTERM`/`SIGINT` gracefully: it stops accepting connections, finishes in-flight requests, closes the DB pool, and caps the whole shutdown at 10 s.

## API Gateway integration

The gateway (`../api-gateway`) forwards `/api/v1/identity/*` to `${IDENTITY_SERVICE_URL}/identity/*`:
- It **strips `/api/v1`** and keeps `/identity`, which is why this service mounts its routes at `/identity`.
- It preserves the method, query string, body and headers, including `Authorization`.
- It replaces any client-supplied `X-Forwarded-*` headers and sets `x-request-id`, which this service reuses in its logs.

| Gateway runs… | Identity Service runs… | `IDENTITY_SERVICE_URL` |
|---|---|---|
| on the host (`npm run dev`) | on the host or via this Compose file | `http://localhost:4001` |
| in its own Compose project | via this Compose file (port 4001 published) | `http://host.docker.internal:4001` (the gateway's Compose default) |
| in a shared Compose network (future) | same network | `http://identity-service:4001` |

Container IPs are never hardcoded. The Identity Service doesn't depend on the gateway: it starts and serves requests directly on port 4001.

The gateway does **not** verify tokens yet; it forwards `Authorization` unchanged, and this service verifies tokens itself on `/me` and `/logout`. If the gateway later verifies tokens with the current HS256 scheme, it needs the same `JWT_SECRET` and `JWT_ISSUER`. Moving to RS256/EdDSA with a JWKS endpoint would remove that shared secret (see below).

`trust proxy` is disabled: this service doesn't use the client IP, so it ignores forwarded headers rather than trusting them implicitly.

## JWT expiration and logout semantics

Access tokens are **stateless**. A token is valid until its `exp`, which is `JWT_ACCESS_TOKEN_TTL` after login (15 minutes by default).

`POST /identity/logout` **does not invalidate the token**. It checks that the caller holds a valid token and returns `204`. Logging out means the **client deletes its token**. Anyone who has a copy of the token can still use it until it expires; a test (`tests/me-logout.test.ts`) asserts exactly that.

Revocation is deliberately left out of this version: the short TTL limits exposure without adding a revocation store. A deleted account is rejected right away, because `/me` reloads the user. If immediate invalidation becomes a requirement, see the options below.

## Security notes

- Passwords are hashed with Argon2id and never stored, logged or returned. Neither is the hash.
- Login failures are generic and timing-equalized, to prevent account enumeration.
- Request bodies are limited to 10 kB, JSON only, and validated against strict Zod schemas. Malformed input gets a 400.
- `helmet` sets security headers, `x-powered-by` is disabled, and CORS is closed unless `CORS_ORIGIN` lists exact origins.
- The logs redact `Authorization` and `Cookie` headers. Request bodies are never logged.
- All SQL goes through Drizzle's parameterized queries.
- Configuration fails fast at startup, and `JWT_SECRET` must be at least 32 bytes.

Security assumptions:
- TLS is terminated before this service: at the ALB in AWS, plain HTTP locally.
- The service is reachable only via the gateway or a private network in production.
- Brute-force protection for `/login` relies on the gateway's rate limiter for now.

## Tests

```bash
npm run test:db:up      # disposable PostgreSQL on localhost:5433 (tmpfs, docker-compose.test.yml)
npm test
npm run test:db:down
```

The tests use Vitest and Supertest against a real PostgreSQL. The test database:
- Comes only from `TEST_DATABASE_URL`, never `DATABASE_URL`. If it's unset, the default is the disposable container on `localhost:5433`.
- Must have a name that ends in `_test`, or the suite refuses to run, because tests truncate tables.
- Gets migrations once per run (global setup) and is truncated before each test.

No public internet access is needed.

The suite covers:
- health, request IDs, security headers and CORS
- registration: success, normalization, Argon2id storage, no hash in responses, 400/409/413/415
- login: claims and TTL, and a generic 401 for both a bad password and an unknown email
- `/me`: valid token, and every rejection case (no header, wrong scheme, malformed, wrong key, wrong issuer, expired, `HS512`/`none`, missing `exp`, non-UUID `sub`, deleted user)
- logout as implemented (token still valid afterwards)
- a production-masked 500 when the database is unreachable
- config validation

## Deployment to AWS ECS Fargate (future, not implemented)

Nothing AWS-specific exists in this repository, and no resources are provisioned. The service is a stateless 12-factor container:

- **Image:** pushed to Amazon ECR.
- **Compute:** an ECS service on Fargate in private subnets, with multiple tasks across AZs.
  - Container port 4001.
  - Health check on `/health`.
  - `stopTimeout` ≥ 10 s for graceful shutdown.
- **Database:** Amazon RDS for PostgreSQL in private subnets.
  - Its security group allows only the identity tasks.
  - Use TLS to RDS (`sslmode=require` / `verify-full` with the RDS CA in `DATABASE_URL`).
- **Secrets:**
  - `JWT_SECRET` and `DATABASE_URL` (or the DB password) are stored in **AWS Secrets Manager**.
  - They are injected through the task definition's `secrets` block.
  - The task execution role may read only those ARNs.
  - Non-secret settings (`JWT_ISSUER`, `JWT_ACCESS_TOKEN_TTL`, `CORS_ORIGIN`, `NODE_ENV=production`) go in `environment`.
- **Migrations:** run as a one-off ECS task with the same image and command `node dist/db/migrate.js`, before each deploy, for example as a pipeline step.
- **Networking:** the gateway reaches the service through ECS Service Connect or AWS Cloud Map, e.g. `IDENTITY_SERVICE_URL=http://identity-service.internal:4001`. Only the gateway's ALB is internet-facing.
- **Logs:** stdout JSON goes to CloudWatch Logs via the `awslogs` driver.

## Future improvements

- **Token revocation / logout everywhere:** a `jti` claim plus a denylist (Redis/ElastiCache, or a DB table pruned at `exp`), or a per-user `tokenVersion` checked on each request.
- **Refresh tokens:** long-lived, stored hashed server-side, rotated on use, sent as an `HttpOnly` cookie; access tokens stay short.
- **Asymmetric signing:** RS256/EdDSA with a JWKS endpoint (`/identity/.well-known/jwks.json`), so the gateway and other services can verify tokens without holding the signing key. An `aud` claim per consumer.
- **Brute-force protection:** per-account and per-IP login throttling (the gateway's limiter is per-IP and in-memory).
- **Account lifecycle:** email verification, password reset, password change with re-hash on Argon2 parameter upgrades.
- **Readiness probe:** a `/ready` endpoint that checks the database, separate from liveness.
