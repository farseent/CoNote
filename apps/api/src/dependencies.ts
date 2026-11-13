import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import type { DependencyStatus } from '@conote/shared';
import { checkDatabase, createPrismaClient, type PrismaClient } from '@conote/db';
import type { Clock } from './config.js';
import { checkRedis, connectInBackground, createRedisClient } from './redis.js';

/** Runtime dependencies of the API. Tests can substitute their own. */
export interface Dependencies {
  prisma: PrismaClient;
  redis: Redis;
  /** Source of "now" for every session decision; replaceable in tests. */
  clock: Clock;
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
  // Rate limiting needs a ready connection; do not wait for the first health check.
  connectInBackground(redis);

  return {
    prisma,
    redis,
    clock: () => new Date(),
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
