import {
  createWorkspaceAndPage,
  editor,
  expect,
  register,
  secondBrowser,
  signIn,
  test,
} from './helpers.js';

test.describe('core journeys in a real browser (AC-10.2)', () => {
  test('register, build a page, edit it, reload, sign out and back in', async ({ page }) => {
    const { email } = await register(page);
    const pagePath = await createWorkspaceAndPage(page);

    await page.getByRole('textbox', { name: 'Page title' }).fill('Launch plan');
    await editor(page).click();
    await page.keyboard.type('The first paragraph.');
    // A page is durable once the server has committed it (G2): wait for the sync to settle, then reload.
    await expect(
      page.getByRole('tree', { name: 'Pages' }).getByRole('link', { name: 'Launch plan' }),
    ).toBeVisible();
    await page.waitForTimeout(3500);
    await page.reload();
    await expect(editor(page)).toContainText('The first paragraph.');
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Launch plan');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(pagePath);
    await expect(page).toHaveURL(/\/login/); // AC-2.6: protected routes redirect to login

    await signIn(page, email);
    await page.goto(pagePath);
    await expect(editor(page)).toContainText('The first paragraph.');
  });

  test('two browsers see each other’s edits live, in both directions', async ({
    userPage: page,
    account,
  }) => {
    const { email } = account;
    const pagePath = await createWorkspaceAndPage(page);

    const other = await secondBrowser(page);
    try {
      await signIn(other.page, email);
      await other.page.goto(pagePath);
      await expect(editor(other.page)).toBeVisible();
      await expect(other.page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();

      await editor(page).click();
      await page.keyboard.type('from the first browser');
      await expect(editor(other.page)).toContainText('from the first browser');

      await editor(other.page).click();
      await other.page.keyboard.press('Control+End');
      await other.page.keyboard.type(' and the second');
      await expect(editor(page)).toContainText('from the first browser and the second');
    } finally {
      await other.context.close();
    }
  });

  test('comment on selected text, then resolve the comment', async ({ userPage: page }) => {
    await createWorkspaceAndPage(page);
    await editor(page).click();
    await page.keyboard.type('Review this sentence');
    await page.keyboard.press('Control+A');

    await page.getByRole('button', { name: 'Comments' }).click();
    const panel = page.getByRole('region', { name: 'Comments' });
    await panel
      .getByRole('textbox', { name: 'Comment on the selected text' })
      .fill('Please tighten this.');
    await panel.getByRole('button', { name: 'Comment' }).click();
    await expect(panel.getByText('Please tighten this.')).toBeVisible();

    await panel
      .getByRole('button', { name: /resolve/i })
      .first()
      .click();
    await expect(panel.getByText('No open comments.')).toBeVisible();
    await panel.getByRole('tab', { name: 'Resolved' }).click();
    await expect(panel.getByText('Please tighten this.')).toBeVisible();
  });

  test('save a version, change the page, restore the version', async ({ userPage: page }) => {
    await createWorkspaceAndPage(page);
    await editor(page).click();
    await page.keyboard.type('Original text');
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Version history' }).click();
    await page
      .getByRole('textbox', { name: 'Save the page as it is now' })
      .fill('Before the change');
    await page.getByRole('button', { name: 'Save version' }).click();
    const saved = page.getByRole('button', { name: /Before the change/ });
    await expect(saved).toBeVisible();

    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' CHANGED');
    await expect(editor(page)).toContainText('Original text CHANGED');

    await saved.click();
    await expect(page.getByRole('textbox', { name: 'Version content' })).toContainText(
      'Original text',
    );
    await page.getByRole('button', { name: 'Restore this version' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Confirm restore' });
    await expect(confirm).toContainText('The page as it is now is saved first');
    await confirm.getByRole('button', { name: 'Restore' }).click();
    await expect(editor(page)).toContainText('Original text');
    await expect(editor(page)).not.toContainText('CHANGED');
    // G7: the state before the restore was kept as its own version, so nothing was lost.
    await expect(
      page.getByRole('region', { name: 'Version history' }).getByRole('listitem'),
    ).toHaveCount(2);
  });

  test('pages ship the security headers and the browser blocks nothing during an editing session', async ({
    userPage: page,
  }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/content security policy/i.test(message.text())) violations.push(message.text());
    });
    page.on('pageerror', (error) => violations.push(error.message));

    const response = await page.goto('/login');
    const headers = response!.headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');

    await createWorkspaceAndPage(page);
    // The session cookie is HttpOnly: scripts on the page cannot read it (NFR-SEC-01).
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/conote_session/);
    await editor(page).click();
    await page.keyboard.type('Checking the policy ');
    await page.keyboard.type('/');
    await expect(page.getByRole('listbox', { name: 'Insert' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Comments' }).click();
    await page.getByRole('button', { name: 'Version history' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('upload an image and see it in the page, under the content security policy', async ({
    userPage: page,
  }) => {
    const blocked: string[] = [];
    page.on('console', (message) => {
      if (/content security policy|refused to load/i.test(message.text()))
        blocked.push(message.text());
    });
    await createWorkspaceAndPage(page);
    await editor(page).click();
    // A 1x1 transparent PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
    const image = editor(page).locator('img');
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', /\/api\/v1\/assets\//);
    await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
    expect(blocked).toEqual([]);
  });

  test('the collaboration WebSocket URL carries no token or session (V5)', async ({
    userPage: page,
  }) => {
    const urls: string[] = [];
    page.on('websocket', (socket) => urls.push(socket.url()));
    await createWorkspaceAndPage(page);
    await editor(page).click();
    await page.keyboard.type('socket check');
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const parsed = new URL(url);
      expect(parsed.search, url).toBe('');
      expect(url).not.toMatch(/eyJ|token|session|key=/i);
    }
  });
});
