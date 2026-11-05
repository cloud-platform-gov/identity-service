import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { HttpError } from '../errors.js';
import { requireInternalToken } from '../middlewares/internal-auth.js';
import { findUserById } from '../modules/identity/users.js';

/**
 * Service-to-service routes. The API Gateway only proxies `/api/v1/identity/*`,
 * so nothing under `/internal` is reachable from outside the private network.
 */
export const INTERNAL_PREFIX = '/internal';

const userParams = z.object({ id: z.uuid() });

export function internalRouter(token: string, db: Database): Router {
  const router = Router();
  router.use(requireInternalToken(token));

  // Contact details for notifications: only what a sender needs, no timestamps.
  router.get('/users/:id', async (req, res) => {
    const { id } = userParams.parse(req.params);
    const user = await findUserById(db, id);
    if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  });

  return router;
}
