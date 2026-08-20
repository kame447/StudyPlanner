import { expect, test } from '@playwright/test';

async function seedHome(page) {
  await page.addInitScript(() => {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const user = {
      id: 'ai-planning-surface-user',
      email: 'ai-planning-surface@example.com',
      username: 'ai-planning-surface-user',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'ai-planning-surface-plan',
      seriesId: 'ai-planning-surface-plan',
      userId: user.id,
      title: '情報資源総論',
      subject: '情報科学',
      type: 'study',
      date: today,
      startTime: '10:20',
      endTime: '11:50',
      memo: '',
      recurrence: null,
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  });
}

test('home AI planning entry opens the dedicated Stable V5 conversation surface', async ({ page }) => {
  await seedHome(page);
  await page.goto('/');
  await expect(page.locator('.home-dashboard-default')).toBeVisible();

  const homeTopbarBox = await page.locator('.home-topbar').boundingBox();
  const homeNavBox = await page.locator('.home-bottom-nav').boundingBox();

  await page.locator('.home-bottom-nav button').first().click();

  await expect(page.locator('.ai-planning-view')).toBeVisible();
  await expect(page.locator('.ai-planning-heading h1')).toHaveText('AI計画');
  await expect(page.locator('.ai-planning-conversation')).toBeVisible();
  await expect(page.locator('.ai-planning-composer textarea')).toBeVisible();
  await expect(page.locator('.quick-entry-modal')).toHaveCount(0);
  await expect(page.locator('.ai-planning-view .segmented-control')).toHaveCount(0);
  await expect(page.getByText('相談', { exact: true })).toHaveCount(0);
  await expect(page.getByText('週間計画', { exact: true })).toHaveCount(0);
  await expect(page.getByText('こんにちは。今週の目標や予定に合わせて、学習計画を作成します。')).toHaveCount(0);
  await expect(page.locator('.ai-planning-starter-list button')).toHaveCount(3);

  const aiNavBox = await page.locator('.ai-planning-home-nav').boundingBox();
  expect(aiNavBox?.width).toBeCloseTo(homeNavBox?.width ?? 0, 0);
  expect(aiNavBox?.height).toBeCloseTo(homeNavBox?.height ?? 0, 0);

  const aiSurfaceBox = await page.locator('.ai-planning-view').boundingBox();
  expect(aiSurfaceBox?.y).toBeGreaterThanOrEqual((homeTopbarBox?.y ?? 0) + (homeTopbarBox?.height ?? 0));

  await page.locator('.ai-planning-chat-menu-button').click();
  await expect(page.locator('.ai-chat-drawer')).toBeVisible();
  await expect(page.locator('.ai-chat-row')).toHaveCount(1);
  await page.locator('.ai-chat-new-button').click();
  await page.locator('.ai-planning-chat-menu-button').click();
  await expect(page.locator('.ai-chat-row')).toHaveCount(2);
  await page.locator('.ai-chat-search input').fill('新しい');
  await expect(page.locator('.ai-chat-row')).toHaveCount(2);
  await page.locator('.ai-chat-drawer-header button').click();

  await page.locator('.home-top-actions .home-icon-button').last().click();
  await expect(page.locator('.app-settings-overlay')).toBeVisible();
  const stacking = await page.evaluate(() => ({
    ai: Number.parseInt(getComputedStyle(document.querySelector('.ai-planning-view')).zIndex || '0', 10),
    modal: Number.parseInt(getComputedStyle(document.querySelector('.app-settings-overlay')).zIndex || '0', 10),
  }));
  expect(stacking.modal).toBeGreaterThan(stacking.ai);
  await page.locator('.app-settings-modal .ghost-button').first().click();

  await page.locator('.home-avatar-button').click();
  await expect(page.locator('.my-page-modal')).toBeVisible();
  const profileStacking = await page.evaluate(() => ({
    ai: Number.parseInt(getComputedStyle(document.querySelector('.ai-planning-view')).zIndex || '0', 10),
    modal: Number.parseInt(getComputedStyle(document.querySelector('.my-page-modal')?.parentElement).zIndex || '0', 10),
  }));
  expect(profileStacking.modal).toBeGreaterThan(profileStacking.ai);
  await page.locator('.my-page-modal .ghost-button').first().click();

  await page.locator('.ai-planning-home-nav button').nth(2).click();
  await expect(page.locator('.ai-planning-view')).toHaveCount(0);
  await expect(page.locator('.home-dashboard-default')).toBeVisible();
});
