import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: 'compact-phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} browser shell`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('interactive root surface remains operable without horizontal page overflow', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('body')).toBeVisible();

      const metrics = await page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);

      const firstInput = page.locator('input').first();
      const firstButton = page.getByRole('button').first();
      await expect(firstInput).toBeVisible();
      await expect(firstButton).toBeVisible();

      const inputBox = await firstInput.boundingBox();
      const buttonBox = await firstButton.boundingBox();
      expect(inputBox).not.toBeNull();
      expect(buttonBox).not.toBeNull();
      expect(inputBox.x).toBeGreaterThanOrEqual(0);
      expect(buttonBox.x).toBeGreaterThanOrEqual(0);
      expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(viewport.width + 1);
    });

    test('public legal pages remain readable without horizontal page overflow', async ({ page }) => {
      await page.goto('/privacy');
      await expect(page.locator('body')).toContainText('プライバシー');

      const metrics = await page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    });
  });
}
