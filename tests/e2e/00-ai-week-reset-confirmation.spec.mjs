import { expect, test } from '@playwright/test';

async function seedAiPlanning(page) {
  await page.addInitScript(() => {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const user = {
      id: 'ai-week-reset-user',
      email: 'ai-week-reset@example.com',
      username: 'ai-week-reset-user',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'ai-week-reset-plan',
      seriesId: 'ai-week-reset-plan',
      userId: user.id,
      title: '既存の予定',
      subject: '情報科学',
      type: 'study',
      date: today,
      startTime: '10:00',
      endTime: '11:00',
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

test('weekly plan reset is separated from chat trash and requires explicit confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAiPlanning(page);
  await page.goto('/');

  await page.locator('.primary-bottom-nav button').first().click();
  await expect(page.locator('.ai-planning-view')).toBeVisible();

  await page.locator('.ai-planning-chat-menu-button').click();
  await expect(page.locator('.ai-chat-drawer')).toBeVisible();
  await expect(page.locator('.ai-chat-delete')).toHaveCount(1);

  const resetButton = page.getByRole('button', { name: /週間計画をリセット/ });
  await expect(resetButton).toBeVisible();
  await resetButton.click();

  const confirmation = page.getByRole('dialog', { name: '今週の計画をリセットしますか？' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('過去のチャット履歴');
  await expect(confirmation).toContainText('保存済みの予定');
  await expect(confirmation).toContainText('学習記録');

  await page.screenshot({
    path: 'artifacts/ai-week-reset-confirmation-mobile.png',
    fullPage: true,
  });

  await confirmation.getByRole('button', { name: 'キャンセル' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('.ai-chat-drawer')).toBeVisible();

  await resetButton.click();
  await page
    .getByRole('dialog', { name: '今週の計画をリセットしますか？' })
    .getByRole('button', { name: 'リセット' })
    .click();

  await expect(page.locator('.ai-chat-drawer')).toHaveCount(0);
  await expect(page.locator('.ai-planning-starters')).toBeVisible();

  await page.locator('.ai-planning-chat-menu-button').click();
  await expect(page.locator('.ai-chat-row')).toHaveCount(2);
  await expect(page.locator('.ai-chat-delete')).toHaveCount(2);
});
