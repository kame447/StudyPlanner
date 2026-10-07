import { E2E_TODAY, expect, newFixedClockContext, test } from './support/fixed-clock.mjs';

function toIsoDate(value) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
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

    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
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
    today: E2E_TODAY,
    weekStartDate: weekStartFor(new Date(`${E2E_TODAY}T00:00:00`)),
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

async function openSchedule(page, tabName = '日') {
  await page.goto('/');
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(page.locator('.schedule-workspace-shell')).toBeVisible();
  const tab = page.getByRole('tab', { name: tabName, exact: true });
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click();
  }
}

// CDP input exercises Chromium's native gesture/scroll pipeline. DOM-dispatched
// TouchEvents cannot establish this contract, and mobile emulation is not proof
// of Android hardware or iOS Safari behavior (see UI_REGRESSION.md).
const scrollSurfaces = [
  {
    name: 'day',
    tabName: '日',
    viewport: { width: 390, height: 844 },
    scrollSelector: '.schedule-main',
    planSelector: '.timeline-plan-block',
  },
  {
    name: 'short-screen week',
    tabName: '週',
    viewport: { width: 390, height: 560 },
    scrollSelector: '.schedule-week-preview-scroll',
    planSelector: '.schedule-week-plan-button',
  },
];

async function positionPlanForGesture(plan, scrollSelector) {
  await plan.scrollIntoViewIfNeeded();
  const metrics = await plan.evaluate((element, selector) => {
    const scroll = element.closest(selector);
    if (!scroll) throw new Error(`No scroll owner for ${selector}`);
    const card = element.getBoundingClientRect();
    const bounds = scroll.getBoundingClientRect();
    const targetOffset = Math.min(scroll.clientHeight * 0.55, 200);
    // Positioning is test setup only. All observed movement below uses native
    // touch input; no styles or application scroll behavior are overridden.
    scroll.scrollTop += card.top + card.height / 2 - bounds.top - targetOffset;
    return {
      scrollTop: scroll.scrollTop,
      maxScrollTop: scroll.scrollHeight - scroll.clientHeight,
    };
  }, scrollSelector);
  expect(metrics.maxScrollTop, 'fixture must really overflow vertically').toBeGreaterThan(80);
  expect(metrics.maxScrollTop - metrics.scrollTop, 'upward swipe needs scrollable headroom')
    .toBeGreaterThan(60);
  const point = await locatorCenter(plan);
  expect(await plan.evaluate((element, { x, y }) => element.contains(document.elementFromPoint(x, y)), point),
    'native touch must hit the plan rather than an overlay').toBe(true);
  return point;
}

async function nativeSwipeUp(page, session, point, scroll) {
  const before = await scroll.evaluate(element => element.scrollTop);
  await dispatchTouch(session, 'touchStart', point.x, point.y);
  // Move immediately, before the long-press threshold, so ordinary scrolling
  // over the plan itself is the positive control for the drag test.
  await dispatchTouch(session, 'touchMove', point.x, point.y - 40);
  await dispatchTouch(session, 'touchMove', point.x, point.y - 76);
  await dispatchTouch(session, 'touchEnd', point.x, point.y - 76);
  await expect.poll(() => scroll.evaluate(element => element.scrollTop))
    .toBeGreaterThan(before + 16);
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect(page.locator('.schedule-item-delete-action')).toHaveCount(0);
  // Stop waiting only when compositor scrolling has settled, before resetting
  // the fixture position for a new gesture.
  await expect.poll(async () => {
    const first = await scroll.evaluate(element => element.scrollTop);
    await page.waitForTimeout(80);
    return Math.abs((await scroll.evaluate(element => element.scrollTop)) - first);
  }).toBeLessThan(1);
  return { before, after: await scroll.evaluate(element => element.scrollTop) };
}

async function startScrollProbe(page) {
  return page.evaluate(() => {
    const targets = [
      ['document', document.scrollingElement],
      ['schedule', document.querySelector('.schedule-main')],
      ['week', document.querySelector('.schedule-week-preview-scroll')],
    ].filter(([, element]) => element);
    const snapshot = () => Object.fromEntries(targets.map(([name, element]) => [
      name, { x: element.scrollLeft, y: element.scrollTop },
    ]));
    const initial = snapshot();
    const samples = [initial];
    const moves = [];
    const recordScroll = () => samples.push(snapshot());
    const recordMove = event => {
      const observation = {
        trusted: event.isTrusted,
        cancelable: event.cancelable,
        defaultPrevented: null,
      };
      moves.push(observation);
      // React may stop propagation. Observe at capture, then inspect the final
      // cancellation state after all handlers have run without altering input.
      setTimeout(() => { observation.defaultPrevented = event.defaultPrevented; }, 0);
    };
    window.addEventListener('scroll', recordScroll, true);
    window.addEventListener('touchmove', recordMove, true);
    window.__scheduleTouchScrollProbe = {
      initial,
      samples,
      moves,
      snapshot,
      stop() {
        window.removeEventListener('scroll', recordScroll, true);
        window.removeEventListener('touchmove', recordMove, true);
        return { initial, samples, moves };
      },
    };
    return initial;
  });
}

