import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDatabase, createPrismaClient } from '../src/index.js';
import { UNREACHABLE_DATABASE_URL, requireInfraEnv } from '../../../tests/helpers.js';

const { DATABASE_URL } = requireInfraEnv();

describe('checkDatabase (real PostgreSQL)', () => {
  it('is healthy on a migrated database', async () => {
    const prisma = createPrismaClient(DATABASE_URL);
    try {
      expect(await checkDatabase(prisma)).toBe('healthy');
    } finally {
      await prisma.$disconnect();
    }
  });

  it('is unavailable when PostgreSQL cannot be reached', async () => {
    const prisma = createPrismaClient(UNREACHABLE_DATABASE_URL);
    try {
      expect(await checkDatabase(prisma, { timeoutMs: 1500 })).toBe('unavailable');
    } finally {
      await prisma.$disconnect().catch(() => {});
    }
  });

  describe('schema compatibility', () => {
    const dbName = `conote_it_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: DATABASE_URL });
    const scratchUrl = (() => {
      const u = new URL(DATABASE_URL);
      u.pathname = `/${dbName}`;
      return u.toString();
    })();

    beforeAll(async () => {
      await admin.connect();
      await admin.query(`CREATE DATABASE ${dbName}`);
    });

    afterAll(async () => {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    });

    it('is unavailable when the migration history table does not exist', async () => {
      const prisma = createPrismaClient(scratchUrl);
      try {
        expect(await checkDatabase(prisma)).toBe('unavailable');
      } finally {
        await prisma.$disconnect();
      }
    });

    it('is unavailable when a migration failed (started, not finished)', async () => {
      const scratch = new pg.Client({ connectionString: scratchUrl });
      await scratch.connect();
      await scratch.query(`CREATE TABLE "_prisma_migrations" (
        id VARCHAR(36) PRIMARY KEY NOT NULL, checksum VARCHAR(64) NOT NULL,
        finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT,
        rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
      await scratch.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ('1', 'x', 'broken')`,
      );
      await scratch.end();

      const prisma = createPrismaClient(scratchUrl);
      try {
        expect(await checkDatabase(prisma)).toBe('unavailable');
      } finally {
        await prisma.$disconnect();
      }
    });
  });
});
