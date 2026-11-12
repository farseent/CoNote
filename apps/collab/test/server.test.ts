import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import type { DependencyStatus } from '@conote/shared';
import type { Dependencies } from '../src/dependencies.js';
import { buildCollabServer } from '../src/server.js';

function fakeDeps(postgres: DependencyStatus, redis: DependencyStatus): Dependencies {
  return {
    checkPostgres: async () => postgres,
    checkRedis: async () => redis,
    close: async () => {},
  };
}

let server: ReturnType<typeof buildCollabServer> | undefined;

async function start(postgres: DependencyStatus, redis: DependencyStatus) {
  server = buildCollabServer({
    port: 0,
    address: '127.0.0.1',
    logger: pino({ level: 'silent' }),
    dependencies: fakeDeps(postgres, redis),
  });
  await server.listen(0);
  return `http://127.0.0.1:${server.address.port}`;
}

afterEach(async () => {
  await server?.destroy();
  server = undefined;
});

describe('collab HTTP endpoints', () => {
  it('GET /health is 200 regardless of dependencies', async () => {
    const base = await start('unavailable', 'unavailable');
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'collab' });
  });

  it('GET /ready is ready when both dependencies are healthy', async () => {
    const base = await start('healthy', 'healthy');
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('ready');
  });

  it('GET /ready is degraded (200) when redis is down', async () => {
    const base = await start('healthy', 'unavailable');
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('degraded');
  });

  it('GET /ready is 503 when postgres is down', async () => {
    const base = await start('unavailable', 'healthy');
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { status: string }).status).toBe('not_ready');
  });

  it('returns 404 JSON for unknown paths', async () => {
    const base = await start('healthy', 'healthy');
    const res = await fetch(`${base}/anything`);
    expect(res.status).toBe(404);
  });
});

describe('collab WebSocket foundation', () => {
  it('accepts the WebSocket handshake (the WS server is running)', async () => {
    const base = await start('healthy', 'healthy');
    const url = base.replace('http', 'ws');
    const opened = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => {
        ws.close();
        resolve(true);
      });
      ws.addEventListener('error', () => resolve(false));
    });
    expect(opened).toBe(true);
  });

  it('rejects every document connection (no collaboration in Phase 1)', async () => {
    await start('healthy', 'healthy');
    const onConnect = server?.configuration.onConnect;
    expect(onConnect).toBeTypeOf('function');
    await expect(
      // Only socketId is read by the hook; the rest of the payload is irrelevant here.
      onConnect?.({ socketId: 'test-socket' } as never),
    ).rejects.toThrow(/not available/i);
  });
});
