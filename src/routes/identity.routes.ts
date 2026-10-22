import { Router, type RequestHandler } from 'express';
import type { Config } from '../config/env.js';
import type { Database } from '../db/client.js';
import { HttpError } from '../errors.js';
import { authenticate, unauthorized } from '../middlewares/authenticate.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../modules/identity/password.js';
import { loginSchema, registerSchema } from '../modules/identity/schemas.js';
import { signAccessToken } from '../modules/identity/tokens.js';
import { createUser, findUserByEmail, findUserById, toPublicUser } from '../modules/identity/users.js';

/**
 * Mounted at `/identity`: the API Gateway strips `/api/v1`, so the public
 * `/api/v1/identity/login` arrives here as `/identity/login`.
 */
export const IDENTITY_PREFIX = '/identity';

const requireJson: RequestHandler = (req, _res, next) => {
  if (!req.is('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  next();
};

export function identityRouter(config: Config, db: Database): Router {
  const router = Router();
  const requireAuth = authenticate(config);

  router.post('/register', requireJson, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const user = await createUser(db, { name: input.name, email: input.email, passwordHash });
    if (!user) {
      throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists');
    }
    res.status(201).json({ user: toPublicUser(user) });
  });

  router.post('/login', requireJson, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await findUserByEmail(db, input.email);
    const valid = user
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyAgainstDummy(input.password);
    if (!user || !valid) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    res.json({
      accessToken: await signAccessToken(config, user.id),
      tokenType: 'Bearer',
      expiresIn: config.JWT_ACCESS_TOKEN_TTL,
    });
  });

  router.get('/me', requireAuth, async (_req, res) => {
    // A token can outlive its account; re-check that the user still exists.
    const user = await findUserById(db, res.locals.userId!);
    if (!user) throw unauthorized();
    res.json({ user: toPublicUser(user) });
  });

  // Stateless JWTs: nothing is revoked server-side. The client must discard the
  // token, which stays valid until it expires (see README, "Logout semantics").
  router.post('/logout', requireAuth, (_req, res) => {
    res.status(204).end();
  });

  return router;
}
