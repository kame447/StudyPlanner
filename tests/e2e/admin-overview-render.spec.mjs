import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const artifactsDir = path.resolve('artifacts/admin-overview');
fs.mkdirSync(artifactsDir, { recursive: true });

async function assertNoHorizontalOverflow(page) {
  const diagnostic = await page.evaluate(() => {
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const overflow = Math.max(0, root.scrollWidth - viewportWidth);
    const offenders = [...document.querySelectorAll('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          width: Math.round(rect.width),
          right: Math.round(rect.right),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        };
      })
      .filter((item) => item.right > viewportWidth + 1 || item.scrollWidth > item.clientWidth + 1)
      .sort((left, right) => {
        const leftOverflow = Math.max(left.right - viewportWidth, left.scrollWidth - left.clientWidth);
        const rightOverflow = Math.max(right.right - viewportWidth, right.scrollWidth - right.clientWidth);
        return rightOverflow - leftOverflow;
      })
      .slice(0, 8);
    return { overflow, viewportWidth, rootScrollWidth: root.scrollWidth, offenders };
  });
  if (diagnostic.overflow > 1) console.log(`ADMIN_HORIZONTAL_OVERFLOW ${JSON.stringify(diagnostic)}`);
  expect(diagnostic.overflow).toBeLessThanOrEqual(1);
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
  await expect(navigation.getByRole('button', { name: 'AI・API' })).toBeEnabled();
  await expect(navigation.getByRole('button', { name: 'Planning' })).toBeEnabled();
  await expect(navigation.getByRole('button', { name: 'Logs' })).toBeEnabled();
  await screenshot(page, `overview-${options.label}`);
}

async function inspectUsers(page, options) {
  await openSurface(page, { ...options, view: 'users' });
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByText('プロフィールから調査を開始')).toBeVisible();
  await expect(page.getByPlaceholder('actor / profile IDで絞り込み')).toBeVisible();
  const firstStats = page.locator('.admin-user-stats').first();
  await expect(firstStats).toContainText('最終利用');
  await expect(firstStats).toContainText('利用日数');
  await expect(firstStats).toContainText('AI');
  await expect(firstStats).toContainText('計画');
  await expect(firstStats).toContainText('直近error');
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
  await screenshot(page, `ai-${options.label}`);
}

