import { expect, test } from './support/fixed-clock.mjs';

async function boot(page, width, { save = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/configureWeeklyPlanningTraceRepository.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function isWeeklyPlanningTraceFeatureEnabled() { return true; }' }));
  await page.route('**/useWeeklyPlanningTracePolicy.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function useWeeklyPlanningTracePolicy() {
      const control = window.__startupGateHarness;
      const status = control.React.useSyncExternalStore(control.subscribePolicy, () => control.policy);
      return { status, error: '', accept: async () => false, refresh: async () => {} };
    }
  ` }));
  await page.goto(`http://127.0.0.1:4174/startup-gates.html?startupTiming=1&${save ? 'preferenceSave' : 'preferenceWait'}=1`);
  await page.waitForFunction(save => Boolean(save ? window.__preferenceSaveHarness : window.__preferenceReadHarness), save);
  await page.evaluate(() => { window.__startupGateHarness.emitAuth(); window.__startupGateHarness.emitPolicy('accepted'); });
  await expect.poll(() => page.evaluate(save => save ? window.__preferenceSaveHarness.reads : window.__preferenceReadHarness.readCount, save)).toBeGreaterThan(0);
}
const recovery = page => page.getByRole('heading', { name: '学習設定を読み込めませんでした' });

for (const width of [320, 390, 1280]) {
  test(`stalled preferences recover with a fresh read and preserve planner readiness at ${width}px`, async ({ page }) => {
    await boot(page, width);
    const initialReads = await page.evaluate(() => window.__preferenceReadHarness.readCount);
    await page.clock.fastForward(15_000);
    await expect(recovery(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'この設定で始める' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: '週の始まり' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'ログアウトする' })).toBeEnabled();
    expect(await page.evaluate(() => window.__preferenceReadHarness.writes)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/preferences-recovery-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'もう一度読み込む' }).click();
    await expect(page.locator('.splash-screen:visible')).toHaveCount(1);
    await expect(recovery(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__preferenceReadHarness.readCount)).toBe(initialReads + 1);
    await page.evaluate(async initial => {
      for (let i = 0; i < initial; i += 1) await window.__preferenceReadHarness.resolve(i);
    }, initialReads);
    await expect(page.locator('.splash-screen:visible')).toHaveCount(1);
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    await page.evaluate(index => window.__preferenceReadHarness.resolve(index), initialReads);
    await expect.poll(() => page.evaluate(() => window.__plannerRecoveryRepository.snapshot().pendingReads)).toContain('getScheduleSnapshot');
    await expect(page.locator('.home-main:visible')).toHaveCount(0);
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    await expect(page.locator('.home-main')).toBeVisible();
    await expect(page.locator('.home-main')).toContainText('最新の予定');
    expect(await page.evaluate(() => window.__preferenceReadHarness.writes)).toBe(0);
  });
}

test('successful missing-profile retry preserves explicit initial settings selection', async ({ page }) => {
  await boot(page, 390);
  await page.clock.fastForward(15_000);
  await expect(recovery(page)).toBeVisible();
  await page.getByRole('button', { name: 'もう一度読み込む' }).click();
  await page.evaluate(() => window.__preferenceReadHarness.resolve(window.__preferenceReadHarness.readCount - 1, true));
  await expect(page.getByRole('heading', { name: '1週間の始まりを選択' })).toBeVisible();
  await page.getByRole('combobox', { name: '週の始まり' }).selectOption('sunday');
  await page.getByRole('button', { name: 'この設定で始める' }).click();
  await expect.poll(() => page.evaluate(() => window.__preferenceReadHarness.writes)).toBe(1);
  await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  await expect(page.locator('.home-main')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(`studyplanner-weekly-personalization-v1:${window.__startupGateHarness.ownerId}`)).weekStartsOn.value)).toBe('sunday');
});


