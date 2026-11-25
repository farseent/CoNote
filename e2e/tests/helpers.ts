import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

export const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
export const PASSWORD = 'correct horse battery staple';

export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.example`;
}

/** Register through the real form; lands on the dashboard. */
export async function register(page: Page, name = 'E2E User'): Promise<{ email: string }> {
  const email = uniqueEmail('user');
  await page.goto('/register');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
  return { email };
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/');
}

/** Create a workspace and its first page through the UI; returns the page URL path. */
export async function createWorkspaceAndPage(
  page: Page,
  workspaceName = 'E2E Team',
): Promise<string> {
  await page.goto('/workspaces/new');
  await page.getByLabel('Workspace name').fill(workspaceName);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'Create the first page' }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  return new URL(page.url()).pathname;
}

export const editor = (page: Page) => page.getByRole('textbox', { name: 'Page content' });

/** A second, independent browser session (own cookies) for the same app. */
export async function secondBrowser(page: Page): Promise<{ context: BrowserContext; page: Page }> {
  const context = await page
    .context()
    .browser()!
    .newContext({ baseURL: String(page.url()).split('/').slice(0, 3).join('/') });
  return { context, page: await context.newPage() };
}

interface Account {
  email: string;
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>;
}

/**
 * Registering is rate limited per address (10 an hour), so a file registers one account and every
 * test gets its own browser context signed in as that account. `account` is per worker.
 */
export const test = base.extend<{ userPage: Page }, { account: Account }>({
  account: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();
      const { email } = await register(page, 'E2E User');
      const storageState = await context.storageState();
      await context.close();
      await use({ email, storageState });
    },
    { scope: 'worker' },
  ],
  userPage: async ({ browser, baseURL, account }, use) => {
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: account.storageState,
    });
    await use(await context.newPage());
    await context.close();
  },
});

export { expect };
