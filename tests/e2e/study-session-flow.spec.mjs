import { expect, test } from '@playwright/test';

async function seedStudySession(page, { dark = false } = {}) {
  await page.addInitScript(({ useDark }) => {
    const nowDate = new Date();
    const planStart = new Date(nowDate.getTime() + 60 * 60 * 1000);
    const planEnd = new Date(planStart.getTime() + 90 * 60 * 1000);
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const formatTime = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const now = nowDate.toISOString();
    const user = {
      id: 'study-session-user',
      email: 'study-session@example.com',
      username: 'study-session-user',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'study-session-plan',
      seriesId: 'study-session-plan',
      userId: user.id,
      title: '卒業研究',
      subject: '研究',
      type: 'study',
      date: formatDate(planStart),
      startTime: formatTime(planStart),
      endTime: formatTime(planEnd),
      memo: '卒論・関連研究の整理',
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      sourceType: 'manual',
      materialId: 'study-session-material',
      materialName: '卒業研究ノート',
      createdAt: now,
      updatedAt: now,
    };
    const material = {
      id: 'study-session-material',
      userId: user.id,
      name: '卒業研究ノート',
      subjectId: 'study-session-subject',
      subjectName: '研究',
      status: 'active',
      paceEnabled: true,
      progressUnit: 'page',
      totalUnits: 100,
      currentUnit: 42,
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));
    if (useDark) localStorage.setItem('study-planner-theme-mode', 'dark');
  }, { useDark: dark });
}

test('study start opens the timer and flows directly into record saving', async ({ page }) => {
  await seedStudySession(page);
  await page.goto('/');

  await page.getByRole('button', { name: '学習を開始する' }).click();
  const session = page.getByRole('dialog', { name: '学習中' });
  await expect(session).toBeVisible();
  await expect(session.getByRole('heading', { name: '卒業研究' })).toBeVisible();
  await expect(session.getByText('通常タイマー', { exact: true })).toBeVisible();

  const elapsed = session.locator('[data-study-session-elapsed]');
  await expect(elapsed).not.toHaveText('00:00:00', { timeout: 2500 });

  await session.getByRole('button', { name: '一時停止' }).click();
  const pausedValue = await elapsed.textContent();
  await page.waitForTimeout(1100);
  await expect(elapsed).toHaveText(pausedValue ?? '');
  await session.getByRole('button', { name: '再開' }).click();

  await session.getByRole('button', { name: '終了する' }).click();
  const record = page.getByRole('dialog', { name: '学習を記録' });
  await expect(record).toBeVisible();
  await expect(record.getByText('実際の学習時間')).toBeVisible();
  await record.locator('[data-study-progress-input]').fill('5');
  await record.getByPlaceholder('つまずいた点や気づき').fill('関連研究の引用候補をメモ。');
  await record.getByRole('button', { name: '記録を保存' }).click();

  await expect(page.locator('.study-session-overlay')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const actuals = JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]');
    return actuals.length;
  })).toBe(1);
});

test('startup canvas remains white while a saved dark theme is being restored', async ({ page }) => {
  await seedStudySession(page, { dark: true });
  await page.addInitScript(() => {
    window.__startupSurfaceSamples = [];
    const sample = () => {
      const splash = document.querySelector('.splash-screen--startup-light');
      if (!splash) return;
      window.__startupSurfaceSamples.push({
        body: getComputedStyle(document.body).backgroundColor,
        splash: getComputedStyle(splash).backgroundColor,
      });
    };
    new MutationObserver(sample).observe(document.documentElement, { childList: true, subtree: true });
    let frames = 0;
    const sampleFrames = () => {
      sample();
      frames += 1;
      if (frames < 120) requestAnimationFrame(sampleFrames);
    };
    requestAnimationFrame(sampleFrames);
  });

  await page.goto('/');
  await expect(page.locator('.home-main')).toBeVisible();
  const samples = await page.evaluate(() => window.__startupSurfaceSamples ?? []);
  expect(samples.length).toBeGreaterThan(0);
  for (const sample of samples) {
    expect(sample.body).toBe('rgb(255, 255, 255)');
    expect(sample.splash).toBe('rgb(255, 255, 255)');
  }
});
