import { E2E_TODAY, expect, test as fixedClockTest } from './support/fixed-clock.mjs';

// A cold WebKit page can take most of a test's budget before application code
// runs. Keep page creation separate; the behavior test still has its normal
// 30-second budget and unchanged action/assertion timeouts.
const test = fixedClockTest.extend({
  settingsPage: [async ({ context }, use) => {
    await use(await context.newPage());
  }, { timeout: 30_000 }],
});

async function seed(page) {
  await page.addInitScript(({ today }) => {
    if (localStorage.getItem('settings-page-seeded')) return;
    const now = new Date().toISOString();
    const user = { id: 'settings-page-user', email: 'settings@example.test', username: '設定テスト', avatar: '', createdAt: now };
    const plan = { id: 'settings-plan', seriesId: 'settings-plan', userId: user.id, title: '設定後も残る予定',
      subject: '数学', type: 'study', sourceType: 'manual', date: today, startTime: '14:00', endTime: '15:00',
      memo: '', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], createdAt: now, updatedAt: now };
    localStorage.setItem('studyplanner.users', JSON.stringify([user]));
    localStorage.setItem('studyplanner.session', user.id);
    localStorage.setItem('studyplanner.plans', JSON.stringify([plan]));
    for (const key of ['studyplanner.actuals', 'studyplanner.todos.v1', 'studyplanner.studySubjects.v1', 'studyplanner.studyMaterials.v1']) {
      localStorage.setItem(key, '[]');
    }
    localStorage.setItem('settings-page-seeded', 'true');
  }, { today: E2E_TODAY });
}

