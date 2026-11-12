import { defineConfig } from 'vitest/config';

// Two projects (docs/TESTING.md):
//  - unit:        *.test.ts       — no external services required
//  - integration: *.int.test.ts   — real PostgreSQL and Redis (DATABASE_URL, REDIS_URL)
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['{apps,packages}/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['{apps,packages}/**/*.int.test.ts', 'tests/**/*.int.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
          // Integration tests share real services; run files serially.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