for (const width of [390, 1280]) for (const outcome of ['success', 'failure']) {
  test(`confirmed preference save ${outcome} retains the pending AI draft and settings at ${width}px`, async ({ page }, info) => {
    await boot(page, width, { save: true });
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
    await expect(page.locator('.home-main')).toBeVisible();
    await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
    const composer = page.locator('.ai-planning-composer textarea');
    const draft = '送信前の学習相談\n設定保存後もこの入力を残す';
    await expect(composer).toBeVisible();
    await composer.fill(draft);
    const originalComposer = await composer.elementHandle();
    if (!originalComposer) throw new Error('Expected the real AI composer');
    const originalPlans = await page.evaluate(() => localStorage.getItem('studyplanner.plans'));
    await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
    const settings = page.getByRole('main', { name: 'アプリ設定', exact: true });
    await expect(settings).toBeVisible();
    const palette = settings.locator('button[aria-controls="settings-palette-options"]');
    await palette.click();
    await expect(palette).toHaveAttribute('aria-expanded', 'true');
    const originalSettings = await settings.elementHandle();
    if (!originalSettings) throw new Error('Expected the real settings screen');
    const week = settings.getByRole('group', { name: '週の始まり', exact: true });
    const monday = week.getByRole('button', { name: '月曜日', exact: true });
    const sunday = week.getByRole('button', { name: '日曜日', exact: true });
    const reset = settings.getByRole('button', { name: '学習設定を初期化', exact: true });
    const pending = settings.getByRole('status').filter({ hasText: '学習設定を保存しています' });
    const failure = settings.getByRole('alert').filter({ hasText: '学習設定の保存に失敗しました（検証用）。' });
    const sameMountedDraft = async () => {
      expect(await originalComposer.evaluate(node => node.isConnected && node === document.querySelector('.ai-planning-composer textarea'))).toBe(true);
      expect(await originalSettings.evaluate(node => node.isConnected && node === document.querySelector('.app-settings-page'))).toBe(true);
      await expect(settings).toBeVisible();
      await expect(composer).toHaveValue(draft);
      await expect(palette).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('.splash-screen:visible')).toHaveCount(0);
    };
    const durableDay = () => page.evaluate(async () => (await window.__preferenceSaveHarness.readDurable()).weekStartsOn.value);
    await expect(monday).toHaveAttribute('aria-pressed', 'true');
    await sunday.click();
    await expect.poll(() => page.evaluate(() => window.__preferenceSaveHarness.pending)).toBe(1);
    await expect(pending).toBeVisible();
    await expect(week).toHaveAttribute('aria-busy', 'true');
    await expect(monday).toBeDisabled(); await expect(sunday).toBeDisabled(); await expect(reset).toBeDisabled();
    await expect(monday).toHaveAttribute('aria-pressed', 'true');
    expect(await durableDay()).toBe('monday');
    await sameMountedDraft();
    await info.attach(`preference-${outcome}-${width}-pending`, { body: await settings.screenshot(), contentType: 'image/png' });
    if (outcome === 'failure') {
      await page.evaluate(() => window.__preferenceSaveHarness.rejectNext());
      await expect(failure).toBeVisible();
      await expect(pending).toHaveCount(0);
      await expect(week).toHaveAttribute('aria-busy', 'false');
      await expect(monday).toBeEnabled(); await expect(sunday).toBeEnabled(); await expect(reset).toBeEnabled();
      await expect(monday).toHaveAttribute('aria-pressed', 'true');
      expect(await durableDay()).toBe('monday');
      await sameMountedDraft();
      await info.attach(`preference-${width}-failure`, { body: await settings.screenshot(), contentType: 'image/png' });
      await sunday.click();
      await expect(pending).toBeVisible(); await expect(failure).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => window.__preferenceSaveHarness.pending)).toBe(1);
      await sameMountedDraft();
    }
    await page.evaluate(() => window.__preferenceSaveHarness.resolveNext());
    await expect(pending).toHaveCount(0); await expect(failure).toHaveCount(0);
    await expect(sunday).toBeEnabled(); await expect(reset).toBeEnabled();
    await expect(sunday).toHaveAttribute('aria-pressed', 'true');
    expect(await durableDay()).toBe('sunday');
    await sameMountedDraft();
    expect(await page.evaluate(() => ({ writes: window.__preferenceSaveHarness.writes, resets: window.__preferenceSaveHarness.resets, pending: window.__preferenceSaveHarness.pending })))
      .toEqual({ writes: outcome === 'failure' ? 2 : 1, resets: 0, pending: 0 });
    await settings.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(composer).toBeVisible(); await expect(composer).toHaveValue(draft);
    expect(await originalComposer.evaluate(node => node.isConnected && node === document.querySelector('.ai-planning-composer textarea'))).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.plans'))).toBe(originalPlans);
    await info.attach(`preference-${outcome}-${width}-retained-draft`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
