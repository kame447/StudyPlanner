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

const photoFile = {
  name: 'test-photo.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'),
};
for (const width of [375, 1440]) {
  test(`private photos preserve drafts and recover the same receipt after reload: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin-overview.html?view=contact&photos=retry');
    const picker = page.locator('input[type=file]');
    await expect(picker).toBeEnabled(); await picker.setInputFiles(photoFile);
    await expect(page.getByAltText('添付予定の写真1')).toBeVisible();
    await page.getByLabel('お問い合わせ内容', { exact: true }).fill('写真付きの問い合わせ');
    await page.evaluate(() => window.__inquiryVisible(false));
    await page.getByText('別画面', { exact: true }).waitFor();
    await page.evaluate(() => window.__inquiryVisible(true));
    await expect(page.getByAltText('添付予定の写真1')).toBeVisible();
    await expect(page.getByLabel('お問い合わせ内容', { exact: true })).toHaveValue('写真付きの問い合わせ');
    await page.getByRole('button', { name: '送信する', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('本文は受け付けました');
    const submissions = await page.evaluate(() => window.__inquirySubmissions);
    expect(submissions).toHaveLength(1);
    const marker = await page.evaluate(() => JSON.parse(sessionStorage.getItem('laplance.inquiry-receipt.v1')));
    expect(JSON.stringify(marker)).not.toContain('写真付きの問い合わせ');
    expect(JSON.stringify(marker)).not.toContain('test-photo.png');
    await page.reload();
    await expect(page.getByText(/受付時と同じ写真1枚/)).toBeVisible();
    await expect(page.locator('textarea')).toHaveCount(0);
    await page.locator('input[type=file]').setInputFiles(photoFile);
    await page.getByRole('button', { name: '写真だけ再送する' }).click();
    await expect(page.getByRole('status')).toHaveText('お問い合わせと写真を受け付けました。');
    expect(await page.evaluate(() => window.__inquirySubmissions.length)).toBe(0);
    expect((await page.evaluate(() => window.__inquiryUploads))[0].receipt).toBe(submissions[0].requestId);
    await checkLayout(page, `private-photos-recovered-${width}`);
  });
  test(`administrator images load only on explicit open and close safely: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin-overview.html?view=inquiries&photos=available');
    await expect(page.getByRole('button', { name: '写真を開く' })).toBeVisible();
    expect(await page.evaluate(() => window.__inquiryPhotoReads.length)).toBe(0);
    await page.getByRole('button', { name: '写真を開く' }).click();
    const photo = page.getByAltText('お問い合わせに添付された写真1');
    await expect(photo).toBeVisible();
    await expect(photo).toHaveJSProperty('naturalWidth', 1080);
    await expect(photo).toHaveJSProperty('naturalHeight', 1920);
    const dimensions = await photo.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const parent = element.closest('.inquiry-admin-card').getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, left: bounds.left, right: bounds.right, parentLeft: parent.left, parentRight: parent.right };
    });
    expect(dimensions.height).toBeGreaterThan(400);
    expect(dimensions.height).toBeLessThanOrEqual(900 * 0.8 + 1);
    expect(dimensions.width / dimensions.height).toBeCloseTo(1080 / 1920, 2);
    expect(dimensions.left).toBeGreaterThanOrEqual(dimensions.parentLeft);
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.parentRight);
    expect(await page.evaluate(() => window.__inquiryPhotoReads.length)).toBe(1);
    await checkLayout(page, `private-photo-admin-${width}`);
    await page.locator('.inquiry-admin-card').first().screenshot({ path: path.join(artifactsDir, `private-photo-detail-${width}.png`) });
    await page.getByRole('button', { name: '写真を閉じる' }).click();
    await expect(page.getByAltText('お問い合わせに添付された写真1')).toHaveCount(0);
    await page.getByRole('button', { name: '写真を開く' }).click();
    expect(await page.evaluate(() => window.__inquiryPhotoReads.length)).toBe(2);
    await page.evaluate(() => window.__inquiryAdminAccess(false));
    await expect(page.getByAltText('お問い合わせに添付された写真1')).toHaveCount(0);
  });
}