async function assertReadable(page) {
  const values = await page.locator('.app-settings-page').evaluate(element => {
    const style = getComputedStyle(element);
    const label = element.querySelector('.settings-field-label');
    const card = element.querySelector('.settings-group-card');
    const labelStyle = getComputedStyle(label);
    const cardStyle = getComputedStyle(card);
    const panel = element.querySelector('.app-settings-content');
    const box = element.getBoundingClientRect();
    // Root clientWidth has viewport-special behavior: it can include a reserved
    // scrollbar gutter even when fixed-position layout excludes that gutter.
    // Measure the containing block independently, without a guessed allowance.
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;inset:0;width:auto;height:auto;margin:0;padding:0;border:0;visibility:hidden;pointer-events:none';
    document.body.append(probe);
    let viewportWidth;
    try {
      viewportWidth = probe.getBoundingClientRect().width;
    } finally {
      probe.remove();
    }
    return { width: box.width, height: box.height, x: box.x, y: box.y,
      viewportWidth, viewportHeight: innerHeight,
      overflow: element.scrollWidth > element.clientWidth || panel.scrollWidth > panel.clientWidth,
      background: style.backgroundColor, text: labelStyle.color, card: cardStyle.backgroundColor,
      fontSize: parseFloat(labelStyle.fontSize) };
  });
  expect(values.x).toBe(0); expect(values.y).toBe(0);
  // Fill the independently measured fixed-position containing block. WebKit
  // can resolve 100dvh to a fractional CSS pixel, even for an integer viewport.
  expect(values.viewportWidth).toBeGreaterThan(0);
  expect(Math.abs(values.width - values.viewportWidth)).toBeLessThanOrEqual(.5);
  expect(Math.abs(values.height - values.viewportHeight)).toBeLessThanOrEqual(.5);
  expect(values.overflow).toBe(false);
  expect(values.background).toMatch(/^rgb\(/); expect(values.card).toMatch(/^rgb\(/);
  expect(values.fontSize).toBeGreaterThanOrEqual(16);
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
    const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const [lighter, darker] = [luminance(values.text), luminance(values.card)].sort((a, b) => b - a);
  expect((lighter + .05) / (darker + .05)).toBeGreaterThanOrEqual(4.5);
}

for (const width of [1280, 390, 320]) {
  test(`settings is a readable independent screen with coherent return at ${width}px`, async ({ settingsPage: page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 }); await seed(page); await page.goto('/');
    await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: '予定', exact: true }).click();
    const schedule = page.getByRole('grid', { name: '月間カレンダー' });
    await expect(schedule).toBeVisible();
    const selectedDay = page.locator('.month-cell[aria-selected="true"]');
    await expect(selectedDay).toHaveCount(1);
    // Study plans contribute a duration, not an event-title pill, in the month grid.
    await expect(selectedDay).toContainText('目標 1h');
    const savedPlans = await page.evaluate(() => localStorage.getItem('studyplanner.plans'));
    const selectedDayText = await selectedDay.textContent();
    const menu = page.getByRole('button', { name: 'メニューを開く', exact: true });
    await page.evaluate(() => {
      const notice = document.createElement('div');
      notice.id = 'independent-settings-notice';
      notice.setAttribute('role', 'status');
      notice.textContent = '独立した通知';
      document.body.append(notice);
    });
    await menu.click();
    await expect(page.locator('#independent-settings-notice')).toBeVisible();
    await page.locator('#independent-settings-notice').evaluate(element => element.remove());
    const settings = page.getByRole('main', { name: 'アプリ設定' });
    await expect(settings).toBeVisible(); await expect(schedule).toBeHidden();
    await expect(page.getByRole('navigation', { name: '主要ナビゲーション' })).toHaveCount(0);
    await expect(settings.getByRole('heading', { name: 'アプリ設定' })).toBeFocused();
    await expect(page.locator('input:focus, textarea:focus, select:focus')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(selectedDay).toHaveText(selectedDayText);
    for (const theme of ['dark', 'light']) {
      await settings.getByRole('button', { name: theme === 'dark' ? 'ダーク' : 'ライト', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await assertReadable(page);
      await settings.getByRole('heading', { name: '表示とデザイン' }).scrollIntoViewIfNeeded();
      await testInfo.attach(`settings-${theme}-${width}`, { body: await settings.screenshot(), contentType: 'image/png' });
    }
    const panel = settings.getByRole('tabpanel');
    await settings.getByRole('button', { name: '学習設定を初期化', exact: true }).scrollIntoViewIfNeeded();
    expect(await panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(settings.getByRole('button', { name: '戻る', exact: true })).toBeVisible();
    await settings.getByRole('tab', { name: '設定', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(settings.getByRole('tab', { name: 'AIの記憶', exact: true })).toBeFocused();
    await expect(panel).toHaveAttribute('aria-labelledby', 'app-settings-tab-memory');
    await page.keyboard.press('End');
    await expect(settings.getByRole('tab', { name: 'サポート', exact: true })).toBeFocused();
    await expect(page.locator('input:focus, textarea:focus, select:focus')).toHaveCount(0);
    await expect(settings.getByRole('link', { name: 'お問い合わせ' })).toHaveAttribute('href', '/contact');
    await page.goBack(); await expect(settings).toHaveCount(0); await expect(schedule).toBeVisible();
    await expect(menu).toBeFocused(); await expect(selectedDay).toHaveText(selectedDayText);
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.plans'))).toBe(savedPlans);
    await page.goForward(); await expect(settings).toBeVisible(); await expect(schedule).toBeHidden();
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(settings).toHaveCount(0); await expect(schedule).toBeVisible();
    for (let i = 0; i < 2; i++) {
      await menu.click(); await expect(settings).toBeVisible();
      await settings.getByRole('button', { name: '戻る', exact: true }).click(); await expect(schedule).toBeVisible();
    }
    // Hidden planner keyboard handlers must not consume keys intended for settings.
    const quickAdd = page.locator('.quick-add-trigger');
    await quickAdd.click(); await expect(quickAdd).toHaveAttribute('aria-expanded', 'true');
    await page.goForward(); await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(quickAdd).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menuitem', { name: 'AI計画', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(quickAdd).toHaveAttribute('aria-expanded', 'false');
    // Browser Forward can reopen settings while an existing body-portal dialog is open.
    await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'ホーム', exact: true }).click();
    await expect(page.locator('.home-today-panel')).toContainText('設定後も残る予定');
    await page.getByRole('button', { name: '今日の予定に追加', exact: true }).click();
    const addDialog = page.getByRole('dialog', { name: '今日の予定に追加', exact: true });
    await expect(addDialog).toBeVisible();
    await page.goForward(); await expect(settings).toBeVisible(); await expect(addDialog).toBeHidden();
    await settings.getByRole('tab', { name: '設定', exact: true }).focus(); await page.keyboard.press('Tab');
    await expect(panel).toBeFocused();
    await page.keyboard.press('Escape');
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(addDialog).toBeVisible();
    await addDialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await menu.click(); await page.reload();
    await expect(page.getByRole('main', { name: 'アプリ設定' })).toBeVisible();
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.getByRole('main', { name: 'アプリ設定' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: '主要ナビゲーション' })).toBeVisible();
    await expect(page.locator('.home-today-panel')).toContainText('設定後も残る予定');
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.plans'))).toBe(savedPlans);
  });
}
