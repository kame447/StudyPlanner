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

async function screenshot(page, label) {
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(artifactsDir, `${label}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

async function openSurface(page, { view, theme, width, height, state = 'populated' }) {
  await page.setViewportSize({ width, height });
  await page.goto(`/admin-overview.html?view=${view}&theme=${theme}&state=${state}`);
  await expect(page.getByRole('navigation', { name: '管理者画面ナビゲーション' })).toBeVisible();
}

async function inspectOverview(page, options) {
  await openSurface(page, { ...options, view: 'overview' });
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('登録ユーザー数')).toBeVisible();
  await expect(page.getByText('過去7日間の利用ユーザー')).toBeVisible();
  await expect(page.getByText('通常の応答時間')).toBeVisible();
  await expect(page.getByText('遅いケースの応答時間')).toBeVisible();
  await expect(page.getByText('Planningの状態')).toBeVisible();
  const navigation = page.getByRole('navigation', { name: '管理者画面ナビゲーション' });
  const aiApiNav = navigation.getByRole('button', { name: 'AI・API' });
  await expect(aiApiNav).toBeVisible();
  await expect(aiApiNav).toBeEnabled();
  await screenshot(page, `overview-${options.label}`);
}

async function inspectUsers(page, options) {
  await openSurface(page, { ...options, view: 'users' });
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByText('プロフィールから調査を開始')).toBeVisible();
  await expect(page.getByPlaceholder('actor IDで絞り込み')).toBeVisible();
  const firstStats = page.locator('.admin-user-stats').first();
  await expect(firstStats.getByText('イベント', { exact: true })).toBeVisible();
  await expect(firstStats.getByText('AI', { exact: true })).toBeVisible();
  await screenshot(page, `users-${options.label}`);
}

async function inspectUserDetail(page, options) {
  await openSurface(page, { ...options, view: 'user-detail' });
  await expect(page.getByRole('heading', { name: 'ユーザー調査' })).toBeVisible();
  await expect(page.getByText('利用日数')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await expect(page.getByText('gpt-5.6-luna · success')).toBeVisible();
  await expect(page.getByText(/weekly_planning_semantic_normalizer/)).toBeVisible();
  await screenshot(page, `user-detail-${options.label}`);
}

async function inspectAi(page, options) {
  await openSurface(page, { ...options, view: 'ai' });
  await expect(page.getByRole('heading', { name: 'AI・API' })).toBeVisible();
  await expect(page.getByText('総token')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI計画の効率' })).toBeVisible();
  await expect(page.getByText('1 turnあたりrequest')).toBeVisible();
  await expect(page.getByText('repair request率')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Model別' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Purpose別' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Phase別' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operation別' })).toBeVisible();
  await expect(page.getByText('Token usage').first()).toBeVisible();
  await screenshot(page, `ai-${options.label}`);
}

const viewports = [
  { theme: 'light', width: 1440, height: 1000, label: 'desktop-light' },
  { theme: 'dark', width: 1440, height: 1000, label: 'desktop-dark' },
  { theme: 'light', width: 390, height: 844, label: 'mobile-light' },
  { theme: 'dark', width: 390, height: 844, label: 'mobile-dark' },
];

test.describe('Admin console rendered UI', () => {
  for (const viewport of viewports) {
    test(`Overview ${viewport.label} remains readable and contained`, async ({ page }) => {
      await inspectOverview(page, viewport);
    });
    test(`Users ${viewport.label} remains readable and contained`, async ({ page }) => {
      await inspectUsers(page, viewport);
    });
    test(`User detail ${viewport.label} remains readable and contained`, async ({ page }) => {
      await inspectUserDetail(page, viewport);
    });
    test(`AI API ${viewport.label} remains readable and contained`, async ({ page }) => {
      await inspectAi(page, viewport);
    });
  }

  test('Users empty state remains explicit on mobile', async ({ page }) => {
    await openSurface(page, {
      view: 'users',
      theme: 'light',
      width: 390,
      height: 844,
      state: 'empty',
    });
    await expect(page.getByText('該当するactorがいません')).toBeVisible();
    await screenshot(page, 'users-empty-mobile-light');
  });

  test('User detail empty state does not invent history', async ({ page }) => {
    await openSurface(page, {
      view: 'user-detail',
      theme: 'dark',
      width: 390,
      height: 844,
      state: 'empty',
    });
    await expect(page.getByText('actorが見つかりません')).toBeVisible();
    await screenshot(page, 'user-detail-empty-mobile-dark');
  });

  test('AI API empty state reports no requests instead of fabricating usage', async ({ page }) => {
    await openSurface(page, {
      view: 'ai',
      theme: 'light',
      width: 1440,
      height: 1000,
      state: 'empty',
    });
    await expect(page.getByRole('heading', { name: 'AI・API' })).toBeVisible();
    await expect(page.getByText('この期間のAIリクエストはありません。').first()).toBeVisible();
    await expect(page.getByText('未計測', { exact: true }).first()).toBeVisible();
    await screenshot(page, 'ai-empty-desktop-light');
  });

  test('Overview error state remains readable and contained', async ({ page }) => {
    await openSurface(page, {
      view: 'overview',
      theme: 'dark',
      width: 1440,
      height: 1000,
      state: 'error',
    });
    await expect(page.getByText('Overviewを取得できませんでした')).toBeVisible();
    await screenshot(page, 'overview-error-desktop-dark');
  });
});
