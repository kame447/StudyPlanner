import { expect, test } from './support/fixed-clock.mjs';

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
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seedStudySession(page);
  await page.goto('/');

  await page.getByRole('button', { name: '勉強を開始' }).click();
  const ready = page.getByRole('dialog', { name: '学習を開始' });
  await ready.getByRole('button', { name: 'スタート' }).click();

  const session = page.getByRole('dialog', { name: '学習中' });
  const sessionPage = session.locator('.study-session-page');
  const elapsed = session.locator('[data-study-session-elapsed]');
  await expect(session).toBeVisible();
  await expect(elapsed).not.toHaveText('00:00:00', { timeout: 2500 });
  const restingLeft = await sessionPage.evaluate(element => element.getBoundingClientRect().left);

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
    const firstRenderedOffset = element.getBoundingClientRect().left - rect.left;

    const secondMovePrevented = dispatchTouch('touchmove', startX + 78, startY + 42, true);
    const secondOffset = element.style.getPropertyValue('--study-session-swipe-x');
    const secondLocked = element.classList.contains('is-swiping-back');
    const secondRenderedOffset = element.getBoundingClientRect().left - rect.left;

    dispatchTouch('touchend', startX + 86, startY + 48, false);

    return {
      firstMovePrevented,
      firstOffset,
      firstLocked,
      firstRenderedOffset,
      secondMovePrevented,
      secondOffset,
      secondLocked,
      secondRenderedOffset,
    };
  });

  expect(feedback.firstMovePrevented).toBe(true);
  expect(feedback.firstLocked).toBe(true);
  expect(feedback.firstOffset).not.toBe('');
  expect(feedback.firstRenderedOffset).toBeCloseTo(Number.parseFloat(feedback.firstOffset), 0);
  expect(feedback.secondMovePrevented).toBe(true);
  expect(feedback.secondLocked).toBe(true);
  expect(feedback.secondRenderedOffset).toBeCloseTo(Number.parseFloat(feedback.secondOffset), 0);
  expect(Number.parseFloat(feedback.secondOffset)).toBeGreaterThan(
    Number.parseFloat(feedback.firstOffset),
  );

  await dialogPromise;
  await expect(session).toBeVisible();
  await expect(sessionPage).not.toHaveClass(/is-swiping-back/);
  await expect.poll(() => sessionPage.evaluate(element => element.getAnimations().length)).toBe(0);
  await expect.poll(() => sessionPage.evaluate(element => element.getBoundingClientRect().left)).toBe(restingLeft);
});

test('aborting a drag during entry preserves its animation and settles without replay', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seedStudySession(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.__studyEntryStarts = 0;
    document.addEventListener('animationstart', event => {
      if (event.animationName !== 'study-session-enter-from-right') return;
      window.__studyEntryStarts += 1;
      const animation = event.target.getAnimations().find(item => item.animationName === event.animationName);
      if (!animation) return;
      // Freeze the real keyframes at a deterministic midpoint. Do not change
      // their duration or depend on a runner completing within 280 ms.
      animation.pause();
      animation.currentTime = 140;
      window.__studyEntry = { element: event.target, animation };
    }, { capture: true });
  });
  await page.getByRole('button', { name: '勉強を開始' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__studyEntry))).toBe(true);
  const feedback = await page.evaluate(() => {
    const { element, animation } = window.__studyEntry;
    const rect = element.getBoundingClientRect();
    const touch = (delta) => ({ identifier: 19, clientX: rect.left + 40 + delta, clientY: rect.top + 200 });
    const touchList = value => ({ 0: value, length: value ? 1 : 0, item: index => index === 0 ? value : null });
    const dispatch = (type, delta, active) => {
      const value = touch(delta);
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touchList(active ? value : null) });
      Object.defineProperty(event, 'changedTouches', { value: touchList(value) });
      element.dispatchEvent(event);
    };
    dispatch('touchstart', 0, true);
    dispatch('touchmove', 18, true);
    const visualOffset = element.getBoundingClientRect().left - rect.left;
    const expectedOffset = Number.parseFloat(element.style.getPropertyValue('--study-session-swipe-x'));
    dispatch('touchcancel', 18, false);
    const result = { visualOffset, expectedOffset,
      abortedOffset: element.getBoundingClientRect().left - rect.left,
      locked: element.classList.contains('is-swiping-back'),
      sameAnimation: element.getAnimations().includes(animation),
      currentTime: animation.currentTime, playState: animation.playState };
    animation.finish();
    return result;
  });
  expect(feedback.expectedOffset).toBe(18);
  expect(feedback.visualOffset).toBeCloseTo(18, 0);
  expect(feedback.abortedOffset).toBeCloseTo(0, 0);
  expect(feedback.locked).toBe(false);
  expect(feedback.sameAnimation).toBe(true);
  expect(feedback.currentTime).toBe(140);
  expect(feedback.playState).toBe('paused');
  const ready = page.getByRole('dialog', { name: '学習を開始', exact: true });
  const pane = ready.locator('.study-session-page');
  await expect(ready).toBeVisible();
  await expect.poll(() => pane.evaluate(element => element.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => window.__studyEntryStarts)).toBe(1);
  expect(await pane.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41)).toBe(0);
  expect(await ready.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
});
