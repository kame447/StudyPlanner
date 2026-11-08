import { expect, test } from './support/fixed-clock.mjs';

test('AI planning hides starter suggestions even when exam, task, and material exist', async ({ page }) => {
  await page.addInitScript(() => {
    const today = new Date().toLocaleDateString('sv-SE');
    const dateAfter = (days) => {
      const date = new Date(`${today}T00:00:00`);
      date.setDate(date.getDate() + days);
      return date.toLocaleDateString('sv-SE');
    };
    const now = new Date().toISOString();
    const user = {
      id: 'ai-planning-starter-user',
      email: 'starter@example.com',
      username: 'starter-user',
      avatar: '',
      createdAt: now,
    };
    const examDate = dateAfter(7);
    const todoDate = dateAfter(4);
    const materialDate = dateAfter(12);

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.plans', JSON.stringify([{
      id: 'exam-plan',
      seriesId: 'exam-plan',
      userId: user.id,
      title: '情報処理試験',
      subject: '情報',
      date: examDate,
      startTime: '10:00',
      endTime: '11:00',
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      type: 'mock-exam',
      memo: '',
      createdAt: now,
      updatedAt: now,
    }]));
    localStorage.setItem('studyplanner.todos.v1', JSON.stringify([{
      id: 'report-todo',
      userId: user.id,
      title: '英語レポート',
      subject: '英語',
      type: 'deadline',
      estimatedMinutes: 120,
      dueDate: todoDate,
      dueTime: null,
      memo: '',
      status: 'open',
      scheduledPlanId: null,
      createdAt: now,
      updatedAt: now,
    }]));
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([{
      id: 'material',
      userId: user.id,
      name: '基本情報問題集',
      subjectId: 'information',
      subjectName: '情報',
      status: 'active',
      totalUnits: 100,
      currentUnit: 30,
      targetDate: materialDate,
      createdAt: now,
      updatedAt: now,
    }]));
  });

  await page.goto('/');
  await page.locator('.home-bottom-nav button').first().click();

  await expect(page.locator('.ai-planning-view')).toBeVisible();
  await expect(page.locator('.ai-planning-starters')).toHaveCount(0);
  const composer = page.locator('.ai-planning-composer textarea');
  await expect(composer).toBeVisible();
  await composer.fill('今週の数学の勉強を計画したい');
  await expect(composer).toHaveValue('今週の数学の勉強を計画したい');
});
