import { expect, test } from '@playwright/test';

function toIsoDate(value) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function isoToday() {
  return toIsoDate(new Date());
}

function weekStartFor(value) {
  const monday = new Date(value);
  const weekday = monday.getDay();
  monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return toIsoDate(monday);
}

async function seedUser(page, { withPreview = false } = {}) {
  await page.addInitScript(({ today, weekStartDate, seedPreview }) => {
    const now = new Date().toISOString();
    const user = {
      id: 'schedule-touch-drag-lock-user',
      email: 'schedule-touch-drag-lock@example.com',
      username: 'schedule-touch-drag-lock',
      avatar: '',
      createdAt: now,
    };
    const plan = {
      id: 'touch-drag-plan',
      seriesId: 'touch-drag-plan',
      userId: user.id,
      title: '長押し移動確認',
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
      ...plan,
      id: 'touch-sibling-plan',
      seriesId: 'touch-sibling-plan',
      title: '残る予定',
      subject: '英語',
      startTime: '11:00',
      endTime: '12:00',
    };

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan, siblingPlan]));
    localStorage.setItem('studyplanner.actuals', '[]');
    localStorage.setItem('studyplanner.todos.v1', '[]');
    localStorage.setItem('studyplanner.studySubjects.v1', '[]');
    localStorage.setItem('studyplanner.studyMaterials.v1', '[]');

    if (!seedPreview) return;

    const draftBlock = {
      id: 'touch-preview-block',
      userId: user.id,
      date: today,
      startTime: '13:00',
      endTime: '14:00',
      title: '金フレ 1時間',
      subject: 'TOEIC',
      type: 'study',
      label: '金フレ',
      source: 'ai',
      status: 'draft',
      userEdited: false,
      createdAt: now,
      updatedAt: now,
    };
    const planningState = {
      weekStartDate,
      revision: 1,
      conversationRequestSequence: 0,
      mode: 'draft_created',
      draftBlocks: [draftBlock],
      previewCandidates: [
        {
          stableKey: draftBlock.id,
          date: draftBlock.date,
          startTime: draftBlock.startTime,
          endTime: draftBlock.endTime,
          durationMinutes: 60,
          title: draftBlock.title,
          field: draftBlock.subject,
          year: 1,
          estimatedMinutes: 60,
          source: 'weekly_exam_prep',
          approvalStatus: 'unapproved',
          workItemKey: 'gold-phrase',
        },
      ],
      messages: [],
      updatedAt: now,
    };
    localStorage.setItem(
      `studyplanner.weeklyPlanning.${user.id}.${weekStartDate}`,
      JSON.stringify({
        version: 3,
        ownerId: user.id,
        payload: { version: 2, state: planningState },
      }),
    );
    localStorage.setItem(
      `studyplanner.weeklyPlanning.activeSession.${user.id}`,
      JSON.stringify({
        version: 1,
        ownerId: user.id,
        weekStartDate,
        conversationId: null,
      }),
    );
  }, {
    today: isoToday(),
    weekStartDate: weekStartFor(new Date()),
    seedPreview: withPreview,
  });
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
  if (!box) throw new Error('Drag target not measurable');
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function openSchedule(page) {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(page.locator('.schedule-workspace-shell')).toBeVisible();
  const dayTab = page.getByRole('tab', { name: '日', exact: true });
  if ((await dayTab.getAttribute('aria-selected')) !== 'true') {
    await dayTab.click();
  }
}

async function openDaySchedule(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await seedUser(page);
  await openSchedule(page);
  const session = await enableTouch(page);
  return { context, page, session };
}

test('day short touch remains a normal tap without exposing delete action', async ({ browser }) => {
  const { context, page } = await openDaySchedule(browser);
  const plan = page.locator('.timeline-plan-block').filter({ hasText: '長押し移動確認' });
  const { x, y } = await locatorCenter(plan);

  await page.touchscreen.tap(x, y);

  await expect(page.locator('.schedule-item-delete-action')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /長押し移動確認の操作/ })).toBeVisible();

  await context.close();
});

test('day touch hold shows delete while held, keeps it after release, and deletes only the target', async ({ browser }) => {
  const { context, page, session } = await openDaySchedule(browser);
  const plan = page.locator('.timeline-plan-block').filter({ hasText: '長押し移動確認' });
  const sibling = page.locator('.timeline-plan-block').filter({ hasText: '残る予定' });
  const { x, y } = await locatorCenter(plan);

  await dispatchTouch(session, 'touchStart', x, y);
  await page.waitForTimeout(300);

  const action = page.getByRole('button', { name: '長押し移動確認を削除' });
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

test('day long press reveals action, then movement hands off to drag and locks background', async ({ browser }) => {
  const { context, page, session } = await openDaySchedule(browser);
  const plan = page.locator('.timeline-plan-block').filter({ hasText: '長押し移動確認' });
  const { x, y } = await locatorCenter(plan);
  const bodyOverflowBefore = await page.evaluate(() => document.body.style.overflow);
  const scrollYBefore = await page.evaluate(() => window.scrollY);

  await dispatchTouch(session, 'touchStart', x, y);
  await page.waitForTimeout(300);

  await expect(page.getByRole('button', { name: '長押し移動確認を削除' })).toBeVisible();
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('is-timeline-drag-interaction-locked')))
    .toBe(false);

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

test('AI preview stationary long press waits for action while movement starts drag', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await seedUser(page, { withPreview: true });
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').first().click();

  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(preview).toBeVisible();
  await preview.locator('.ai-planning-week-header > div').first().click();
  await expect(preview.getByRole('tab', { name: '日別' })).toHaveAttribute('aria-selected', 'true');

  const session = await enableTouch(page);
  const draft = preview.locator('.ai-planning-preview-day-column-detail .ai-planning-draft-block');
  const { x, y } = await locatorCenter(draft);

  await dispatchTouch(session, 'touchStart', x, y);
  await page.waitForTimeout(300);

  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('is-timeline-drag-interaction-locked')))
    .toBe(false);

  await dispatchTouch(session, 'touchMove', x, y + 80);
  await page.waitForTimeout(50);

  await expect(page.locator('.schedule-week-drag-overlay')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('is-timeline-drag-interaction-locked')))
    .toBe(true);
  await expect(preview).not.toHaveClass(/is-bottom-sheet-dragging/);
  expect(
    await preview.evaluate((element) => element.style.getPropertyValue('--planner-bottom-sheet-drag-y')),
  ).toBe('');

  await dispatchTouch(session, 'touchCancel', x, y + 80);
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('is-timeline-drag-interaction-locked')))
    .toBe(false);

  await context.close();
});
