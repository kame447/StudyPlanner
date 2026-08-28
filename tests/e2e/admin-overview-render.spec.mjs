import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const artifactsDir = path.resolve('artifacts/admin-overview');
fs.mkdirSync(artifactsDir, { recursive: true });

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

async function inspectOverview(page, { theme, width, height, label }) {
  await page.setViewportSize({ width, height });
  await page.goto(`/admin-overview.html?theme=${theme}`);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('登録ユーザー数')).toBeVisible();
  await expect(page.getByText('過去7日間の利用ユーザー')).toBeVisible();
  await expect(page.getByText('通常の応答時間')).toBeVisible();
  await expect(page.getByText('遅いケースの応答時間')).toBeVisible();
  await expect(page.getByText('Planningの状態')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '管理者画面ナビゲーション' })).toBeVisible();
  const aiApiNav = page.getByRole('button', { name: /AI・API/ });
  await expect(aiApiNav).toBeVisible();
  await expect(aiApiNav).toBeDisabled();
  await assertNoHorizontalOverflow(page);

  const sidebar = page.locator('.admin-console-sidebar');
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(sidebarBox.width).toBeGreaterThan(0);

  await page.screenshot({
    path: path.join(artifactsDir, `${label}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

test.describe('Admin Overview rendered UI', () => {
  test('desktop light remains readable and contained', async ({ page }) => {
    await inspectOverview(page, {
      theme: 'light',
      width: 1440,
      height: 1000,
      label: 'desktop-light',
    });
  });

  test('desktop dark remains readable and contained', async ({ page }) => {
    await inspectOverview(page, {
      theme: 'dark',
      width: 1440,
      height: 1000,
      label: 'desktop-dark',
    });
  });

  test('mobile light remains readable and contained', async ({ page }) => {
    await inspectOverview(page, {
      theme: 'light',
      width: 390,
      height: 844,
      label: 'mobile-light',
    });
  });

  test('mobile dark remains readable and contained', async ({ page }) => {
    await inspectOverview(page, {
      theme: 'dark',
      width: 390,
      height: 844,
      label: 'mobile-dark',
    });
  });
});
