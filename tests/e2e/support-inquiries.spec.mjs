import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const artifactsDir = path.resolve('artifacts/admin-overview');
fs.mkdirSync(artifactsDir, { recursive: true });

async function checkLayout(page, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(artifactsDir, `${label}.png`), fullPage: true });
}

for (const viewport of [{ label: 'desktop', width: 1440, height: 1000 }, { label: 'mobile', width: 375, height: 812 }]) {
  for (const theme of ['light', 'dark']) {
    test(`email-free inquiry and inbox layout: ${viewport.label}/${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/admin-overview.html?view=contact&theme=${theme}`);
      await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
      await expect(page.locator('input[type=email]')).toHaveCount(0);
      await page.getByLabel('お問い合わせ内容', { exact: true }).fill('予定を保存できません。');
      await checkLayout(page, `contact-${viewport.label}-${theme}`);
      await page.getByRole('button', { name: '送信する', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('受け付けました');
      expect(await page.evaluate(() => window.__inquirySubmissions.length)).toBe(1);
      await page.goto(`/admin-overview.html?view=inquiries&theme=${theme}`);
      await expect(page.locator('.inquiry-admin-card')).toHaveCount(25);
      await expect(page.locator('.inquiry-admin-body').first()).toContainText('予定の保存について');
      await checkLayout(page, `inquiries-${viewport.label}-${theme}`);
      await page.getByRole('button', { name: '次の25件' }).click();
      await expect(page.locator('.inquiry-admin-card')).toHaveCount(1);
      expect(await page.evaluate(() => window.__inquiryReads.length)).toBe(2);
      await page.getByRole('button', { name: '最新を表示' }).click();
      await expect(page.locator('.inquiry-admin-card')).toHaveCount(25);
    });
  }
}

test('unknown submission result retries the same receipt, then clears content on sign-out', async ({ page }) => {
  await page.goto('/admin-overview.html?view=contact&state=retry');
  await page.getByLabel('お問い合わせ内容', { exact: true }).fill('再送でも一件だけ受け付けてください。');
  await expect(page.getByRole('textbox', { name: 'お問い合わせ内容', exact: true })).toHaveAccessibleName('お問い合わせ内容');
  await page.getByRole('button', { name: '送信する', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('送信結果を確認できません');
  await expect(page.getByLabel('お問い合わせ内容', { exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'お問い合わせ内容', exact: true })).toHaveAccessibleName('お問い合わせ内容');
  await expect(page.getByLabel('お問い合わせ内容', { exact: true })).toHaveValue('再送でも一件だけ受け付けてください。');
  await page.getByRole('button', { name: '同じ内容で再試行' }).click();
  await expect(page.getByRole('status')).toContainText('受け付けました');
  const submissions = await page.evaluate(() => window.__inquirySubmissions);
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  await page.evaluate(() => window.__inquiryAuthSwitch(null));
  await expect(page.getByText('お問い合わせを送信するにはログインしてください。')).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('admin empty/error states are distinct and retry only when requested', async ({ page }) => {
  await page.goto('/admin-overview.html?view=inquiries&state=empty');
  await expect(page.getByText('お問い合わせはまだありません。')).toBeVisible();
  await page.goto('/admin-overview.html?view=inquiries&state=error');
  await expect(page.getByRole('alert')).toContainText('取得できません');
  expect(await page.evaluate(() => window.__inquiryReads.length)).toBe(1);
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.locator('.inquiry-admin-card')).toHaveCount(25);
});

test('production admin sidebar routes inquiries and removes them immediately on access revocation', async ({ page }) => {
  await page.goto('/admin-overview.html?view=inquiries');
  const navigation = page.getByRole('navigation', { name: '管理者画面ナビゲーション' });
  await expect(page.getByRole('heading', { name: 'お問い合わせ', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'お問い合わせ', exact: true }).click();
  await expect(page.locator('.inquiry-admin-card')).toHaveCount(25);
  await page.evaluate(() => window.__inquiryAdminAccess(false));
  await expect(page.getByRole('alert')).toContainText('アクセス権限がありません');
  await expect(page.locator('.inquiry-admin-card')).toHaveCount(0);
  await expect(navigation).toHaveCount(0);
});
