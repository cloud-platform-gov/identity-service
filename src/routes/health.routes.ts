import { Router } from 'express';

/** Liveness of the process only; deliberately does not query the database. */
export function healthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'identity-service', uptimeSeconds: Math.round(process.uptime()) });
  });
  return router;
}
