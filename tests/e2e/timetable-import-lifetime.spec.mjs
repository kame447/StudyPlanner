import { expect, test } from './support/fixed-clock.mjs';

const snapshot = page => page.evaluate(() => window.__plannerRecoveryRepository.snapshot());
// Plans persist through ScheduleEvent authority, not the legacy plans key.
const durablePlans = page => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'));
const writes = async page => (await snapshot(page)).calls.filter(call => call.method === 'upsertPlan' && call.phase === 'called');
const dialog = page => page.locator('.timetable-import-modal');
async function boot(page, viewport, theme) {
  await page.setViewportSize(viewport);
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return ['127.0.0.1', 'localhost', '[::1]'].includes(host) ? route.continue() : route.abort();
  });
  await page.addInitScript(theme => {
    if (localStorage.getItem('timetable-import-seeded')) return;
    localStorage.clear();
    localStorage.setItem('study-planner-theme-mode', theme);
    localStorage.setItem('study-planner-theme-palette', 'ocean');
    localStorage.setItem('timetable-import-seeded', 'true');
  }, theme);
  await page.goto('http://127.0.0.1:4174/timetable-import.html');
  await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook?.snapshot?.().ready ?? false)).toBe(true);
  for (const [title, periodNumber] of [['数学A', 1], ['英語B', 2]]) {
    await page.evaluate(args => window.__plannerRecoveryHook.startTimetableClass(args), { title, weekday: 'wed', periodNumber });
    await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook.saveComplete)).toBe(true);
    expect(await page.evaluate(() => window.__plannerRecoveryHook.saveError)).toBeNull();
  }
  // Normal visible DayView controls; no forced hidden App callback activation.
  await page.getByTitle('今日の時間割を反映', { exact: true }).click();
  await expect(dialog(page).getByRole('checkbox')).toHaveCount(2);
}

for (const options of [
  { name: 'desktop-light', viewport: { width: 1280, height: 900 }, theme: 'light' },
  { name: 'mobile-dark', viewport: { width: 390, height: 844 }, theme: 'dark' },
]) {
  test(`real DayView import keeps one batch through close and reopen ${options.name}`, async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await boot(page, options.viewport, options.theme);
    await page.evaluate(() => window.__plannerRecoveryRepository.holdNextPlanWrite());
    await dialog(page).getByRole('button', { name: '反映', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).pendingPlanWrites).toBe(1);
    await dialog(page).getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByTitle('今日の時間割を反映', { exact: true }).click();
    await expect(dialog(page).getByRole('button', { name: '反映', exact: true })).toBeDisabled();
    await expect(dialog(page).getByRole('status')).toContainText('反映しています');
    // Native repeat activation cannot submit while the original batch owns admission.
    await dialog(page).getByRole('button', { name: '反映', exact: true }).evaluate(button => { button.click(); button.click(); });
    expect(await writes(page)).toHaveLength(1);
    expect(await page.evaluate(() => window.__plannerRecoveryRepository.releasePlanWrite())).toBe(true);
    await expect.poll(async () => (await durablePlans(page)).map(plan => plan.title).sort()).toEqual(['数学A', '英語B']);
    await expect(dialog(page).getByRole('status')).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: '反映', exact: true })).toBeDisabled();
    expect(await writes(page)).toHaveLength(2);
    expect((await durablePlans(page)).map(plan => plan.provenance.sourceId)).toHaveLength(2);
    expect(new Set((await durablePlans(page)).map(plan => plan.provenance.sourceId)).size).toBe(2);
    const screenshot = testInfo.outputPath(`timetable-import-${options.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(options.name, { path: screenshot, contentType: 'image/png' });
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook?.snapshot?.().ready ?? false)).toBe(true);
    expect(await page.evaluate(() => window.__plannerRecoveryHook.snapshot().plans.map(plan => plan.title).sort())).toEqual(['数学A', '英語B']);
    expect((await durablePlans(page)).map(plan => plan.title).sort()).toEqual(['数学A', '英語B']);
    expect(await writes(page)).toHaveLength(0);
    expect(errors).toEqual([]);
  });
}
