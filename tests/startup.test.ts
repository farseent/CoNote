import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

// Spawning tsx is slow under parallel load; give the child its own,
// longer deadline and keep the vitest timeout just above it.
const CHILD_TIMEOUT_MS = 30_000;
vi.setConfig({ testTimeout: CHILD_TIMEOUT_MS + 5_000 });

function run(
  entry: string,
  env: Record<string, string>,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      env: { PATH: process.env['PATH'] ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(`${entry} did not exit within ${CHILD_TIMEOUT_MS}ms.\nOutput so far:\n${out}`),
      );
    }, CHILD_TIMEOUT_MS);

    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

describe('fail-fast environment validation at process startup', () => {
  it.each([
    ['api', 'apps/api/src/main.ts'],
    ['collab', 'apps/collab/src/main.ts'],
  ])('%s exits 1 and names invalid variables without printing secrets', async (_n, entry) => {
    const { code, out } = await run(entry, {
      NODE_ENV: 'test',
      DATABASE_URL: 'mysql://user:hunter2-secret@host/db',
      REDIS_URL: 'redis://127.0.0.1:6379',
      APP_URL: 'http://localhost:3000',
    });
    expect(code).toBe(1);
    expect(out).toContain('DATABASE_URL');
    expect(out).not.toContain('hunter2-secret');
  });
});

describe('collaboration key configuration', () => {
  const base = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db',
    REDIS_URL: 'redis://127.0.0.1:6379',
    APP_URL: 'http://localhost:3000',
  };

  it('collab refuses to start without public keys', async () => {
    const { code, out } = await run('apps/collab/src/main.ts', base);
    expect(code).toBe(1);
    expect(out).toContain('COLLAB_JWT_PUBLIC_KEYS');
  });

  it.each([
    ['not JSON', 'definitely not json'],
    [
      'a private key where public keys are expected',
      JSON.stringify([
        { kty: 'OKP', crv: 'Ed25519', x: 'abc', d: 'PRIVATE-SECRET-VALUE', kid: 'k' },
      ]),
    ],
    ['an empty list', '[]'],
  ])('collab rejects %s without printing it', async (_name, value) => {
    const { code, out } = await run('apps/collab/src/main.ts', {
      ...base,
      COLLAB_JWT_PUBLIC_KEYS: value,
    });
    expect(code).toBe(1);
    expect(out).toContain('COLLAB_JWT_PUBLIC_KEYS');
    expect(out).not.toContain('PRIVATE-SECRET-VALUE');
  });

  it('api rejects a malformed private key without printing it', async () => {
    const { code, out } = await run('apps/api/src/main.ts', {
      ...base,
      COLLAB_JWT_PRIVATE_KEY: JSON.stringify({ kty: 'RSA', d: 'PRIVATE-SECRET-VALUE' }),
    });
    expect(code).toBe(1);
    expect(out).toContain('COLLAB_JWT_PRIVATE_KEY');
    expect(out).not.toContain('PRIVATE-SECRET-VALUE');
  });
});
