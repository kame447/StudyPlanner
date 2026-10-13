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
  test(`ordinary support and query URLs keep developer diagnostics hidden at ${width}px`, async ({ page }, testInfo) => {
    await boot(page, width);
    const before = await retainedState(page);
    const originalUrl = page.url();
    let settings = await openSupport(page);
    await expect(settings.getByRole('button', { name: startLabel, exact: true })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: stopLabel, exact: true })).toHaveCount(0);
    await expect(settings.getByRole('link', { name: 'お問い合わせ', exact: true })).toBeVisible();
    expect(await settings.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await testInfo.attach(`ordinary-support-${width}`, { body: await settings.screenshot(), contentType: 'image/png' });
    await page.goto(originalUrl.replace('#kept', '&startupTiming=1#kept'));
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.getByLabel('起動時間の診断')).toHaveCount(0);
    settings = await openSupport(page);
    await expect(settings.getByRole('button', { name: startLabel, exact: true })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: stopLabel, exact: true })).toHaveCount(0);
    expect(await retainedState(page)).toEqual(before);
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.locator('.home-main')).toBeVisible();
    await page.reload();
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.getByLabel('起動時間の診断')).toHaveCount(0);
    expect(await retainedState(page)).toEqual(before);
  });
}
