import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function run(
  entry: string,
  env: Record<string, string>,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      env: { PATH: process.env['PATH'] ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', (code) => resolve({ code, out }));
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
