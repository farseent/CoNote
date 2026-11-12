import type { DependencyStatus } from '@conote/shared';
import type { PrismaClient } from './client.js';

export interface DatabaseCheckOptions {
  /** Upper bound for the whole check, in milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;

interface MigrationRow {
  failed: bigint | number;
}

async function runChecks(prisma: PrismaClient): Promise<DependencyStatus> {
  await prisma.$queryRaw`SELECT 1`;

  // Schema compatibility: the migration history table must exist and contain
  // no failed (started but unfinished, not rolled back) migrations.
  const rows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS failed
    FROM "_prisma_migrations"`;
  const failed = Number(rows[0]?.failed ?? 0);
  return failed === 0 ? 'healthy' : 'unavailable';
}

/**
 * PostgreSQL readiness check: reachable AND schema-compatible.
 * Returns `unavailable` on any error or timeout; never throws, never leaks details.
 *
 * Limitation (Phase 1): compatibility means "migration history exists and has no
 * failed migrations". It does not yet compare applied migrations against the
 * migrations the running build expects. Revisit when real models exist (Phase 2).
 */
export async function checkDatabase(
  prisma: PrismaClient,
  options: DatabaseCheckOptions = {},
): Promise<DependencyStatus> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<DependencyStatus>((resolve) => {
    timer = setTimeout(() => resolve('unavailable'), timeoutMs);
  });
  try {
    return await Promise.race([runChecks(prisma), timeout]);
  } catch {
    return 'unavailable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}