async function inspectPlanning(page, options) {
  await openSurface(page, { ...options, view: 'planning' });
  await expect(page.getByRole('heading', { name: 'Planning Analytics' })).toBeVisible();
  await expect(page.getByText('Planning Session', { exact: true })).toBeVisible();
  await expect(page.getByText('保存完了率')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Session funnel' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '品質シグナル' })).toBeVisible();
  await expect(page.getByText('fallback使用')).toBeVisible();
  await expect(page.getByText('semantic repair使用')).toBeVisible();
  await expect(page.getByText('abandoned')).toBeVisible();
  await screenshot(page, `planning-${options.label}`);
}

async function inspectLogs(page, options) {
  await openSurface(page, { ...options, view: 'logs' });
  await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible();
  await expect(page.getByText('Restricted diagnostics')).toBeVisible();
  await expect(page.getByPlaceholder('weekly-trace-...')).toBeVisible();
  await expect(page.getByText('診断データは高感度です。')).toBeVisible();
  await expect(page.getByText('Weekly Planning', { exact: true })).toBeVisible();
  await expect(page.getByText('subject-a1b2c3d4e5f6')).toBeVisible();
  await page.locator('.admin-log-session-toggle').first().click();
  await expect(page.getByText('Session Debug Bundle')).toBeVisible();
  await expect(page.getByText('approval_failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Redacted detail').first()).toBeVisible();
  await screenshot(page, `logs-${options.label}`);
}

const viewports = [
  { theme: 'light', width: 1440, height: 1000, label: 'desktop-light' },
  { theme: 'dark', width: 1440, height: 1000, label: 'desktop-dark' },
  { theme: 'light', width: 390, height: 844, label: 'mobile-light' },
  { theme: 'dark', width: 390, height: 844, label: 'mobile-dark' },
];

test.describe('Admin console rendered UI', () => {
  for (const viewport of viewports) {
    test(`Overview ${viewport.label} remains readable and contained`, async ({ page }) => { await inspectOverview(page, viewport); });
    test(`Users ${viewport.label} remains readable and contained`, async ({ page }) => { await inspectUsers(page, viewport); });
    test(`User detail ${viewport.label} remains readable and contained`, async ({ page }) => { await inspectUserDetail(page, viewport); });
    test(`AI API ${viewport.label} remains readable and contained`, async ({ page }) => { await inspectAi(page, viewport); });
    test(`Planning ${viewport.label} remains readable and contained`, async ({ page }) => { await inspectPlanning(page, viewport); });
    test(`Logs ${viewport.label} remains readable and contained`, async ({ page }) => { await inspectLogs(page, viewport); });
  }

  test('Users empty state remains explicit on mobile', async ({ page }) => {
    await openSurface(page, { view: 'users', theme: 'light', width: 390, height: 844, state: 'empty' });
    await expect(page.getByText('該当するユーザーがいません')).toBeVisible();
    await screenshot(page, 'users-empty-mobile-light');
  });

  test('User detail empty state does not invent history', async ({ page }) => {
    await openSurface(page, { view: 'user-detail', theme: 'dark', width: 390, height: 844, state: 'empty' });
    await expect(page.getByText('actorが見つかりません')).toBeVisible();
    await screenshot(page, 'user-detail-empty-mobile-dark');
  });

  test('AI API empty state reports no requests instead of fabricating usage', async ({ page }) => {
    await openSurface(page, { view: 'ai', theme: 'light', width: 1440, height: 1000, state: 'empty' });
    await expect(page.getByRole('heading', { name: 'AI・API' })).toBeVisible();
    await expect(page.getByText('この期間のAIリクエストはありません。').first()).toBeVisible();
    await expect(page.getByText('未計測', { exact: true }).first()).toBeVisible();
    await screenshot(page, 'ai-empty-desktop-light');
  });

  test('Planning empty state reports no sessions without fabricating conversion', async ({ page }) => {
    await openSurface(page, { view: 'planning', theme: 'light', width: 1440, height: 1000, state: 'empty' });
    await expect(page.getByRole('heading', { name: 'Planning Analytics' })).toBeVisible();
    await expect(page.getByText('0', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('未計測', { exact: true }).first()).toBeVisible();
    await screenshot(page, 'planning-empty-desktop-light');
  });

  test('Logs empty state does not equate missing trace with no incidents', async ({ page }) => {
    await openSurface(page, { view: 'logs', theme: 'light', width: 390, height: 844, state: 'empty' });
    await expect(page.getByText('該当する診断sessionはありません')).toBeVisible();
    await expect(page.getByText(/0件を「障害なし」とは解釈しません/)).toBeVisible();
    await screenshot(page, 'logs-empty-mobile-light');
  });

  test('Overview error state remains readable and contained', async ({ page }) => {
    await openSurface(page, { view: 'overview', theme: 'dark', width: 1440, height: 1000, state: 'error' });
    await expect(page.getByText('Overviewを取得できませんでした')).toBeVisible();
    await screenshot(page, 'overview-error-desktop-dark');
  });

  test('Planning error state remains readable and contained', async ({ page }) => {
    await openSurface(page, { view: 'planning', theme: 'dark', width: 390, height: 844, state: 'error' });
    await expect(page.getByText('Harness planning analytics read failed.')).toBeVisible();
    await screenshot(page, 'planning-error-mobile-dark');
  });

  test('Logs restricted read error remains explicit and contained', async ({ page }) => {
    await openSurface(page, { view: 'logs', theme: 'dark', width: 390, height: 844, state: 'error' });
    await expect(page.getByText('Logsを取得できませんでした')).toBeVisible();
    await expect(page.getByText('Harness restricted diagnostic read failed.')).toBeVisible();
    await screenshot(page, 'logs-error-mobile-dark');
  });
});
