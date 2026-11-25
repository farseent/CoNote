import type { PrismaClient } from '@conote/db';
import type { Clock } from '../config.js';

export const ACTIVITY_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Rows removed per statement, so one run never holds a long lock on a large table. */
export const ACTIVITY_PRUNE_BATCH = 5000;
/** Upper bound of batches per run; a backlog is finished by the next runs. */
const MAX_BATCHES_PER_RUN = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Delete activity-log rows older than `retentionDays` (U11, D69), in batches of the oldest rows.
 * The table has no index on `createdAt` alone, so each batch scans it; at the expected size and a
 * six-hourly run that is cheap, and an index would need a migration (not added). Running it twice,
 * or from several API instances at once, is harmless (`SKIP LOCKED`; a deleted row is simply not
 * found). Returns the number of rows deleted.
 */
export async function pruneActivityLogs(
  prisma: PrismaClient,
  now: Date,
  retentionDays: number,
  batchSize: number = ACTIVITY_PRUNE_BATCH,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM activity_logs
      WHERE id IN (
        SELECT id FROM activity_logs WHERE "createdAt" < ${cutoff}
        ORDER BY "createdAt" LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )`;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}

interface JobLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/** Run the prune now and then on an interval. Returns a function that stops the job. */
export function startActivityPrune(options: {
  prisma: PrismaClient;
  clock: Clock;
  logger: JobLogger;
  retentionDays: number;
  intervalMs?: number;
}): () => void {
  const run = async (): Promise<void> => {
    try {
      const deleted = await pruneActivityLogs(
        options.prisma,
        options.clock(),
        options.retentionDays,
      );
      options.logger.info({ deleted }, 'activity log prune finished');
    } catch (err) {
      options.logger.warn(
        { err: { message: (err as Error).message } },
        'activity log prune failed',
      );
    }
  };
  void run();
  const timer = setInterval(() => void run(), options.intervalMs ?? ACTIVITY_PRUNE_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
