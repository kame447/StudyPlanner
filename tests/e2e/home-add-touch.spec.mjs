import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';
import { seedHomeAdd, collectHomeAddActionEvents } from './support/home-add-fixture.mjs';

// Use the browser's touch input API in both broad Chromium and mobile WebKit.
// A viewport resize with locator.click() does not exercise Safari tap/focus order.
test.use({ hasTouch: true });

for (const width of [390, 1280]) {
  test(`native touch opens and saves Home study after another action has focus at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await seedHomeAdd(page);
    await page.goto('/');
    const row = page.getByRole('group', { name: '今日の予定の追加', exact: true });
    const add = page.getByRole('button', { name: '今日の予定に追加', exact: true });
    await add.tap();
    await expect(row.getByRole('button', { name: '予定を追加', exact: true })).toBeFocused();
    await collectHomeAddActionEvents(page);
    await row.getByRole('button', { name: '学習予定を追加', exact: true }).tap();
    const study = page.getByRole('dialog', { name: '予定・記録の追加' });
    // Capture the event order even when the modal failed to open on the baseline.
    await testInfo.attach('home-study-native-touch-events', {
      contentType: 'application/json', body: JSON.stringify(await page.evaluate(() => window.homeAddTouchEvents)),
    });
    await expect(study).toBeVisible();
    await expect(study.getByLabel('日付', { exact: true })).toHaveValue(E2E_TODAY);
    const events = await page.evaluate(() => window.homeAddTouchEvents);
    expect(events.some(event => event.type === 'pointerdown' && event.pointerType === 'touch' && event.trusted)).toBe(true);
    expect(events.some(event => event.type === 'click' && event.target.includes('学習予定を追加') && event.trusted)).toBe(true);
    await study.getByPlaceholder('例: 英語課題 / 面接準備').fill('タッチで追加した学習');
    await study.getByRole('button', { name: '30分', exact: true }).tap();
    await study.getByRole('button', { name: '保存', exact: true }).tap();
    await expect(study).toHaveCount(0);
    await expect(page.locator('.home-schedule-list')).toContainText('タッチで追加した学習');
    await page.reload();
    await expect(page.locator('.home-schedule-list')).toContainText('タッチで追加した学習');

    // The sibling event form still opens, and closing/reopening does not retain a
    // stale study request. No synthetic click or production account is involved.
    await add.tap();
    await row.getByRole('button', { name: '予定を追加', exact: true }).tap();
    const event = page.locator('.month-event-modal');
    await expect(event).toBeVisible();
    await event.getByRole('button', { name: '閉じる', exact: true }).tap();
    await expect(event).toHaveCount(0);
    await add.tap();
    await row.getByRole('button', { name: '学習予定を追加', exact: true }).tap();
    await expect(study).toBeVisible();
    await expect(study.getByPlaceholder('例: 英語課題 / 面接準備')).toHaveValue('');
    await study.getByRole('button', { name: '閉じる', exact: true }).tap();
    await expect(study).toHaveCount(0);
    await expect(add).toBeVisible();
  });
}

test('Home add still closes when Tab or ShiftTab moves focus outside', async ({ page }) => {
  await seedHomeAdd(page);
  await page.goto('/');
  const add = page.getByRole('button', { name: '今日の予定に追加', exact: true });
  const row = page.getByRole('group', { name: '今日の予定の追加', exact: true });
  await expect(add).toBeVisible();
  // Deterministic surrounding focus targets keep this test independent of other
  // Home cards' tab order; navigation still uses the browser's actual keyboard.
  await row.evaluate(element => {
    for (const side of ['before', 'after']) {
      const button = document.createElement('button');
      button.textContent = `追加メニューの${side}`;
      button.id = `home-add-focus-${side}`;
      button.tabIndex = 0;
      element[side](button);
    }
  });
  await add.tap();
  await expect(row.getByRole('button', { name: '予定を追加', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#home-add-focus-before')).toBeFocused();
  await expect(add).toHaveAttribute('aria-expanded', 'false');
  await add.tap();
  await row.getByRole('button', { name: '学習予定を追加', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#home-add-focus-after')).toBeFocused();
  await expect(add).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
