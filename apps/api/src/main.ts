import { apiEnvSchema, parseEnv } from '@conote/shared';
import { buildApp } from './app.js';
import { createDependencies } from './dependencies.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  // Fail fast on invalid configuration. Messages list variable names, never values.
  const env = parseEnv('api', apiEnvSchema, process.env);

  const logger = createLogger({ service: 'api', level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV });
  const app = buildApp({ logger, dependencies: createDependencies(env, logger) });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err: unknown) => {
  // Logger may not exist yet (env invalid); write a single safe line.
  process.stderr.write(`${err instanceof Error ? err.message : 'startup failed'}\n`);
  process.exit(1);
});
