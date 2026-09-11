import { expect, test } from '@playwright/test';

test('System environment control reloads the requested scope', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin-overview.html?view=system&theme=light&state=populated');

  const environment = page.getByLabel('環境');
  await expect(environment).toHaveValue('production');
  await expect(page.getByText(/本番環境 ·/)).toBeVisible();

  await environment.selectOption('preview');
  await expect(environment).toHaveValue('preview');
  await expect(page.getByText(/プレビュー ·/)).toBeVisible();
});