async function expectScrollStationary(page, initial) {
  // Check multiple painted frames plus every scroll event, including the first
  // native move where a passive React handler used to let scrolling begin.
  const samples = await page.evaluate(async () => {
    const probe = window.__scheduleTouchScrollProbe;
    for (let frame = 0; frame < 4; frame += 1) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      probe.samples.push(probe.snapshot());
    }
    return probe.samples;
  });
  for (const sample of samples) expect(sample).toEqual(initial);
}

async function readPlanTime(page) {
  return page.evaluate(() => {
    const events = JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]');
    const plan = events.find(event => event.provenance?.legacy?.id === 'touch-drag-plan');
    return plan ? `${plan.startTime}-${plan.endTime}` : null;
  });
}

const gestures = [
  { exit: 'drop', preHoldMove: 0 },
  { exit: 'cancel', preHoldMove: 0 },
  { exit: 'stationary release', preHoldMove: 0 },
  // Below the 9px hold tolerance: finger jitter must not hand this sequence to
  // native scrolling before the long press can claim it.
  { exit: 'cancel', preHoldMove: 8 },
];

for (const surface of scrollSurfaces) {
  for (const { exit, preHoldMove } of gestures) {
    const hold = preHoldMove ? `long press after ${preHoldMove}px finger jitter` : 'long press';
    test(`${surface.name} native scroll stays fixed from ${hold} through ${exit}, then swipes recover`, async ({ browser }, testInfo) => {
      const context = await newFixedClockContext(browser, {
        viewport: surface.viewport,
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      const evidence = { surface: surface.name, viewport: surface.viewport, exit, preHoldMove };
      try {
        await seedUser(page);
        await openSchedule(page, surface.tabName);
        const session = await enableTouch(page);
        const plan = page.locator(surface.planSelector).filter({ hasText: '長押し移動確認' });
        const scroll = page.locator(surface.scrollSelector);
        const initialTime = '09:00-10:00';
        await expect(plan).toBeVisible();
        await expect.poll(() => readPlanTime(page)).toBe(initialTime);

        evidence.beforeDragSwipe = await nativeSwipeUp(page, session,
          await positionPlanForGesture(plan, surface.scrollSelector), scroll);
        expect(await readPlanTime(page)).toBe(initialTime);

        const { x, y } = await positionPlanForGesture(plan, surface.scrollSelector);
        const initial = await startScrollProbe(page);
        await dispatchTouch(session, 'touchStart', x, y);
        if (preHoldMove) {
          await dispatchTouch(session, 'touchMove', x, y - preHoldMove);
        }
        await expect(page.getByRole('button', { name: '長押し移動確認を削除' })).toBeVisible();
        await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
        await expectScrollStationary(page, initial);

        if (exit !== 'stationary release') {
          await dispatchTouch(session, 'touchMove', x, y - 40);
          await expect(page.locator('.schedule-item-delete-action')).toHaveCount(0);
          await expect(page.locator('.schedule-week-drag-overlay')).toBeVisible();
          await expectScrollStationary(page, initial);
          await dispatchTouch(session, 'touchMove', x, y - 76);
          await expectScrollStationary(page, initial);
        }

        await dispatchTouch(session, exit === 'cancel' ? 'touchCancel' : 'touchEnd',
          x, exit === 'stationary release' ? y : y - 76);
        await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
        await expectScrollStationary(page, initial);
        evidence.drag = await page.evaluate(() => window.__scheduleTouchScrollProbe.stop());
        if (exit !== 'stationary release') {
          expect(evidence.drag.moves.length).toBeGreaterThan(0);
          expect(evidence.drag.moves.every(move => move.trusted)).toBe(true);
        }
        if (exit === 'drop') {
          await expect.poll(async () => {
            const saved = await readPlanTime(page);
            return saved !== null && saved !== initialTime;
          }).toBe(true);
          const [start, end] = (await readPlanTime(page)).split('-').map(time => {
            const [hours, minutes] = time.split(':').map(Number);
            return hours * 60 + minutes;
          });
          expect(end - start, 'drop preserves the plan duration').toBe(60);
        } else {
          expect(await readPlanTime(page)).toBe(initialTime);
        }

        evidence.afterDragSwipe = await nativeSwipeUp(page, session,
          await positionPlanForGesture(plan, surface.scrollSelector), scroll);
      } finally {
        if (!page.isClosed()) {
          evidence.drag ??= await page.evaluate(() => window.__scheduleTouchScrollProbe?.stop());
        }
        await testInfo.attach('native-touch-scroll-evidence', {
          body: JSON.stringify(evidence, null, 2),
          contentType: 'application/json',
        });
        await context.close();
      }
    });
  }
}

test('AI preview stationary long press waits for action while movement starts drag', async ({ browser }) => {
  const context = await newFixedClockContext(browser, {
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
    .toBe(true);

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
