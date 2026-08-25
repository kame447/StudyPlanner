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

test('study session waits for an explicit start and then flows into record saving', async ({ page }) => {
  await seedStudySession(page);
  await page.goto('/');

  await page.getByRole('button', { name: '学習を開始する' }).click();
  const ready = page.getByRole('dialog', { name: '学習を開始' });
  await expect(ready).toBeVisible();
  await expect(ready.getByRole('heading', { name: '卒業研究' })).toBeVisible();
  await expect(ready.getByRole('button', { name: /通常タイマー/ })).toHaveAttribute('aria-pressed', 'true');

  const readyElapsed = ready.locator('[data-study-session-elapsed]');
  await expect(readyElapsed).toHaveText('00:00:00');
  await page.waitForTimeout(1100);
  await expect(readyElapsed).toHaveText('00:00:00');

  await ready.getByRole('button', { name: 'スタート' }).click();
  const session = page.getByRole('dialog', { name: '学習中' });
  const elapsed = session.locator('[data-study-session-elapsed]');
  await expect(session).toBeVisible();
  await expect(session.getByRole('button', { name: /通常タイマー/ })).toBeDisabled();
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

test('study session enters from the right and an edge swipe uses the existing exit confirmation', async ({ page }) => {
  await seedStudySession(page);
  await page.goto('/');

  await page.getByRole('button', { name: '学習を開始する' }).click();
  const ready = page.getByRole('dialog', { name: '学習を開始' });
  const readyPage = ready.locator('.study-session-page');
  await expect(ready).toBeVisible();
  await expect.poll(async () => readyPage.evaluate((element) => getComputedStyle(element).animationName))
    .toContain('study-session-enter-from-right');

  await ready.getByRole('button', { name: 'スタート' }).click();
  const session = page.getByRole('dialog', { name: '学習中' });
  const sessionPage = session.locator('.study-session-page');
  const elapsed = session.locator('[data-study-session-elapsed]');
  await expect(session).toBeVisible();
  await expect(elapsed).not.toHaveText('00:00:00', { timeout: 2500 });

  const box = await sessionPage.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const dialogPromise = new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe(
        '学習セッションを終了してホームに戻りますか？ 計測内容は保存されません。',
      );
      await dialog.dismiss();
      resolve();
    });
  });

  await page.mouse.move(box.x + 8, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 118, box.y + 182, { steps: 4 });
  await page.mouse.up();
  await dialogPromise;

  await expect(session).toBeVisible();
});

test('pomodoro can be selected before start and exposes focus and break UI', async ({ page }) => {
  await seedStudySession(page);
  await page.goto('/');

  await page.getByRole('button', { name: '学習を開始する' }).click();
  const ready = page.getByRole('dialog', { name: '学習を開始' });
  const pomodoro = ready.getByRole('button', { name: /ポモドーロ/ });
  await pomodoro.click();

  await expect(pomodoro).toHaveAttribute('aria-pressed', 'true');
  await expect(ready.locator('[data-pomodoro-phase]')).toHaveText('集中');
  await expect(ready.locator('[data-study-session-phase-remaining]')).toHaveText('25:00');
  await expect(ready.getByText('1 / 3 セット ・ 次は 休憩 5分', { exact: true })).toBeVisible();
  await expect(ready.getByText('現段階では休憩もセッションの総学習時間に含めて記録します。', { exact: true })).toBeVisible();

  await ready.getByRole('button', { name: 'スタート' }).click();
  const session = page.getByRole('dialog', { name: '学習中' });
  await expect(session.getByRole('button', { name: /ポモドーロ/ })).toBeDisabled();
  await expect(session.locator('[data-study-session-phase-remaining]')).not.toHaveText('25:00', { timeout: 2500 });
  await expect(session.getByText(/総経過/)).toBeVisible();
});

test('startup light surface keeps the browser canvas white over a restored dark theme', async ({ page }) => {
  await seedStudySession(page, { dark: true });
  await page.goto('/');
  await expect(page.locator('.home-main')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.evaluate(() => {
    const splash = document.createElement('main');
    splash.className = 'loading-screen splash-screen splash-screen--startup-light';
    splash.setAttribute('aria-label', 'アプリ起動中');
    splash.dataset.browserContractProbe = 'startup-light';
    document.body.appendChild(splash);
  });

  const splash = page.locator('[data-browser-contract-probe="startup-light"]');
  await expect(splash).toBeVisible();

  const surfaces = await page.evaluate(() => {
    const probe = document.querySelector('[data-browser-contract-probe="startup-light"]');
    if (!(probe instanceof HTMLElement)) return null;
    return {
      body: getComputedStyle(document.body).backgroundColor,
      root: getComputedStyle(document.getElementById('root')).backgroundColor,
      splash: getComputedStyle(probe).backgroundColor,
    };
  });

  expect(surfaces).toEqual({
    body: 'rgb(255, 255, 255)',
    root: 'rgb(255, 255, 255)',
    splash: 'rgb(255, 255, 255)',
  });
});
