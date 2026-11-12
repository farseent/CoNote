import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { createDependencies } from '../src/dependencies.js';
import { buildCollabServer } from '../src/server.js';
import {
  UNREACHABLE_DATABASE_URL,
  UNREACHABLE_REDIS_URL,
  requireInfraEnv,
} from '../../../tests/helpers.js';

const infra = requireInfraEnv();
const logger = pino({ level: 'silent' });
let server: ReturnType<typeof buildCollabServer> | undefined;
let close: (() => Promise<void>) | undefined;

async function start(env: { DATABASE_URL: string; REDIS_URL: string }) {
  const dependencies = createDependencies(env, logger);
  close = dependencies.close;
  server = buildCollabServer({ port: 0, address: '127.0.0.1', logger, dependencies });
  await server.listen(0);
  return `http://127.0.0.1:${server.address.port}`;
}

afterEach(async () => {
  await server?.destroy();
  await close?.();
  server = undefined;
  close = undefined;
});

describe('collab readiness against real services', () => {
  it('is ready with real PostgreSQL and Redis', async () => {
    const res = await fetch(`${await start(infra)}/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ready',
      service: 'collab',
      dependencies: { postgres: 'healthy', redis: 'healthy' },
    });
  });

  it('is degraded (200) when Redis is unreachable', async () => {
    const res = await fetch(`${await start({ ...infra, REDIS_URL: UNREACHABLE_REDIS_URL })}/ready`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('degraded');
  });

  it('is not ready (503) when PostgreSQL is unreachable', async () => {
    const res = await fetch(
      `${await start({ ...infra, DATABASE_URL: UNREACHABLE_DATABASE_URL })}/ready`,
    );
    expect(res.status).toBe(503);
  });
});
