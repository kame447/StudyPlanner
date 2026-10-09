import { expect, test } from './support/fixed-clock.mjs';

const initialPath = '/?preserved=a%20b&preserved=c+d&startupTransport=forced&startupProfile=off&startupMarker=off#kept';
const startLabel = '起動を計測して再読み込み';
const stopLabel = '計測を終了して再読み込み';

async function openSupport(page) {
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  const settings = page.getByRole('main', { name: 'アプリ設定' });
  await expect(settings).toBeVisible();
  await settings.getByRole('tab', { name: 'サポート', exact: true }).click();
  return settings;
}

async function boot(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.addInitScript(() => {
    if (localStorage.getItem('startup-diagnostics-seeded')) return;
    const user = { id: 'startup-diagnostics-owner', email: 'diagnostics@example.test', username: '起動診断', avatar: '', createdAt: '2026-08-19T01:00:00.000Z' };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', '[]');
    localStorage.setItem('startup-diagnostics-seeded', 'true');
    sessionStorage.setItem('startup-diagnostics-context', 'same-existing-context');
  });
  await page.goto(initialPath);
  await expect(page.locator('.home-main')).toBeVisible();
}

const retainedState = page => page.evaluate(() => ({
  owner: localStorage.getItem('studyplanner.session'),
  users: localStorage.getItem('studyplanner.users'),
  plans: localStorage.getItem('studyplanner.plans'),
  context: sessionStorage.getItem('startup-diagnostics-context'),
}));

for (const width of [320, 390, 1280]) {
  test(`starts and stops local diagnostics in the same app context at ${width}px`, async ({ page }, testInfo) => {
    await boot(page, width);
    const before = await retainedState(page);
    const originalUrl = page.url();
    const settings = await openSupport(page);
    const button = settings.getByRole('button', { name: startLabel, exact: true });
    await expect(button).toBeVisible();
    expect(await settings.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await testInfo.attach(`startup-diagnostics-support-${width}`, { body: await settings.screenshot(), contentType: 'image/png' });
    await button.click();
    await expect(page).toHaveURL(originalUrl.replace('#kept', '&startupTiming=1#kept'));
    await expect(page.locator('.home-main')).toBeVisible();
    const panel = page.locator('details[aria-label="起動時間の診断"]');
    await panel.locator('summary').click();
    await expect(panel.locator('pre')).toContainText('home-visible');
    await expect(panel).toContainText('外部送信・保存はしません');
    expect(await retainedState(page)).toEqual(before);
    await testInfo.attach(`startup-diagnostics-panel-${width}`, { body: await panel.screenshot(), contentType: 'image/png' });
    await panel.getByRole('button', { name: stopLabel, exact: true }).click();
    await expect(page).toHaveURL(originalUrl);
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(panel).toHaveCount(0);
    expect(await retainedState(page)).toEqual(before);
  });
}

test('cancelling an ordinary leave-page confirmation keeps the diagnostic control usable', async ({ page }) => {
  await boot(page, 390);
  const settings = await openSupport(page);
  await page.evaluate(() => {
    window.__diagnosticLeaveGuard = event => { event.preventDefault(); event.returnValue = ''; };
    addEventListener('beforeunload', window.__diagnosticLeaveGuard);
  });
  const button = settings.getByRole('button', { name: startLabel, exact: true });
  const originalUrl = page.url();
  const dialog = page.waitForEvent('dialog');
  const click = button.click();
  await (await dialog).dismiss();
  await click;
  await expect(page).toHaveURL(originalUrl);
  await expect(button).toBeEnabled();
  await expect(button).toHaveText(startLabel);
  await page.evaluate(() => removeEventListener('beforeunload', window.__diagnosticLeaveGuard));
  await button.click();
  await expect(page).toHaveURL(originalUrl.replace('#kept', '&startupTiming=1#kept'));
  await expect(page.locator('.home-main')).toBeVisible();
});
