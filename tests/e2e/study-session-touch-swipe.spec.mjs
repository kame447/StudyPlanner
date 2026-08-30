import { expect, test } from '@playwright/test';

async function seedStudySession(page) {
  await page.addInitScript(() => {
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
      id: 'study-session-touch-user',
      email: 'study-session-touch@example.com',
      username: 'study-session-touch-user',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'study-session-touch-plan',
      seriesId: 'study-session-touch-plan',
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
      materialId: 'study-session-touch-material',
      materialName: '卒業研究ノート',
      createdAt: now,
      updatedAt: now,
    };
    const material = {
      id: 'study-session-touch-material',
      userId: user.id,
      name: '卒業研究ノート',
      subjectId: 'study-session-touch-subject',
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
  });
}

function expectExitDialog(page) {
  return new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe(
        '学習セッションを終了してホームに戻りますか？ 計測内容は保存されません。',
      );
      await dialog.dismiss();
      resolve();
    });
  });
}

test('touch swipe locks horizontally, follows the finger, and opens the exit confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedStudySession(page);
  await page.goto('/');

  await page.getByRole('button', { name: '学習を開始する' }).click();
  const ready = page.getByRole('dialog', { name: '学習を開始' });
  await ready.getByRole('button', { name: 'スタート' }).click();

  const session = page.getByRole('dialog', { name: '学習中' });
  const sessionPage = session.locator('.study-session-page');
  const elapsed = session.locator('[data-study-session-elapsed]');
  await expect(session).toBeVisible();
  await expect(elapsed).not.toHaveText('00:00:00', { timeout: 2500 });

  const dialogPromise = expectExitDialog(page);
  const feedback = await sessionPage.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = element;
    const identifier = 7;
    const startX = rect.left + 118;
    const startY = rect.top + 250;

    const makeTouch = (x, y) => ({
      identifier,
      clientX: x,
      clientY: y,
    });
    const makeTouchList = (touch) => ({
      0: touch ?? undefined,
      length: touch ? 1 : 0,
      item: (index) => (touch && index === 0 ? touch : null),
    });
    const dispatchTouch = (type, x, y, active) => {
      const touch = makeTouch(x, y);
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', {
        value: makeTouchList(active ? touch : null),
      });
      Object.defineProperty(event, 'changedTouches', {
        value: makeTouchList(touch),
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };

    dispatchTouch('touchstart', startX, startY, true);
    const firstMovePrevented = dispatchTouch('touchmove', startX + 18, startY + 9, true);
    const firstOffset = element.style.getPropertyValue('--study-session-swipe-x');
    const firstLocked = element.classList.contains('is-swiping-back');

    const secondMovePrevented = dispatchTouch('touchmove', startX + 78, startY + 42, true);
    const secondOffset = element.style.getPropertyValue('--study-session-swipe-x');
    const secondLocked = element.classList.contains('is-swiping-back');

    dispatchTouch('touchend', startX + 86, startY + 48, false);

    return {
      firstMovePrevented,
      firstOffset,
      firstLocked,
      secondMovePrevented,
      secondOffset,
      secondLocked,
    };
  });

  expect(feedback.firstMovePrevented).toBe(true);
  expect(feedback.firstLocked).toBe(true);
  expect(feedback.firstOffset).not.toBe('');
  expect(feedback.secondMovePrevented).toBe(true);
  expect(feedback.secondLocked).toBe(true);
  expect(Number.parseFloat(feedback.secondOffset)).toBeGreaterThan(
    Number.parseFloat(feedback.firstOffset),
  );

  await dialogPromise;
  await expect(session).toBeVisible();
  await expect(sessionPage).not.toHaveClass(/is-swiping-back/);
});
