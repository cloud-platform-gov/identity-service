import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createDb } from './db/client.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  // The pool connects lazily; migrations are applied separately (`npm run db:migrate`).
  const { db, pool } = createDb(config.DATABASE_URL);
  const app = buildApp({ config, db });

  const server = app.listen(config.PORT, config.HOST, (err) => {
    if (err) {
      console.error('Failed to start identity-service:', err.message);
      process.exit(1);
    }
    console.log(`identity-service listening on http://${config.HOST}:${config.PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    const forceExit = setTimeout(() => {
      console.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    server.close(() => {
      pool.end().then(
        () => process.exit(0),
        (err: unknown) => {
          console.error('error closing database pool:', err);
          process.exit(1);
        },
      );
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
