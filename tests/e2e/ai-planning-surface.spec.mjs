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

  await page.locator('.home-bottom-nav button').first().click();

  await expect(page.locator('.ai-planning-view')).toBeVisible();
  await expect(page.locator('.ai-planning-heading h1')).toHaveText('AI計画');
  await expect(page.locator('.ai-planning-conversation')).toBeVisible();
  await expect(page.locator('.ai-planning-composer textarea')).toBeVisible();
  await expect(page.locator('.quick-entry-modal')).toHaveCount(0);
  await expect(page.locator('.ai-planning-view .segmented-control')).toHaveCount(0);
  await expect(page.getByText('相談', { exact: true })).toHaveCount(0);
  await expect(page.getByText('週間計画', { exact: true })).toHaveCount(0);

  await page.locator('.ai-planning-bottom-nav button').nth(2).click();
  await expect(page.locator('.ai-planning-view')).toHaveCount(0);
  await expect(page.locator('.home-dashboard-default')).toBeVisible();
});
