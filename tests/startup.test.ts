import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function run(
  entry: string,
  env: Record<string, string>,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Startup process timed out: ${entry}\n${out}`));
    }, 20_000);

    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
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
  ])(
    '%s exits 1 and names invalid variables without printing secrets',
    async (_n, entry) => {
      const { code, out } = await run(entry, {
        NODE_ENV: 'test',
        DATABASE_URL: 'mysql://user:hunter2-secret@host/db',
        REDIS_URL: 'redis://127.0.0.1:6379',
        APP_URL: 'http://localhost:3000',
      });

      expect(code).toBe(1);
      expect(out).toContain('DATABASE_URL');
      expect(out).not.toContain('hunter2-secret');
    },
    25_000,
  );
});
