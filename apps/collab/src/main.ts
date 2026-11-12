import { collabEnvSchema, parseEnv } from '@conote/shared';
import { createDependencies } from './dependencies.js';
import { createLogger } from './logger.js';
import { buildCollabServer } from './server.js';

async function main(): Promise<void> {
  // Fail fast on invalid configuration. Messages list variable names, never values.
  const env = parseEnv('collab', collabEnvSchema, process.env);

  const logger = createLogger({ service: 'collab', level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV });
  const dependencies = createDependencies(env, logger);
  const server = buildCollabServer({ port: env.COLLAB_PORT, logger, dependencies });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      await server.destroy();
      await dependencies.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await server.listen();
  logger.info({ port: env.COLLAB_PORT }, 'collab server listening');
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : 'startup failed'}\n`);
  process.exit(1);
});
