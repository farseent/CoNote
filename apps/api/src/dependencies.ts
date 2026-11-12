import type { Logger } from 'pino';
import type { DependencyStatus } from '@conote/shared';
import { checkDatabase, createPrismaClient } from '@conote/db';
import { checkRedis, createRedisClient } from './redis.js';

/** Runtime dependencies of the API. Tests can substitute their own. */
export interface Dependencies {
  checkPostgres(): Promise<DependencyStatus>;
  checkRedis(): Promise<DependencyStatus>;
  close(): Promise<void>;
}

export function createDependencies(
  env: { DATABASE_URL: string; REDIS_URL: string },
  logger: Logger,
): Dependencies {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const redis = createRedisClient(env.REDIS_URL);
  // Without an error listener ioredis would throw on connection errors.
  redis.on('error', (err: Error) => {
    logger.warn({ err: { name: err.name, message: err.message } }, 'redis connection error');
  });

  return {
    checkPostgres: () => checkDatabase(prisma),
    checkRedis: () => checkRedis(redis),
    close: async () => {
      await Promise.allSettled([
        prisma.$disconnect(),
        redis.quit().catch(() => redis.disconnect()),
      ]);
    },
  };
}
