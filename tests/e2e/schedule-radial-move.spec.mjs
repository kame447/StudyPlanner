import { E2E_TODAY, expect, newFixedClockContext, test } from './support/fixed-clock.mjs';

// Radial 移動 lifts the event into a direct drag mode, long-press timing is
// quick (~170ms); the held finger selects before release. Edit/Complete enter
// like the 記録を保存 sheet / save feedback.

const TITLE = '移動確認';

async function seedSchedule(page) {
  await page.addInitScript(({ today, title }) => {
    if (sessionStorage.getItem('radial-move-seeded')) return;
    sessionStorage.setItem('radial-move-seeded', '1');
    const now = new Date().toISOString();
    const user = { id: 'radial-move-user', email: 'radial-move@example.com', username: 'radial-move', avatar: '', createdAt: now };
    const plan = {
      id: 'move-plan', seriesId: 'move-plan', userId: user.id, title, subject: '数学', type: 'study',
      date: today, startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null,
      excludedDates: [], recurrenceRules: [], memo: '', sourceType: 'manual', createdAt: now, updatedAt: now,
    };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    for (const key of ['actuals', 'todos.v1', 'studySubjects.v1', 'studyMaterials.v1']) {
      localStorage.setItem(`studyplanner.${key}`, '[]');
    }
  }, { today: E2E_TODAY, title: TITLE });
}

async function dispatchTouch(session, type, x, y) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
}

async function openSchedule(browser, { mobile, tab }) {
  const context = await newFixedClockContext(browser, mobile
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
    : { viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await seedSchedule(page);
  await page.goto('/');
  await page.locator('.primary-bottom-nav button').filter({ hasText: '予定' }).click();
  await expect(page.locator('.schedule-workspace-shell')).toBeVisible();
  const tabButton = page.getByRole('tab', { name: tab, exact: true });
  if ((await tabButton.getAttribute('aria-selected')) !== 'true') await tabButton.click();
  let session = null;
  if (mobile) {
    session = await context.newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  }
  return { context, page, session };
}

async function dayHourPx(page) {
  const canvas = await page.locator('.timeline-canvas.split').first().boundingBox();
  return canvas.height / 24;
}

function planBlock(page) {
  return page.locator(`[data-schedule-occurrence-id]`).filter({ hasText: TITLE }).first();
}

async function center(locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error('plan not measurable');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function storedPlan(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]')
    .find(event => event.provenance?.legacy?.id === 'move-plan'));
}

async function touchHold(page, session, ms) {
  const { x, y } = await center(planBlock(page));
  await dispatchTouch(session, 'touchStart', x, y);
  await page.waitForTimeout(ms);
  await dispatchTouch(session, 'touchEnd', x, y);
}

async function beginHeldMenu(page, session) {
  const origin = await center(planBlock(page));
  await dispatchTouch(session, 'touchStart', origin.x, origin.y);
  await page.waitForTimeout(220);
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  return origin;
}

async function flickAction(page, session, label) {
  const before = await storedPlan(page);
  await beginHeldMenu(page, session);
  const action = page.getByRole('menuitem', { name: label, exact: true });
  const point = await center(action);
  // The same CDP touch id stays down from the card through the chosen sector.
  await dispatchTouch(session, 'touchMove', point.x, point.y);
  await expect(action).toHaveAttribute('data-gesture-selected', 'true');
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  expect(await storedPlan(page), 'hovering a sector must not save').toEqual(before);
  await dispatchTouch(session, 'touchEnd', point.x, point.y);
  await expect(page.getByRole('menu')).toHaveCount(0);
}

test('day touch: quick tap stays a tap, a ~220ms stationary hold shows six actions before release and centre release cancels', async ({ browser }) => {
  const { context, page, session } = await openSchedule(browser, { mobile: true, tab: '日' });

  await touchHold(page, session, 60);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: `${TITLE}の操作` })).toBeVisible();
  await page.getByRole('dialog', { name: `${TITLE}の操作` }).getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByRole('dialog', { name: `${TITLE}の操作` })).toHaveCount(0);

  // Above the 170ms threshold but below the old 240ms one.
  const before = await storedPlan(page);
  const origin = await beginHeldMenu(page, session);
  await expect(page.getByRole('menuitem')).toHaveText(['完了', '編集', '複製', '削除', '実績', '移動']);
  // The full ring is shown quickly: last button's delay + pop stays ≤ ~220ms.
  const timing = await page.getByRole('menuitem').evaluateAll(items => items.map(item => {
    const style = getComputedStyle(item);
    return parseFloat(style.animationDelay) * 1000 + parseFloat(style.animationDuration) * 1000;
  }));
  expect(Math.max(...timing)).toBeLessThanOrEqual(220);
  await dispatchTouch(session, 'touchEnd', origin.x, origin.y);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await storedPlan(page)).toEqual(before);
  await context.close();
});

test('day touch: movement selects the held ring without dragging, then returning to centre cancels', async ({ browser }) => {
  const { context, page, session } = await openSchedule(browser, { mobile: true, tab: '日' });
  const before = await storedPlan(page);
  const origin = await beginHeldMenu(page, session);
  const action = page.getByRole('menuitem', { name: '移動', exact: true });
  const point = await center(action);
  await dispatchTouch(session, 'touchMove', point.x, point.y);
  await expect(action).toHaveAttribute('data-gesture-selected', 'true');
  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '予定の移動' })).toHaveCount(0);
  await dispatchTouch(session, 'touchMove', origin.x, origin.y);
  await expect(page.locator('[data-gesture-selected="true"]')).toHaveCount(0);
  await dispatchTouch(session, 'touchEnd', origin.x, origin.y);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '予定の移動' })).toHaveCount(0);
  expect(await storedPlan(page)).toEqual(before);
  await context.close();
});

