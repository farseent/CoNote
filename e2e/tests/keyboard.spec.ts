import type { Locator, Page } from '@playwright/test';
import { createWorkspaceAndPage, editor, expect, PASSWORD, test } from './helpers.js';

/**
 * AC-10.7: the core flows can be operated with the keyboard alone. Controls are reached with Tab
 * or Shift+Tab (never `focus()` or a click) and operated with Enter, Space or arrow keys.
 */
async function tabTo(
  page: Page,
  target: Locator,
  options: { backwards?: boolean; max?: number } = {},
) {
  const max = options.max ?? 40;
  const key = options.backwards ? 'Shift+Tab' : 'Tab';
  for (let presses = 1; presses <= max; presses += 1) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false))
      return presses;
  }
  throw new Error(`not reachable with ${max} presses of ${key}: ${String(target)}`);
}

/** Arrow keys move inside a composite widget (the toolbar keeps one tab stop, WAI-ARIA toolbar). */
async function arrowTo(page: Page, target: Locator, key = 'ArrowRight', max = 20) {
  for (let presses = 1; presses <= max; presses += 1) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false))
      return presses;
  }
  throw new Error(`not reachable with ${max} presses of ${key}: ${String(target)}`);
}

test.describe('keyboard operability of the core flows (AC-10.7)', () => {
  test('sign in with the keyboard alone', async ({ browser, account }) => {
    const context = await browser.newContext({
      baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    });
    const page = await context.newPage();
    try {
      await page.goto('/login');
      await tabTo(page, page.getByLabel('Email'));
      await page.keyboard.type(account.email);
      await tabTo(page, page.getByLabel('Password'));
      await page.keyboard.type(PASSWORD);
      await tabTo(page, page.getByRole('button', { name: 'Sign in' }));
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL((url) => url.pathname === '/');
      await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('page tree: create a page and open it from the tree', async ({ userPage: page }) => {
    await createWorkspaceAndPage(page);
    const firstUrl = page.url();
    await tabTo(page, page.getByRole('button', { name: 'New page' }), { backwards: true, max: 60 });
    await page.keyboard.press('Enter');
    await page.waitForURL(
      (url) => url.href !== firstUrl && /\/pages\/[0-9a-f-]{36}$/.test(url.pathname),
    );
    const links = page.getByRole('tree', { name: 'Pages' }).getByRole('link');
    await expect(links).toHaveCount(2);
    await tabTo(page, links.first(), { backwards: true, max: 60 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(firstUrl);
  });

  test('toolbar: one tab stop, arrow keys move, Space toggles Bold on the selection', async ({
    userPage: page,
  }) => {
    await createWorkspaceAndPage(page);
    await editor(page).click();
    await page.keyboard.type('keyboard bold');
    await page.keyboard.press('Control+A');
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
    const bold = toolbar.getByRole('button', { name: 'Bold' });
    // The toolbar is one tab stop (Undo, once there is something to undo); arrows move inside it.
    await tabTo(page, toolbar.getByRole('button', { name: 'Undo' }), { backwards: true });
    await arrowTo(page, bold);
    await page.keyboard.press('Space');
    await expect(editor(page).locator('strong')).toHaveText('keyboard bold');
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
  });

  test('slash menu: open, move with arrow keys, choose with Enter, close with Escape', async ({
    userPage: page,
  }) => {
    await createWorkspaceAndPage(page);
    await editor(page).click();
    await page.keyboard.type('/');
    const menu = page.getByRole('listbox', { name: 'Insert' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('option', { name: /^Heading 1/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Enter');
    await expect(editor(page).getByRole('heading', { level: 1 })).toBeVisible();
    await expect(menu).toBeHidden();

    await page.keyboard.type('after');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('comments panel: open, write and post a comment without the mouse', async ({
    userPage: page,
  }) => {
    await createWorkspaceAndPage(page);
    await editor(page).click();
    await page.keyboard.type('Comment on me');
    await page.keyboard.press('Control+A');
    await tabTo(page, page.getByRole('button', { name: 'Comments' }), { backwards: true });
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Comments' });
    await expect(panel).toBeVisible();
    await tabTo(page, panel.getByRole('textbox', { name: 'Comment on the selected text' }));
    await page.keyboard.type('Posted by keyboard');
    await tabTo(page, panel.getByRole('button', { name: 'Comment' }));
    await page.keyboard.press('Enter');
    await expect(panel.getByText('Posted by keyboard')).toBeVisible();
    await tabTo(page, panel.getByRole('tab', { name: 'Resolved' }), { backwards: true });
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('tab', { name: 'Resolved' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('version history: save, open and restore a version, and manage focus in the dialog', async ({
    userPage: page,
  }) => {
    await createWorkspaceAndPage(page);
    await editor(page).click();
    await page.keyboard.type('Keep this');
    await page.waitForTimeout(800);
    await tabTo(page, page.getByRole('button', { name: 'Version history' }), { backwards: true });
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Version history' });
    await tabTo(page, panel.getByRole('textbox', { name: 'Save the page as it is now' }));
    await page.keyboard.type('Keyboard version');
    await tabTo(page, panel.getByRole('button', { name: 'Save version' }));
    await page.keyboard.press('Enter');
    const item = panel.getByRole('button', { name: /Keyboard version/ });
    await expect(item).toBeVisible();
    await tabTo(page, item);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Version content' })).toContainText('Keep this');
    await tabTo(page, page.getByRole('button', { name: 'Restore this version' }), {
      backwards: true,
    });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: 'Confirm restore' });
    await expect(dialog).toBeVisible();
    // Focus must be inside the dialog and Escape must dismiss it.
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
