import { defineConfig } from '@playwright/test';

/**
 * The tests drive a running stack (web on E2E_BASE_URL, which proxies /api to the API; the API,
 * the collaboration server, PostgreSQL and Redis). They do not start it: the stack must be built
 * and started the way production runs it (`NODE_ENV=production`, because the session cookie name
 * differs between development and production).
 *
 * E2E_CHROMIUM_PATH points at a Chromium binary for environments where `playwright install` cannot
 * download one. Leave it unset to use the browser Playwright installs.
 */
const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
const executablePath = process.env['E2E_CHROMIUM_PATH'];

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(executablePath
      ? {
          launchOptions: {
            executablePath,
            args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
          },
        }
      : {}),
  },
});
