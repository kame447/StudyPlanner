import { expect, test } from '@playwright/test';

const HARNESS_URL = 'http://127.0.0.1:4174/week-plan-drag.html';

async function readEvents(page) {
  return page.evaluate(() => window.__weekPlanDragEvents ?? []);
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

async function planCenter(page, name) {
  const plan = page.getByRole('button', { name });
  await expect(plan).toBeVisible();
  const box = await plan.boundingBox();
  if (!box) throw new Error(`Plan card not measurable: ${name}`);
  return {
    plan,
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

test('saved plan click opens the editor without moving the plan', async ({ page }) => {
  await page.goto(HARNESS_URL);

  const { plan } = await planCenter(page, /数学の復習.*タップで編集/);
  await plan.click();

  const events = await readEvents(page);
  expect(events.filter((entry) => entry.type === 'open-plan')).toHaveLength(1);
  expect(events.filter((entry) => entry.type === 'move-plan')).toHaveLength(0);
});

test('mouse drag changes weekday and time while preserving duration', async ({ page }) => {
  await page.goto(HARNESS_URL);

  const { x, y } = await planCenter(page, /数学の復習.*タップで編集/);
  const dayColumn = page.locator('.schedule-week-day-column').nth(1);
  const dayBox = await dayColumn.boundingBox();
  if (!dayBox) throw new Error('Week day column not measurable');

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dayBox.width + 8, y + 70, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await readEvents(page)).filter((entry) => entry.type === 'move-plan').length)
    .toBe(1);

  const moveEvent = (await readEvents(page)).find((entry) => entry.type === 'move-plan');
  expect(moveEvent.payload.id).toBe('drag-plan-once');
  expect(moveEvent.payload.target.date).toBe('2026-08-25');
  expect(moveEvent.payload.target.startTime).not.toBe('13:00');

  const [startHour, startMinute] = moveEvent.payload.target.startTime.split(':').map(Number);
  const [endHour, endMinute] = moveEvent.payload.target.endTime.split(':').map(Number);
  expect(endHour * 60 + endMinute - (startHour * 60 + startMinute)).toBe(60);
  expect((startHour * 60 + startMinute) % 5).toBe(0);

  const events = await readEvents(page);
  expect(events.filter((entry) => entry.type === 'open-plan')).toHaveLength(0);
});

test('short touch remains a tap and opens the plan', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 780 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(HARNESS_URL);

  const { x, y } = await planCenter(page, /数学の復習.*タップで編集/);
  await page.touchscreen.tap(x, y);

  await expect.poll(async () => (await readEvents(page)).filter((entry) => entry.type === 'open-plan').length)
    .toBe(1);
  expect((await readEvents(page)).filter((entry) => entry.type === 'move-plan')).toHaveLength(0);

  await context.close();
});

test('touch movement before long press cancels drag activation', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 780 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(HARNESS_URL);
  const session = await enableTouch(page);

  const { x, y } = await planCenter(page, /数学の復習.*タップで編集/);
  await dispatchTouch(session, 'touchStart', x, y);
  await dispatchTouch(session, 'touchMove', x - 40, y);
  await page.waitForTimeout(300);

  await expect(page.locator('.schedule-week-drag-overlay')).toHaveCount(0);
  expect((await readEvents(page)).filter((entry) => entry.type === 'move-plan')).toHaveLength(0);

  await dispatchTouch(session, 'touchEnd', x - 40, y);
  await context.close();
});

test('long press activates touch drag and drop without opening the editor', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 780 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(HARNESS_URL);
  const session = await enableTouch(page);

  const { x, y } = await planCenter(page, /数学の復習.*タップで編集/);
  const dayBox = await page.locator('.schedule-week-day-column').nth(1).boundingBox();
  if (!dayBox) throw new Error('Week day column not measurable');

  await dispatchTouch(session, 'touchStart', x, y);
  await page.waitForTimeout(300);
  await expect(page.locator('.schedule-week-drag-overlay')).toBeVisible();

  await dispatchTouch(session, 'touchMove', x + dayBox.width + 6, y + 55);
  await page.waitForTimeout(30);
  await dispatchTouch(session, 'touchEnd', x + dayBox.width + 6, y + 55);

  await expect.poll(async () => (await readEvents(page)).filter((entry) => entry.type === 'move-plan').length)
    .toBe(1);
  const events = await readEvents(page);
  expect(events.filter((entry) => entry.type === 'open-plan')).toHaveLength(0);

  await context.close();
});

test('recurring plan drag keeps its weekday locked', async ({ page }) => {
  await page.goto(HARNESS_URL);

  const { x, y } = await planCenter(page, /英単語.*タップで編集/);
  const dayBox = await page.locator('.schedule-week-day-column').nth(2).boundingBox();
  if (!dayBox) throw new Error('Week day column not measurable');

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dayBox.width + 10, y + 35, { steps: 6 });
  await page.mouse.up();

  await expect.poll(async () => (await readEvents(page)).filter((entry) => entry.type === 'move-plan').length)
    .toBe(1);
  const moveEvent = (await readEvents(page)).find((entry) => entry.type === 'move-plan');
  expect(moveEvent.payload.id).toBe('drag-plan-recurring');
  expect(moveEvent.payload.target.date).toBe('2026-08-25');
  expect(moveEvent.payload.target.startTime).not.toBe('16:00');
});
