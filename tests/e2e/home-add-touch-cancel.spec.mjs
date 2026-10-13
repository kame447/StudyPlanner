import { expect, test } from './support/fixed-clock.mjs';
import { seedHomeAdd, collectHomeAddActionEvents } from './support/home-add-fixture.mjs';

// CDP gesture cancellation is Chromium-only. The separate home-add-touch spec
// runs native touchscreen taps in mobile WebKit without this protocol dependency.
test.use({ hasTouch: true });

test('dragging and cancelling a native Home add touch does not open a form', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedHomeAdd(page);
  await page.goto('/');
  await page.getByRole('button', { name: '今日の予定に追加', exact: true }).tap();
  const studyAction = page.getByRole('button', { name: '学習予定を追加', exact: true });
  await expect(studyAction).toBeVisible();
  await collectHomeAddActionEvents(page);
  const box = await studyAction.boundingBox();
  if (!box) throw new Error('The Home study action must have a touch target');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: x - 70, y: y - 70, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const events = await page.evaluate(() => window.homeAddTouchEvents);
  await testInfo.attach('home-add-cancelled-native-touch-events', {
    contentType: 'application/json', body: JSON.stringify(events),
  });
  expect(events.some(event => event.type === 'pointerdown' && event.pointerType === 'touch' && event.trusted)).toBe(true);
  expect(events.some(event => event.type === 'pointercancel' && event.trusted)).toBe(true);
  expect(events.some(event => event.type === 'click')).toBe(false);
  // The next intentional tap still works; no retained pointer flag blocks it.
  await studyAction.tap();
  await expect(page.getByRole('dialog', { name: '予定・記録の追加' })).toBeVisible();
  await session.detach();
});
