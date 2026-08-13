import { expect, test } from '@playwright/test';

const PUBLIC_PAGES = [
  { path: '/terms', expectedText: '利用規約' },
  { path: '/privacy', expectedText: 'プライバシー' },
  { path: '/contact', expectedText: 'お問い合わせ' },
];

test.describe('public browser shell', () => {
  test('root renders an interactive surface without a browser crash', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');

    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('button, input, a').first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  for (const pageCase of PUBLIC_PAGES) {
    test(`${pageCase.path} renders in the real browser`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.goto(pageCase.path);

      await expect(page.locator('body')).toContainText(pageCase.expectedText);
      expect(pageErrors).toEqual([]);
    });
  }

  test('legal navigation survives a full reload', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('body')).toContainText('プライバシー');

    await page.reload();
    await expect(page.locator('body')).toContainText('プライバシー');
  });
});
