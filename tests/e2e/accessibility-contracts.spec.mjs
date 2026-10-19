import { expect, test } from '@playwright/test';

const HARNESS_URL = 'http://127.0.0.1:4174';
const AUTH_HARNESS_URL = `${HARNESS_URL}/?scenario=auth`;

async function assertDeclaredTabListIntegrity(tabList) {
  if (await tabList.count() === 0) {
    return false;
  }

  await expect(tabList).toBeVisible();
  const tabs = tabList.getByRole('tab');
  const tabCount = await tabs.count();
  expect(tabCount).toBeGreaterThan(1);

  const selectedStates = [];
  for (let index = 0; index < tabCount; index += 1) {
    selectedStates.push(await tabs.nth(index).getAttribute('aria-selected'));
  }
  expect(selectedStates.filter((value) => value === 'true')).toHaveLength(1);
  expect(selectedStates.every((value) => value === 'true' || value === 'false')).toBe(true);
  return true;
}

test.describe('browser accessibility contracts', () => {
  test('QuickEntryModal is exposed as an accessible dialog without prescribing its implementation mechanism', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('AuthScreen mode controls are internally consistent if they declare the tab pattern', async ({ page }) => {
    await page.goto(AUTH_HARNESS_URL);
    await assertDeclaredTabListIntegrity(page.getByRole('tablist', { name: '認証モード' }));
  });

  test('weekly preview controls are internally consistent if they declare the tab pattern', async ({ page }) => {
    await page.goto(`${HARNESS_URL}/real-weekly.html?preview=1`);
    const input = page.locator('.ai-planning-composer textarea');
    await expect(input).toBeVisible();
    await input.fill('プレビューのタブを検査する条件');
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('button', { name: '計画プレビューを確認' }).click();
    const preview = page.getByRole('dialog', { name: '計画プレビュー' });
    await expect(preview).toBeVisible();
    const previewTabList = preview.getByRole('tablist', { name: '計画プレビュー表示' });
    await expect(previewTabList).toHaveCount(1);
    await assertDeclaredTabListIntegrity(previewTabList);
  });

  test('plan versus actual switching remains operable regardless of whether it uses tabs or another accessible control pattern', async ({ page }) => {
    await page.goto(HARNESS_URL);

    const tabList = page.getByRole('tablist', { name: '入力種別' });
    if (await assertDeclaredTabListIntegrity(tabList)) {
      await tabList.getByRole('tab', { name: '記録' }).click();
    } else {
      await page.getByRole('button', { name: '記録', exact: true }).click();
    }

    await expect(page.getByPlaceholder('例: 英語の復習')).toBeVisible();
  });
});
