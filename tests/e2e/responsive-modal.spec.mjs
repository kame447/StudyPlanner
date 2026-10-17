import { expect, test } from '@playwright/test';

const HARNESS_BASE = 'http://127.0.0.1:4174';
const VIEWPORTS = [
  { name: 'compact-phone', width: 390, height: 844 },
  { name: 'small-phone', width: 320, height: 640 },
];

async function expectDocumentFitsViewport(page) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function expectHorizontallyReachable(locator, viewportWidth) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} quick entry modal`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('manual modal keeps primary controls horizontally reachable without page-level overflow', async ({ page }) => {
      await page.goto(HARNESS_BASE);
      const close = page.getByRole('button', { name: '閉じる' });
      const save = page.getByRole('button', { name: '保存' });
      await expect(close).toBeVisible();
      await expect(save).toBeVisible();

      await expectDocumentFitsViewport(page);
      await expectHorizontallyReachable(close, viewport.width);
      await expectHorizontallyReachable(save, viewport.width);
    });

    test('weekly preview stays within the document viewport while its actions remain reachable', async ({ page }) => {
      await page.goto(`${HARNESS_BASE}/real-weekly.html?preview=1`);
      const input = page.locator('.ai-planning-composer textarea');
      await expect(input).toBeVisible();
      await input.fill('小さい画面でプレビューを検査する条件');
      await page.getByRole('button', { name: '送信', exact: true }).click();
      await page.getByRole('button', { name: '計画プレビューを確認' }).click();
      const preview = page.getByRole('dialog', { name: '計画プレビュー' });
      await expect(preview).toBeVisible();

      const promote = preview.getByRole('button', { name: 'この内容で仮予定にする' });
      const closePreview = preview.getByRole('button', { name: '閉じる', exact: true });
      await expect(promote).toBeVisible();
      await expect(closePreview).toBeVisible();
      await expectDocumentFitsViewport(page);
      await expectHorizontallyReachable(promote, viewport.width);
      await expectHorizontallyReachable(closePreview, viewport.width);
    });
  });
}