test('day touch: radial 移動 lifts the event so the next touch drags it immediately, persisted and undoable', async ({ browser }) => {
  const { context, page, session } = await openSchedule(browser, { mobile: true, tab: '日' });
  await flickAction(page, session, '移動');

  // No date/time dialog: the event is lifted and a hint offers the dialog as a fallback.
  await expect(page.getByRole('dialog', { name: `${TITLE}を移動` })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '予定の移動' })).toContainText(`「${TITLE}」をドラッグして移動先へ`);
  await expect(planBlock(page)).toHaveClass(/is-move-armed/);
  await expect(page.locator('.schedule-radial-menu')).toHaveCount(0);

  // No hold needed: movement right after touchstart drags.
  const { x, y } = await center(planBlock(page));
  const hourPx = await dayHourPx(page);
  await dispatchTouch(session, 'touchStart', x, y);
  await dispatchTouch(session, 'touchMove', x, y + 20);
  await dispatchTouch(session, 'touchMove', x, y + hourPx * 2);
  await expect(page.locator('.schedule-week-drag-overlay')).toBeVisible();
  await dispatchTouch(session, 'touchEnd', x, y + hourPx * 2);

  await expect.poll(async () => (await storedPlan(page))?.startTime).toBe('11:00');
  expect((await storedPlan(page)).endTime).toBe('12:00');
  await expect(page.getByRole('region', { name: '予定の移動' })).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);

  await page.getByRole('button', { name: '変更を元に戻す' }).first().click();
  await expect.poll(async () => (await storedPlan(page))?.startTime).toBe('09:00');

  await page.reload();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  expect((await storedPlan(page)).startTime).toBe('09:00');
  await context.close();
});

test('day: 日時で指定 keeps the dialog as an explicit fallback and 終了 leaves move mode', async ({ browser }) => {
  const { context, page, session } = await openSchedule(browser, { mobile: true, tab: '日' });
  await flickAction(page, session, '移動');
  await page.getByRole('button', { name: '終了' }).click();
  await expect(page.getByRole('region', { name: '予定の移動' })).toHaveCount(0);
  await expect(planBlock(page)).not.toHaveClass(/is-move-armed/);

  await flickAction(page, session, '移動');
  await page.getByRole('button', { name: '日時で指定' }).click();
  await expect(page.getByRole('dialog', { name: `${TITLE}を移動` })).toBeVisible();
  await expect(page.getByRole('region', { name: '予定の移動' })).toHaveCount(0);
  await context.close();
});

test('week pointer: radial 移動 then mouse drag moves the plan and persists', async ({ browser }) => {
  const { context, page } = await openSchedule(browser, { mobile: false, tab: '週' });
  await planBlock(page).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移動', exact: true }).click();
  await expect(planBlock(page)).toHaveClass(/is-move-armed/);
  const before = await center(planBlock(page));
  const column = await page.locator('.schedule-week-day-column').first().boundingBox();
  const hourPx = column.height / 24;
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x, before.y + hourPx / 2, { steps: 4 });
  await page.mouse.move(before.x, before.y + hourPx * 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await storedPlan(page))?.startTime).toBe('11:00');
  await expect(page.getByRole('region', { name: '予定の移動' })).toHaveCount(0);
  await context.close();
});

test('week touch: radial 移動 lifts the event so the next touch drags it immediately', async ({ browser }) => {
  const { context, page, session } = await openSchedule(browser, { mobile: true, tab: '週' });
  await flickAction(page, session, '移動');
  await expect(planBlock(page)).toHaveClass(/is-move-armed/);
  const { x, y } = await center(planBlock(page));
  const column = await page.locator('.schedule-week-day-column').first().boundingBox();
  const hourPx = column.height / 24;
  await dispatchTouch(session, 'touchStart', x, y);
  await dispatchTouch(session, 'touchMove', x, y + 20);
  await dispatchTouch(session, 'touchMove', x, y + hourPx);
  await expect(page.locator('.schedule-week-drag-overlay')).toBeVisible();
  await dispatchTouch(session, 'touchEnd', x, y + hourPx);
  await expect.poll(async () => (await storedPlan(page))?.startTime).toBe('10:00');
  await context.close();
});

test('Edit and Complete enter like the 記録を保存 sheet and save feedback; completion still persists', async ({ browser }) => {
  const { context, page, session } = await openSchedule(browser, { mobile: true, tab: '日' });

  await flickAction(page, session, '実績');
  const saveSheet = page.locator('.schedule-record-sheet');
  await expect(saveSheet).toBeVisible();
  const saveAnimation = await saveSheet.evaluate(element => getComputedStyle(element).animationName);
  expect(saveAnimation).toBe('planner-bottom-sheet-in');
  await page.getByRole('button', { name: '閉じる' }).first().click();
  await expect(saveSheet).toHaveCount(0);

  await flickAction(page, session, '編集');
  const editor = page.locator('.plan-editor-modal');
  await expect(editor).toBeVisible();
  expect(await editor.evaluate(element => getComputedStyle(element).animationName)).toBe(saveAnimation);
  expect(await editor.evaluate(element => getComputedStyle(element.parentElement).animationName)).toBe('planner-sheet-overlay-in');
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(editor).toHaveCount(0);

  await flickAction(page, session, '完了');
  const toast = page.locator('.app-toast').filter({ hasText: '記録を保存しました。' });
  await expect(toast).toBeVisible();
  expect(await toast.evaluate(element => getComputedStyle(element).animationName)).toMatch(/^planner-toast/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]')
    .filter(actual => actual.planId === 'move-plan').length)).toBe(1);
  await context.close();
});
