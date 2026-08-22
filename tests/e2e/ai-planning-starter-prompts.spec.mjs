import { expect, test } from '@playwright/test';

function offsetDate(baseDate, days) {
  const date = new Date(`${baseDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function shortDate(date) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

test('AI planning starters use registered exam, unfinished task, and active material', async ({ page }) => {
  await page.addInitScript(() => {
    const today = new Date().toISOString().slice(0, 10);
    const dateAfter = (days) => {
      const date = new Date(`${today}T00:00:00`);
      date.setDate(date.getDate() + days);
      return date.toISOString().slice(0, 10);
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
  const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  const examDate = offsetDate(today, 7);
  const todoDate = offsetDate(today, 4);
  const materialDate = offsetDate(today, 12);

  await page.locator('.home-bottom-nav button').first().click();
  await expect(page.locator('.ai-planning-starter-list button')).toHaveCount(3);

  const expected = [
    `${shortDate(examDate)}の情報処理試験に向けて学習計画を作って`,
    `英語レポートを${shortDate(todoDate)}までに終えられるように計画して`,
    `基本情報問題集を${shortDate(materialDate)}までに終えられるように計画して`,
  ];

  for (let index = 0; index < expected.length; index += 1) {
    await expect(page.locator('.ai-planning-starter-list button').nth(index)).toHaveText(expected[index]);
  }

  await page.locator('.ai-planning-starter-list button').nth(1).click();
  await expect(page.locator('.ai-planning-composer textarea')).toHaveValue(expected[1]);
});
