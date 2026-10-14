import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
const artifacts = path.resolve('artifacts/admin-overview');
fs.mkdirSync(artifacts, { recursive: true });
for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
  test(`announcements list/detail/read state ${width}/${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/admin-overview.html?view=announcements&theme=${theme}`);
    const originalRootScroll = await page.evaluate(() => ({
      overflow: getComputedStyle(document.documentElement).overflow,
      gutter: getComputedStyle(document.documentElement).scrollbarGutter,
    }));
    expect(await page.evaluate(() => window.__announcementReads?.length ?? 0)).toBe(0);
    await page.getByRole('button', { name: 'お知らせを開く' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'お知らせ一覧' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'ホームへ戻る' })).toBeFocused();
    await expect(dialog.locator('.announcement-row')).toHaveCount(25);
    await expect(dialog.getByRole('img', { name: '未読' })).toHaveCount(25);
    expect(await page.evaluate(() => document.querySelector('dialog').getBoundingClientRect().width)).toBe(width);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter)).toBe('auto');
    expect(await page.evaluate(() => document.querySelector('dialog').scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: path.join(artifacts, `announcements-${width}-${theme}.png`) });
    await dialog.locator('.announcement-row').first().click();
    await expect(dialog.getByRole('heading', { name: '【解消】朝の時間帯の通信障害につきまして' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'お知らせ一覧へ戻る' })).toBeFocused();
    await expect(dialog.locator('.announcement-body')).toContainText('<script>実行しない本文</script>');
    await expect.poll(() => page.evaluate(() => window.__announcementWrites.length)).toBe(1);
    await page.goBack();
    await expect(dialog.getByRole('heading', { name: 'お知らせ一覧' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'ホームへ戻る' })).toBeFocused();
    await expect(dialog.getByRole('img', { name: '未読' })).toHaveCount(24);
    await dialog.getByRole('button', { name: 'すべて既読' }).click();
    await expect(dialog.getByRole('img', { name: '未読' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'もっと見る' }).click();
    await expect(dialog.locator('.announcement-row')).toHaveCount(26);
    await expect(dialog.getByRole('img', { name: '未読' })).toHaveCount(0);
    expect(await page.evaluate(() => window.__announcementReads.length)).toBe(2);
    await dialog.getByRole('button', { name: 'ホームへ戻る' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => ({
      overflow: getComputedStyle(document.documentElement).overflow,
      gutter: getComputedStyle(document.documentElement).scrollbarGutter,
    }))).toEqual(originalRootScroll);
    await expect(page.getByRole('button', { name: 'お知らせを開く' })).toBeFocused();
    await page.goForward(); await expect(page.getByRole('heading', { name: 'お知らせ一覧' })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
test('announcements failures are explicit, and account changes cannot reopen another owner history', async ({ page }) => {
  await page.goto('/admin-overview.html?view=announcements&state=error');
  await page.getByRole('button', { name: 'お知らせを開く' }).click();
  await expect(page.getByRole('alert')).toContainText('取得できません');
  await page.getByRole('button', { name: '再試行', exact: true }).click(); await expect(page.locator('.announcement-row')).toHaveCount(25);
  await page.evaluate(() => window.__announcementSwitchOwner('another-owner'));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'お知らせを開く' }).click(); await expect(page.locator('.announcement-row')).toHaveCount(25);
  await page.goBack(); await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('failed individual read stays unread and only explicit retry succeeds', async ({ page }) => {
  await page.goto('/admin-overview.html?view=announcements&state=read-error');
  await page.getByRole('button', { name: 'お知らせを開く' }).click(); await page.locator('.announcement-row').first().click();
  await expect(page.getByRole('alert')).toContainText('既読を保存できません');
  expect(await page.evaluate(() => window.__announcementWrites.length)).toBe(1);
  await page.getByRole('button', { name: '既読を再試行' }).click(); await expect(page.getByRole('alert')).toHaveCount(0);
  await page.goBack(); await expect(page.getByRole('img', { name: '未読' })).toHaveCount(24);
});
for (const width of [375, 1440]) test(`admin drafts are separate and explicit publication is previewed ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/admin-overview.html?view=announcements-admin&theme=dark');
  await expect(page.getByRole('heading', { name: 'お知らせ管理' })).toBeVisible();
  await page.getByRole('button', { name: '新しいお知らせ' }).click();
  await page.getByLabel('分類').selectOption('アップデート'); await page.getByLabel('タイトル', { exact: true }).fill('新機能のお知らせ'); await page.getByLabel('本文', { exact: true }).fill('新しい機能を追加しました。\nどうぞお試しください。');
  await page.screenshot({ path: path.join(artifacts, `announcement-editor-${width}.png`) });
  await page.getByRole('button', { name: '下書きを保存' }).click();
  await expect(page.getByRole('status')).toContainText('下書きを保存しました');
  expect(await page.evaluate(() => window.__announcementPublicationTitles())).not.toContain('新機能のお知らせ');
  const card = page.locator('.announcement-admin-card').filter({ hasText: '新機能のお知らせ' });
  await card.getByRole('button', { name: '公開内容を確認' }).click();
  await expect(page.getByRole('heading', { name: '公開内容の確認' })).toBeVisible();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  expect(await page.evaluate(() => window.__announcementPublicationTitles())).not.toContain('新機能のお知らせ');
  await card.getByRole('button', { name: '公開内容を確認' }).click(); await page.getByRole('button', { name: 'この内容で公開' }).click();
  await expect(page.getByRole('status')).toContainText('公開しました');
  expect(await page.evaluate(() => window.__announcementPublicationTitles())).toContain('新機能のお知らせ');
  await page.evaluate(() => window.__inquiryAdminAccess(false));
  await expect(page.getByRole('alert')).toContainText('アクセス権限がありません'); await expect(page.locator('.announcement-admin-card')).toHaveCount(0);
});
