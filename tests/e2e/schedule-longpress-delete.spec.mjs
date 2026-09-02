import { expect, test } from '@playwright/test';

function toIsoDate(value) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

async function seedDaySchedule(page) {
  await page.addInitScript(({ today }) => {
    const now = new Date().toISOString();
    const user = {
      id: 'schedule-longpress-delete-user',
      email: 'schedule-longpress-delete@example.com',
      username: 'schedule-longpress-delete',
      avatar: '',
      createdAt: now,
    };
    const basePlan = {
      id: 'held-plan',
      seriesId: 'held-plan',
      userId: user.id,
      title: '長押し削除確認',
      subject: '数学',
      type: 'study',
      date: today,
      startTime: '09:00',
      endTime: '10:00',
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      memo: '',
      sourceType: 'manual',
      createdAt: now,
      updatedAt: now,
    };
    const siblingPlan = {
      ...basePlan,
      id: 'sibling-plan',
      seriesId: 'sibling-plan',
      title: '残る予定',
      subject: '英語',
      startTime: '11:00',
      endTime: '12:00',
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([basePlan, siblingPlan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');
  }, { today: toIsoDate(new Date()) });
}

async function enableTouch(page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  return session;
}

async function dispatchTouch(session, type, x, y) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints:
      type === 'touchEnd' || type === 'touchCancel'
        ? []
        : [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
}

async function locatorCenter(locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Schedule item not measurable');
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function openDaySchedule(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await seedDaySchedule(page);
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(page.locator('.schedule-workspace-shell')).toBeVisible();
  const dayTab = page.getByRole('tab', { name: '日', exact: true });
  if ((await dayTab.getAttribute('aria-selected')) !== 'true') {
    await dayTab.click();
  }
  const session = await enableTouch(page);
  return { context, page, session };
}

test('day short touch remains a normal tap', async ({ browser }) => {
  const { context, page } = await openDaySchedule(browser);
  const plan = page.locator('.timeline-plan-block').filter({ hasText: '長押し削除確認' });
  const { x, y } = await locatorCenter(plan);

  await page.touchscreen.tap(x, y);

  await expect(page.locator('.schedule-item-delete-action')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /長押し削除確認の操作/ })).toBeVisible();
  await context.close();
});

test('day touch hold reveals delete while held, persists after release, and removes only the held item', async ({ browser }) => {
  const { context, page, session } = await openDaySchedule(browser);
  const plan = page.locator('.timeline-plan-block').filter({ hasText: '長押し削除確認' });
  const sibling = page.locator('.timeline-plan-block').filter({ hasText: '残る予定' });
  const { x, y } = await locatorCenter(plan);

  await dispatchTouch(session, 'touchStart', x, y);
  await page.waitForTimeout(300);

  const action = page.getByRole('button', { name: '長押し削除確認を削除' });
  await expect(action).toBeVisible();
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect(plan).toBeVisible();
  await expect(sibling).toBeVisible();

  await dispatchTouch(session, 'touchEnd', x, y);
  await expect(action).toBeVisible();

  await action.click();
  await expect(plan).toHaveCount(0);
  await expect(sibling).toBeVisible();
  await expect(page.locator('.schedule-item-delete-action')).toHaveCount(0);
  await context.close();
});

test('day long press then movement hands off to drag and hides delete action', async ({ browser }) => {
  const { context, page, session } = await openDaySchedule(browser);
  const plan = page.locator('.timeline-plan-block').filter({ hasText: '長押し削除確認' });
  const { x, y } = await locatorCenter(plan);
  const bodyOverflowBefore = await page.evaluate(() => document.body.style.overflow);
  const scrollYBefore = await page.evaluate(() => window.scrollY);

  await dispatchTouch(session, 'touchStart', x, y);
  await page.waitForTimeout(300);

  await expect(page.getByRole('button', { name: '長押し削除確認を削除' })).toBeVisible();
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);

  await dispatchTouch(session, 'touchMove', x, y + 90);
  await page.waitForTimeout(50);

  await expect(page.locator('.schedule-item-delete-action')).toHaveCount(0);
  await expect(page.locator('.schedule-week-drag-overlay')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('is-timeline-drag-interaction-locked')))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollYBefore);

  await dispatchTouch(session, 'touchCancel', x, y + 90);
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('is-timeline-drag-interaction-locked')))
    .toBe(false);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe(bodyOverflowBefore);
  await context.close();
});
