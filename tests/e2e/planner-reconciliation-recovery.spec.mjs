import { E2E_TODAY, expect, test } from './support/fixed-clock.mjs';

const HARNESS_URL = 'http://127.0.0.1:4174/full-planner-recovery.html';
// Gate the actual Vite-served production module, never a replacement loader.
const RUNTIME_MODULE_SOURCE = /\/weeklyPlanningStableV5InstrumentedRuntimeExecutor\.ts(?:\?.*)?$/;
const cases = [
  { label: 'desktop', width: 1280, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
  { label: 'short-mobile', width: 390, height: 600 },
].flatMap(viewport => ['light', 'dark'].map(theme => ({ ...viewport, theme })));
const image = { name: 'retained-planning.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKAAAAABJRU5ErkJggg==', 'base64') };
const TEXT = '入力と添付を残して新しい学習データで計画する';
const recovery = page => page.getByRole('region', { name: '学習データの表示状況', exact: true });
const retry = page => recovery(page).getByRole('button', { name: '表示の更新を再試行', exact: true });
const composer = page => page.locator('.ai-planning-composer textarea');
const attachment = page => page.getByLabel(`添付画像 ${image.name}`, { exact: true });
const repoSnapshot = page => page.evaluate(() => window.__plannerRecoveryRepository.snapshot());
const hookSnapshot = page => page.evaluate(() => window.__plannerRecoveryHook?.snapshot?.() ?? { ready: false });
const durableWrites = page => page.evaluate(() => structuredClone(window.__plannerRecoveryStorageWrites));
const durable = page => page.evaluate(() => window.__plannerRecoveryRepository.readDurable());
const runtimeCalls = page => page.evaluate(() => (window.__realWeeklyEvents ?? []).filter(event => event.type === 'real-runtime-execute'));
const calledMethods = snapshot => snapshot.calls.filter(call => call.phase === 'called').map(call => call.method);
const writeMethods = snapshot => calledMethods(snapshot).filter(method => !method.startsWith('get'));

async function navigate(page, label) {
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: label, exact: true }).click();
}
async function boot(page, options) {
  await page.setViewportSize({ width: options.width, height: options.height });
  // Fail closed: synthetic local fixtures may load loopback code only. Never
  // contact a live provider/account if a dependency changes in the future.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.goto(`${HARNESS_URL}?theme=${options.theme}`);
  await page.waitForFunction(() => typeof window.__plannerRecoveryHook?.snapshot === 'function');
  await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
  await expect(page.getByRole('navigation', { name: '主要ナビゲーション' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', options.theme);
  return hookSnapshot(page);
}
async function holdOcr(page) {
  await navigate(page, 'AI計画');
  await expect(composer(page)).toBeEnabled();
  await composer(page).fill(TEXT);
  await page.locator('.ai-planning-attachment-input').setInputFiles(image);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__realWeeklyImageRead.pending())).toBe(1);
  expect(await runtimeCalls(page)).toEqual([]);
}
async function failReconciliationAfterDurableSave(page) {
  const before = await repoSnapshot(page);
  await page.evaluate(() => {
    window.__plannerRecoveryRepository.holdNextActualAcknowledgment();
    window.__plannerRecoveryHook.startActual();
  });
  await expect.poll(async () => (await repoSnapshot(page)).pendingAcknowledgments).toBe(1);
  const committed = await durable(page);
  expect(committed.actuals).toEqual([expect.objectContaining({ note: 'held actual acknowledgment' })]);
  expect(committed.materials).toEqual([expect.objectContaining({ id: 'material-before-refresh', currentUnit: 15 })]);
  expect(calledMethods(await repoSnapshot(page)).slice(calledMethods(before).length))
    .toEqual(['upsertActualWithMaterialProgress']);
  const newer = await page.evaluate(() => window.__plannerRecoveryRepository.installNewerDurableProjection());
  await page.evaluate(() => window.__plannerRecoveryHook.refresh());
  // React may commit effects after the async refresh promise resolves. Wait for
  // publication of both real arrays and readiness before inspecting the bridge.
  await expect.poll(async () => {
    const snapshot = await hookSnapshot(page);
    return { actuals: snapshot.actuals, materials: snapshot.materials, ready: snapshot.ready };
  }).toEqual({ actuals: newer.actuals, materials: newer.materials, ready: false });
  const accepted = await hookSnapshot(page);
  expect(accepted.actuals).toEqual(newer.actuals);
  expect(accepted.materials).toEqual(newer.materials);
  expect(accepted.ready).toBe(false);
  await expect(recovery(page)).toBeVisible();
  // Full read has already completed; fail ONLY the detached target projection.
  await page.evaluate(() => window.__plannerRecoveryRepository.failNextActualRead());
  expect(await page.evaluate(() => window.__plannerRecoveryRepository.releaseActualAcknowledgment())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook.saveComplete)).toBe(true);
  expect(await page.evaluate(() => window.__plannerRecoveryHook.saveError)).toBeNull();
  await expect(retry(page)).toBeVisible();
  await expect.poll(async () => (await hookSnapshot(page)).recovery?.phase).toBe('failed');
  expect(await durable(page)).toEqual(newer);
  expect(writeMethods(await repoSnapshot(page)).filter(method => method === 'upsertActualWithMaterialProgress'))
    .toHaveLength(1);
  return { newer, writes: writeMethods(await repoSnapshot(page)), storageWrites: await durableWrites(page),
    callsAfterFailure: calledMethods(await repoSnapshot(page)) };
}
async function repairWithoutReplay(page, expected) {
  const before = await repoSnapshot(page);
  await page.evaluate(() => window.__plannerRecoveryRepository.holdTargetReads());
  // Two same-task activations of the actual UI callback must coalesce. Do not
  // assert whether an in-flight retry is hidden versus disabled.
  await retry(page).evaluate(button => { button.click(); button.click(); });
  await expect.poll(async () => (await repoSnapshot(page)).pendingReads.length).toBe(2);
  expect((await repoSnapshot(page)).pendingReads.sort()).toEqual(['getActuals', 'getStudyMaterials']);
  const pendingRetry = retry(page);
  if (await pendingRetry.count() && await pendingRetry.isVisible()) await expect(pendingRetry).toBeDisabled();
  expect(await durable(page)).toEqual(expected.newer);
  expect(writeMethods(await repoSnapshot(page))).toEqual(expected.writes);
  expect(await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads())).toBe(2);
  await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
  await expect(recovery(page)).toHaveCount(0);
  const after = await repoSnapshot(page);
  expect(calledMethods(after).slice(calledMethods(before).length).sort()).toEqual(['getActuals', 'getStudyMaterials']);
  expect(writeMethods(after)).toEqual(expected.writes);
  expect(await durableWrites(page)).toEqual(expected.storageWrites);
  expect(await durable(page)).toEqual(expected.newer);
  expect((await hookSnapshot(page)).actuals).toEqual(expected.newer.actuals);
  expect((await hookSnapshot(page)).materials).toEqual(expected.newer.materials);
}
async function expectNoReplay(page, expected) {
  expect(writeMethods(await repoSnapshot(page))).toEqual(expected.writes);
  expect(await durable(page)).toEqual(expected.newer);
  expect(await durableWrites(page)).toEqual(expected.storageWrites);
  expect(await runtimeCalls(page)).toEqual([]);
}
async function inspectGeometry(page, testInfo, label, withComposer = false) {
  const banner = recovery(page);
  await expect(banner).toBeVisible();
  await expect(retry(page)).toBeVisible();
  const metrics = await page.evaluate(({ withComposer }) => {
    const rect = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return { viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      banner: rect('.planner-data-recovery-notice'), retry: rect('.planner-data-recovery-notice button'),
      footer: rect('.primary-bottom-nav'), composer: withComposer ? rect('.ai-planning-composer') : null,
      noticeInMain: !!document.querySelector('main > .planner-data-recovery-notice') };
  }, { withComposer });
  expect(metrics.noticeInMain).toBe(true);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  for (const [name, box] of Object.entries({ banner: metrics.banner, retry: metrics.retry, footer: metrics.footer,
    ...(withComposer ? { composer: metrics.composer } : {}) })) {
    expect(box, `${label}: ${name}`).not.toBeNull();
    expect(box.width, `${label}: ${name} width`).toBeGreaterThan(0);
    expect(box.height, `${label}: ${name} height`).toBeGreaterThan(0);
    expect(box.x, `${label}: ${name} left`).toBeGreaterThanOrEqual(-1);
    expect(box.right, `${label}: ${name} right`).toBeLessThanOrEqual(metrics.viewport.width + 1);
    expect(box.y, `${label}: ${name} top`).toBeGreaterThanOrEqual(-1);
    expect(box.bottom, `${label}: ${name} bottom`).toBeLessThanOrEqual(metrics.viewport.height + 1);
  }
  expect(metrics.retry.x).toBeGreaterThanOrEqual(metrics.banner.x - 1);
  expect(metrics.retry.y).toBeGreaterThanOrEqual(metrics.banner.y - 1);
  expect(metrics.retry.right).toBeLessThanOrEqual(metrics.banner.right + 1);
  expect(metrics.retry.bottom).toBeLessThanOrEqual(metrics.banner.bottom + 1);
  expect(metrics.banner.bottom).toBeLessThanOrEqual(metrics.footer.y + 1);
  if (withComposer) {
    expect(metrics.banner.bottom).toBeLessThanOrEqual(metrics.composer.y + 1);
    expect(metrics.composer.bottom).toBeLessThanOrEqual(metrics.footer.y + 1);
  }
  const screenshotPath = testInfo.outputPath(`${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(label, { path: screenshotPath, contentType: 'image/png' });
  await testInfo.attach(`${label}-geometry`, { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
}

test.describe.configure({ retries: 0 });
for (const options of cases) {
  const label = `${options.label}-${options.theme}`;
  test(`persistent recovery survives notice expiry and App navigation; read-only retry ${label}`, async ({ page }, testInfo) => {
    const initial = await boot(page, options);
    const expected = await failReconciliationAfterDurableSave(page);
    // Explicit virtual-clock advancement proves persistence beyond the ordinary
    // 3600ms toast lifetime without encoding a wall-clock latency requirement.
    await page.clock.fastForward(4000);
    await expect(page.getByRole('button', { name: '通知を閉じる', exact: true })).toHaveCount(0);
    await inspectGeometry(page, testInfo, `${label}-home`);
    await navigate(page, '予定');
    await expect(recovery(page)).toBeVisible();
    await expect(retry(page)).toBeEnabled();
    await navigate(page, 'AI計画');
    await composer(page).fill('更新を待っている入力');
    await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();
    await inspectGeometry(page, testInfo, `${label}-ai`, true);
    await navigate(page, 'ホーム');
    await expect(retry(page)).toBeEnabled();
    const lifetime = await hookSnapshot(page);
    expect({ mounts: lifetime.mounts, unmounts: lifetime.unmounts }).toEqual({ mounts: initial.mounts, unmounts: initial.unmounts });
    await expectNoReplay(page, expected);
    expect(calledMethods(await repoSnapshot(page))).toEqual(expected.callsAfterFailure);
    await repairWithoutReplay(page, expected);
    await navigate(page, 'AI計画');
    await composer(page).fill('更新後の計画依頼');
    await expect(page.getByRole('button', { name: '送信', exact: true })).toBeEnabled();
    await expectNoReplay(page, expected);
  });

}

// Six persistent-recovery cases above own viewport/theme geometry. These two
// cases own distinct retained-OCR ordering, sampled where attachment + banner
// height is tightest and where repaired dark-mode input must remain usable.
// This intentionally does not claim every OCR state at every viewport/theme.
const ocrCases = [
  { viewport: 'short-mobile', theme: 'light', recoveredBeforeOcr: false },
  { viewport: 'mobile', theme: 'dark', recoveredBeforeOcr: true },
];
for (const { viewport, theme, recoveredBeforeOcr } of ocrCases) {
  const options = cases.find(item => item.label === viewport && item.theme === theme);
  if (!options) throw new Error(`Missing OCR viewport/theme case: ${viewport}/${theme}`);
  const label = `${options.label}-${options.theme}`;
  test(`retained OCR rejects old projection (${recoveredBeforeOcr ? 'already repaired' : 'still failed'}) ${label}`, async ({ page }, testInfo) => {
    const initial = await boot(page, options);
    await holdOcr(page);
    const expected = await failReconciliationAfterDurableSave(page);
    // Keep the same AI view mounted: navigating away would test the separate
    // submission-owner cancellation guard, not captured projection freshness.
    if (recoveredBeforeOcr) await repairWithoutReplay(page, expected);
    expect(await page.evaluate(() => window.__realWeeklyImageRead.release())).toBe(true);
    await expect(composer(page)).toBeEnabled();
    await expect(composer(page)).toHaveValue(TEXT);
    await expect(attachment(page)).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('学習データが更新');
    await expectNoReplay(page, expected);
    if (!recoveredBeforeOcr) {
      await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();
      await inspectGeometry(page, testInfo, `${label}-retained-input`, true);
      await repairWithoutReplay(page, expected);
    }
    const lifetime = await hookSnapshot(page);
    expect({ mounts: lifetime.mounts, unmounts: lifetime.unmounts }).toEqual({ mounts: initial.mounts, unmounts: initial.unmounts });
    await expect(page.getByRole('button', { name: '送信', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__realWeeklyImageRead.pending())).toBe(1);
    expect(await runtimeCalls(page)).toEqual([]);
    expect(await page.evaluate(() => window.__realWeeklyImageRead.release())).toBe(true);
    await expect.poll(async () => (await runtimeCalls(page)).length).toBe(1);
    expect((await runtimeCalls(page))[0].payload).toMatchObject({
      userText: TEXT, actualIds: ['actual-after-refresh'], materialIds: ['material-after-refresh'],
      actualNotes: ['newer authoritative actual'], materialCurrentUnits: [37],
    });
    await expect(attachment(page)).toHaveCount(0);
    await expect(composer(page)).toHaveValue('');
    expect(writeMethods(await repoSnapshot(page))).toEqual(expected.writes);
    expect(await durableWrites(page)).toEqual(expected.storageWrites);
    expect(await durable(page)).toEqual(expected.newer);
    const path = testInfo.outputPath(`${label}-fresh-resend-${recoveredBeforeOcr}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach('fresh projection accepted after user resend', { path, contentType: 'image/png' });
  });
}

// Exercise the composition boundary added by runtime-module recovery: admission
// can be revoked while code loads, before OCR has even begun. The six persistent
// recovery scenarios above retain their full viewport/theme matrix; the two OCR
// scenarios retain distinct ordering coverage at selected viewport/theme pairs.
for (const recoveredBeforeModule of [false, true]) {
  const options = recoveredBeforeModule ? cases.find(item => item.label === 'mobile' && item.theme === 'dark') : cases[0];
  test(`actual module preflight rejects revoked projection before OCR (${recoveredBeforeModule ? 'already repaired' : 'still failed'})`, async ({ page }) => {
    await boot(page, options);
    let moduleRequests = 0;
    let releaseModule;
    const moduleGate = new Promise(resolve => { releaseModule = resolve; });
    await page.route(RUNTIME_MODULE_SOURCE, async route => {
      moduleRequests += 1;
      await moduleGate;
      await route.continue();
    });
    try {
      await navigate(page, 'AI計画');
      await composer(page).fill(TEXT);
      await page.locator('.ai-planning-attachment-input').setInputFiles(image);
      await page.getByRole('button', { name: '送信', exact: true }).click();
      await expect.poll(() => moduleRequests).toBe(1);
      expect(await page.evaluate(() => window.__realWeeklyImageRead.pending())).toBe(0);
      expect(await runtimeCalls(page)).toEqual([]);
      await expect(composer(page)).toHaveValue(TEXT);
      await expect(attachment(page)).toBeVisible();
      await expect(page.locator('.ai-planning-message-row.user')).toHaveCount(0);

      const expected = await failReconciliationAfterDurableSave(page);
      if (recoveredBeforeModule) await repairWithoutReplay(page, expected);
      releaseModule();
      await expect(composer(page)).toBeEnabled();
      await expect(page.getByRole('alert')).toContainText('学習データが更新');
      await expect(composer(page)).toHaveValue(TEXT);
      await expect(attachment(page)).toBeVisible();
      await expect(page.locator('.ai-planning-message-row.user')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '入力を一時保存して画面を更新', exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => window.__realWeeklyImageRead.pending())).toBe(0);
      await expectNoReplay(page, expected);

      if (!recoveredBeforeModule) await repairWithoutReplay(page, expected);
      await page.getByRole('button', { name: '送信', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__realWeeklyImageRead.pending())).toBe(1);
      expect(await runtimeCalls(page)).toEqual([]);
      expect(await page.evaluate(() => window.__realWeeklyImageRead.release())).toBe(true);
      await expect.poll(async () => (await runtimeCalls(page)).length).toBe(1);
      expect((await runtimeCalls(page))[0].payload).toMatchObject({
        userText: TEXT, actualIds: ['actual-after-refresh'], materialIds: ['material-after-refresh'],
        actualNotes: ['newer authoritative actual'], materialCurrentUnits: [37],
      });
      await expect(attachment(page)).toHaveCount(0);
      await expect(composer(page)).toHaveValue('');
      expect(writeMethods(await repoSnapshot(page))).toEqual(expected.writes);
      expect(await durableWrites(page)).toEqual(expected.storageWrites);
      expect(await durable(page)).toEqual(expected.newer);
    } finally {
      // A failed assertion must not leave the module route waiting at teardown.
      releaseModule();
    }
  });
}

const MONTH_EVENT_TITLE = '再読み込み後も残る月の主要予定';
const monthSelection = snapshot => ({ monthDate: snapshot.monthDate, selectedDate: snapshot.selectedDate });
const durableMonthEvents = page => page.evaluate(() => window.__plannerRecoveryRepository.readDurableMonthEvents());
const monthPill = page => page.getByRole('grid', { name: '月間カレンダー', exact: true })
  .locator('.month-major-event-pill').filter({ hasText: MONTH_EVENT_TITLE });

async function failMonthReconciliationAfterHeldSave(page, whileHeld = async () => {}) {
  const before = await repoSnapshot(page);
  const storageBefore = await durableWrites(page);
  const collectionsBefore = await durable(page);
  await page.evaluate(({ date, title }) => {
    window.__plannerRecoveryRepository.holdNextMonthWrite();
    window.__plannerRecoveryHook.startMonthEvent({ date, title });
  }, { date: E2E_TODAY, title: MONTH_EVENT_TITLE });
  await expect.poll(async () => (await repoSnapshot(page)).pendingMonthWrites).toBe(1);
  await expect.poll(async () => (await hookSnapshot(page)).monthEvents.map(event => event.title)).toEqual([MONTH_EVENT_TITLE]);
  expect(await durableMonthEvents(page)).toEqual([]);
  expect(await durableWrites(page)).toEqual(storageBefore);
  expect(calledMethods(await repoSnapshot(page)).slice(calledMethods(before).length)).toEqual(['upsertMonthEvent']);
  await whileHeld();
  const selection = monthSelection(await hookSnapshot(page));
  await page.evaluate(() => window.__plannerRecoveryHook.refresh());
  await expect.poll(async () => {
    const snapshot = await hookSnapshot(page);
    return { monthEvents: snapshot.monthEvents, ready: snapshot.ready, phase: snapshot.recovery?.phase };
  }).toEqual({ monthEvents: [], ready: false, phase: 'waiting' });
  const accepted = await hookSnapshot(page);
  expect(accepted.availability.status).toBe('stale');
  expect(monthSelection(accepted)).toEqual(selection);
  expect(await durableMonthEvents(page)).toEqual([]);
  await expect(recovery(page)).toBeVisible();
  const beforeTarget = calledMethods(await repoSnapshot(page));
  // The full read has accepted its old calendar. Fail only the detached target
  // read after the held real write is finally allowed to persist and return.
  await page.evaluate(() => window.__plannerRecoveryRepository.failNextMonthRead());
  expect(await page.evaluate(() => window.__plannerRecoveryRepository.releaseMonthWrite())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook.saveComplete)).toBe(true);
  expect(await page.evaluate(() => window.__plannerRecoveryHook.saveError)).toBeNull();
  await expect.poll(async () => (await hookSnapshot(page)).recovery?.phase).toBe('failed');
  await expect(retry(page)).toBeEnabled();
  await expect(recovery(page)).toContainText('学習データの最新表示を確認できませんでした。');
  // Any writer overlapping a full read conservatively retains Actual/material.
  // This real-App route therefore owes the combined union, not Month-only I/O.
  expect(calledMethods(await repoSnapshot(page)).slice(beforeTarget.length).sort())
    .toEqual(['getActuals', 'getMonthEvents', 'getStudyMaterials']);
  const saved = await durableMonthEvents(page);
  expect(saved).toEqual([expect.objectContaining({ title: MONTH_EVENT_TITLE, date: E2E_TODAY })]);
  const failed = await hookSnapshot(page);
  expect(failed.monthEvents).toEqual([]);
  expect(failed.ready).toBe(false);
  expect(monthSelection(failed)).toEqual(selection);
  expect(await durable(page)).toEqual(collectionsBefore);
  expect(calledMethods(await repoSnapshot(page)).filter(method => method === 'upsertMonthEvent')).toHaveLength(1);
  return { saved, selection, collectionsBefore, fullTimestamp: accepted.availability.lastSuccessfulAt,
    writes: writeMethods(await repoSnapshot(page)), storageWrites: await durableWrites(page),
    callsAfterFailure: calledMethods(await repoSnapshot(page)), lifetime: { mounts: failed.mounts, unmounts: failed.unmounts } };
}

async function repairMonthWithoutReplay(page, expected, whileRetryHeld = async () => {}) {
  expect(calledMethods(await repoSnapshot(page))).toEqual(expected.callsAfterFailure);
  await page.evaluate(() => window.__plannerRecoveryRepository.holdTargetReads());
  await retry(page).evaluate(button => { button.click(); button.click(); });
  await expect.poll(async () => (await repoSnapshot(page)).pendingReads.length).toBe(3);
  expect((await repoSnapshot(page)).pendingReads.sort()).toEqual(['getActuals', 'getMonthEvents', 'getStudyMaterials']);
  expect((await hookSnapshot(page)).ready).toBe(false);
  expect((await hookSnapshot(page)).monthEvents).toEqual([]);
  expect(writeMethods(await repoSnapshot(page))).toEqual(expected.writes);
  expect(await durableWrites(page)).toEqual(expected.storageWrites);
  await whileRetryHeld();
  expect(await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads())).toBe(3);
  await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
  await expect(recovery(page)).toHaveCount(0);
  const repaired = await hookSnapshot(page);
  expect(repaired.monthEvents).toEqual(expected.saved);
  expect(monthSelection(repaired)).toEqual(expected.selection);
  expect({ mounts: repaired.mounts, unmounts: repaired.unmounts }).toEqual(expected.lifetime);
  expect(repaired.availability.lastSuccessfulAt).toBe(expected.fullTimestamp);
  // Exact getter counts exclude full-load/normalization work and verify that the
  // duplicate activation coalesced into one read-only retry, with no save replay.
  expect(calledMethods(await repoSnapshot(page)).slice(expected.callsAfterFailure.length).sort())
    .toEqual(['getActuals', 'getMonthEvents', 'getStudyMaterials']);
  expect(writeMethods(await repoSnapshot(page))).toEqual(expected.writes);
  expect(await durableWrites(page)).toEqual(expected.storageWrites);
  expect(await durableMonthEvents(page)).toEqual(expected.saved);
  expect(await durable(page)).toEqual(expected.collectionsBefore);
  expect(await runtimeCalls(page)).toEqual([]);
}

test('MonthEvent recovery repairs the calendar without undoing newer month navigation desktop-light', async ({ page }, testInfo) => {
  await boot(page, cases.find(item => item.label === 'desktop' && item.theme === 'light'));
  await navigate(page, '予定');
  await expect(page.getByRole('tab', { name: '月', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.schedule-period-picker-trigger')).toHaveText('2026年8月');
  const expected = await failMonthReconciliationAfterHeldSave(page, async () => {
    await expect(monthPill(page)).toBeVisible();
    await page.getByRole('button', { name: '次の期間へ', exact: true }).click();
    await expect(page.locator('.schedule-period-picker-trigger')).toHaveText('2026年9月');
  });
  expect(expected.selection).toEqual({ monthDate: '2026-09-01', selectedDate: '2026-09-01' });
  await page.clock.fastForward(4000);
  await inspectGeometry(page, testInfo, 'desktop-light-month-recovery');
  await repairMonthWithoutReplay(page, expected);
  await expect(page.locator('.schedule-period-picker-trigger')).toHaveText('2026年9月');
  // Only this explicit user navigation returns to the saved event's month.
  await page.getByRole('button', { name: '前の期間へ', exact: true }).click();
  await expect(page.locator('.schedule-period-picker-trigger')).toHaveText('2026年8月');
  await expect(monthPill(page)).toBeVisible();
  const path = testInfo.outputPath('desktop-light-month-calendar-repaired.png');
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach('saved MonthEvent visible after read-only repair', { path, contentType: 'image/png' });
});

test('MonthEvent recovery retains mobile AI input and blocks admission until read-only repair mobile-dark', async ({ page }, testInfo) => {
  await boot(page, cases.find(item => item.label === 'mobile' && item.theme === 'dark'));
  await navigate(page, 'AI計画');
  await composer(page).fill(TEXT);
  await page.locator('.ai-planning-attachment-input').setInputFiles(image);
  const expected = await failMonthReconciliationAfterHeldSave(page);
  await expect(composer(page)).toHaveValue(TEXT);
  await expect(attachment(page)).toBeVisible();
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();
  await inspectGeometry(page, testInfo, 'mobile-dark-month-recovery-input', true);
  await repairMonthWithoutReplay(page, expected, async () => {
    await expect(composer(page)).toHaveValue(TEXT);
    await expect(attachment(page)).toBeVisible();
    await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();
  });
  await expect(composer(page)).toHaveValue(TEXT);
  await expect(attachment(page)).toBeVisible();
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeEnabled();
  await expect(page.locator('.ai-planning-message-row.user')).toHaveCount(0);
  expect(await page.evaluate(() => window.__realWeeklyImageRead.pending())).toBe(0);
  expect(await runtimeCalls(page)).toEqual([]);
  await navigate(page, '予定');
  await expect(page.locator('.schedule-period-picker-trigger')).toHaveText('2026年8月');
  await expect(monthPill(page)).toBeVisible();
});

// The 12 recovery cases above remain unchanged. This one owns the distinct
// durable-loss schedule: failed compound Undo, synchronous Month admission,
// compensation, then the queued Month write. No full read is held inside the
// repository queue, and neither UI state nor repository results are fabricated.
test('failed Plan Undo preserves a queued MonthEvent through rollback and real reload desktop-light', async ({ page }, testInfo) => {
  await boot(page, cases.find(item => item.label === 'desktop' && item.theme === 'light'));
  const seeded = await page.evaluate(async date => {
    const userId = window.__plannerRecoveryHook.snapshot().ownerId;
    const seeded = await window.__plannerRecoveryRepository.seedPlanUndo({ userId, date });
    await window.__plannerRecoveryHook.refresh();
    return seeded;
  }, E2E_TODAY);
  await expect.poll(async () => {
    const state = await hookSnapshot(page);
    return { plans: state.plans.map(item => item.id), actuals: state.actuals.map(item => item.id), ready: state.ready };
  }).toEqual({ plans: [seeded.plan.id], actuals: [seeded.actual.id], ready: true });
  await navigate(page, '予定');
  await page.evaluate(planId => window.__plannerRecoveryHook.deletePlan(planId), seeded.plan.id);
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeVisible();
  await expect.poll(async () => (await hookSnapshot(page)).plans).toEqual([]);
  expect((await durable(page)).actuals).toEqual([]);
  expect(await durableMonthEvents(page)).toEqual([]);
  const before = await repoSnapshot(page);
  const storageBefore = await durableWrites(page);

  await page.evaluate(({ planId, date, title }) => {
    window.__plannerRecoveryRepository.armPlanRestoreFault(planId, () => {
      // This public Month callback admits its real save synchronously; it does
      // not await its predecessor from the synchronous Storage.setItem frame.
      // Match MonthEventDialog's range-aware single-day draft so the full
      // optimistic/canonical equality below compares the same public shape.
      window.__plannerRecoveryHook.startMonthEvent({ date, endDate: date, title });
    });
  }, { planId: seeded.plan.id, date: E2E_TODAY, title: MONTH_EVENT_TITLE });
  try {
    // Exercise the actual App notice action and the hook's captured Undo, not a
    // test-created restoration or a direct repository restore call.
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect.poll(async () => (await repoSnapshot(page)).calls.filter(call =>
      call.method === 'restorePlanWithDependents' && call.phase === 'rejected'))
      .toEqual([{ method: 'restorePlanWithDependents', phase: 'rejected',
        error: 'Error: Synthetic Plan Undo Actual write failure' }]);
    await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook.saveComplete)).toBe(true);
    expect(await page.evaluate(() => window.__plannerRecoveryHook.saveError)).toBeNull();
    const saved = await durableMonthEvents(page);
    expect(saved).toEqual([expect.objectContaining({ title: MONTH_EVENT_TITLE, date: E2E_TODAY })]);
    const savedId = saved[0].id;
    const trace = await page.evaluate(() => window.__plannerRecoveryRepository.planRestoreFaultSnapshot());
    expect({ entered: trace.entered, failed: trace.failed }).toEqual({ entered: true, failed: true });
    expect(trace.events.map(({ phase, key, rows }) => ({ phase, ...(key ? { key, ids: rows.map(row => row.id) } : {}) })))
      .toEqual([
        { phase: 'written', key: 'studyplanner.scheduleEvents.v1', ids: [`plan:${seeded.plan.id}`] },
        { phase: 'enqueue-month' },
        { phase: 'failed-write', key: 'studyplanner.actuals', ids: [seeded.actual.id] },
        { phase: 'written', key: 'studyplanner.scheduleEvents.v1', ids: [] },
        { phase: 'written', key: 'studyplanner.actuals', ids: [] },
        { phase: 'written', key: 'studyplanner.scheduleEvents.v1', ids: [`month-event:${savedId}`] },
      ]);
    // Independently compare the harness's native successful-write observer.
    // The failed Actual attempt must be absent, and Month saves exactly once.
    expect((await durableWrites(page)).slice(storageBefore.length)).toEqual(trace.events
      .filter(event => event.phase === 'written').map(({ key, rows }) => ({ key, value: JSON.stringify(rows) })));
    expect(writeMethods(await repoSnapshot(page)).slice(writeMethods(before).length))
      .toEqual(['restorePlanWithDependents', 'upsertMonthEvent']);
    await expect.poll(async () => {
      const state = await hookSnapshot(page);
      return { plans: state.plans, actuals: state.actuals, monthEvents: state.monthEvents, ready: state.ready };
    }).toEqual({ plans: [], actuals: [], monthEvents: saved, ready: true });
    await expect(monthPill(page)).toBeVisible();
    const storedBeforeReload = await page.evaluate(() => ({
      scheduleEvents: localStorage.getItem('studyplanner.scheduleEvents.v1'),
      actuals: localStorage.getItem('studyplanner.actuals'),
    }));
    expect(await runtimeCalls(page)).toEqual([]);
    await testInfo.attach('physical Undo rollback then Month save order', {
      body: JSON.stringify(trace, null, 2), contentType: 'application/json',
    });
    await page.evaluate(() => {
      window.__plannerRecoveryRepository.releasePlanRestoreFault();
      window.__plannerRecoveryRepository.preserveNextReload();
    });
    await page.reload();
    await page.waitForFunction(() => typeof window.__plannerRecoveryHook?.snapshot === 'function');
    await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem('studyplanner.e2e.preserve-next-reload'))).toBeNull();
    expect(await page.evaluate(() => ({
      scheduleEvents: localStorage.getItem('studyplanner.scheduleEvents.v1'),
      actuals: localStorage.getItem('studyplanner.actuals'),
    }))).toEqual(storedBeforeReload);
    expect(await durableMonthEvents(page)).toEqual(saved);
    expect((await hookSnapshot(page)).plans).toEqual([]);
    expect((await hookSnapshot(page)).actuals).toEqual([]);
    expect((await hookSnapshot(page)).monthEvents).toEqual(saved);
    expect(writeMethods(await repoSnapshot(page)).filter(method =>
      ['restorePlanWithDependents', 'upsertMonthEvent', 'upsertPlan', 'upsertActual'].includes(method))).toEqual([]);
    expect(await durableWrites(page)).toEqual([]);
    await navigate(page, '予定');
    await expect(monthPill(page)).toBeVisible();
    expect(await runtimeCalls(page)).toEqual([]);
    const path = testInfo.outputPath('queued-month-survives-failed-plan-undo-reload.png');
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach('MonthEvent still visible after real reload', { path, contentType: 'image/png' });
  } finally {
    await page.evaluate(() => window.__plannerRecoveryRepository.releasePlanRestoreFault());
  }
});

// The 13 existing cases stay unchanged. Full refresh admits its ten queued
// getters before the actual Undo click in this same browser task. No read or
// restore gate creates the race; only the later targeted Todo read is failed.
test('Plan Undo repairs all linked projections after an older full refresh; retry is read-only mobile-dark', async ({ page }) => {
  await boot(page, cases.find(item => item.label === 'mobile' && item.theme === 'dark'));
  const seeded = await page.evaluate(async date => {
    const userId = window.__plannerRecoveryHook.snapshot().ownerId;
    const seeded = await window.__plannerRecoveryRepository.seedPlanUndo({ userId, date, withTodo: true });
    await window.__plannerRecoveryHook.refresh();
    return seeded;
  }, E2E_TODAY);
  await expect.poll(async () => {
    const state = await hookSnapshot(page);
    return { plans: state.plans.map(item => item.id), actuals: state.actuals.map(item => item.id),
      todos: state.todos.map(item => item.id), ready: state.ready };
  }).toEqual({ plans: [seeded.plan.id], actuals: [seeded.actual.id], todos: [seeded.todo.id], ready: true });
  const restored = await hookSnapshot(page);
  const readStorage = () => page.evaluate(() => Object.fromEntries([
    'plans', 'scheduleEvents.v1', 'actuals', 'todos.v1', 'studyMaterials.v1', 'monthEvents',
    'dayNotes', 'studySubjects.v1', 'scheduleTemplates.v1', 'timetableTerms.v1', 'timetablePeriods.v1',
  ].map(key => [key, localStorage.getItem(`studyplanner.${key}`)])));
  const restoredStorage = await readStorage();
  await navigate(page, 'AI計画');
  await composer(page).fill(TEXT);
  await page.locator('.ai-planning-attachment-input').setInputFiles(image);
  await page.evaluate(planId => window.__plannerRecoveryHook.deletePlan(planId), seeded.plan.id);
  const undo = page.getByRole('button', { name: '元に戻す', exact: true });
  await expect(undo).toBeVisible();
  await expect.poll(async () => {
    const state = await hookSnapshot(page);
    return { plans: state.plans, actuals: state.actuals,
      todo: { status: state.todos[0]?.status, scheduledPlanId: state.todos[0]?.scheduledPlanId } };
  }).toEqual({ plans: [], actuals: [], todo: { status: 'open', scheduledPlanId: null } });
  const deleted = await hookSnapshot(page);
  const before = await repoSnapshot(page);
  const admitted = await undo.evaluate(button => {
    const repository = window.__plannerRecoveryRepository;
    const offset = repository.snapshot().calls.length;
    const refreshing = window.__plannerRecoveryHook.refresh();
    const admitted = repository.snapshot().calls.slice(offset).filter(call => call.phase === 'called').map(call => call.method);
    // Each full getter has already passed the fixture's failure check and
    // entered the real local queue. This fault therefore belongs to repair.
    repository.failNextTodoRead();
    button.click();
    return refreshing.then(() => admitted);
  });
  expect(admitted).toEqual(['getPlans', 'getActuals', 'getDayNotes', 'getMonthEvents', 'getTodos',
    'getStudySubjects', 'getStudyMaterials', 'getScheduleTemplates', 'getTimetableTerms', 'getTimetablePeriods']);
  await expect.poll(async () => (await hookSnapshot(page)).recovery?.phase).toBe('failed');
  await expect(retry(page)).toBeVisible();
  const failed = await hookSnapshot(page);
  // One failed member must retain the whole concern: successful Plan/Actual
  // target reads cannot publish a partial repair or certify AI admission.
  expect({ plans: failed.plans, actuals: failed.actuals, todos: failed.todos, ready: failed.ready })
    .toEqual({ plans: deleted.plans, actuals: deleted.actuals, todos: deleted.todos, ready: false });
  expect(await readStorage()).toEqual(restoredStorage);
  const afterFailure = await repoSnapshot(page);
  const failedCalls = afterFailure.calls.slice(before.calls.length);
  expect(failedCalls.filter(call => call.phase === 'failed')).toEqual([{ method: 'getTodos', phase: 'failed' }]);
  expect(failedCalls.filter(call => call.method === 'restorePlanWithDependents' && call.phase === 'returned')).toHaveLength(1);
  expect(calledMethods(afterFailure).slice(calledMethods(before).length, calledMethods(before).length + 11))
    .toEqual([...admitted, 'restorePlanWithDependents']);
  expect(writeMethods(afterFailure).slice(writeMethods(before).length))
    .toEqual(['restorePlanWithDependents', 'applyTimetableMutation']);
  const writes = writeMethods(afterFailure);
  const storageWrites = await durableWrites(page);
  await expect(composer(page)).toHaveValue(TEXT);
  await expect(attachment(page)).toBeVisible();
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();

  await page.evaluate(() => window.__plannerRecoveryRepository.holdTargetReads());
  try {
    await retry(page).click();
    const repairMethods = ['getActuals', 'getPlans', 'getStudyMaterials', 'getTodos'];
    await expect.poll(async () => (await repoSnapshot(page)).pendingReads.sort()).toEqual(repairMethods);
    expect((await hookSnapshot(page)).ready).toBe(false);
    await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads())).toBe(4);
    await expect.poll(async () => {
      const state = await hookSnapshot(page);
      return { plans: state.plans, actuals: state.actuals, todos: state.todos, materials: state.materials, ready: state.ready };
    }).toEqual({ plans: restored.plans, actuals: restored.actuals, todos: restored.todos, materials: restored.materials, ready: true });
    await expect(recovery(page)).toHaveCount(0);
    expect(calledMethods(await repoSnapshot(page)).slice(calledMethods(afterFailure).length).sort()).toEqual(repairMethods);
    expect(writeMethods(await repoSnapshot(page))).toEqual(writes);
    expect(await durableWrites(page)).toEqual(storageWrites);
    expect(await readStorage()).toEqual(restoredStorage);
    await expect(composer(page)).toHaveValue(TEXT);
    await expect(attachment(page)).toBeVisible();
    await expect(page.getByRole('button', { name: '送信', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__realWeeklyImageRead.pending())).toBe(0);
    expect(await runtimeCalls(page)).toEqual([]);
  } finally {
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseTargetReads());
  }
});

// The 14 existing cases above are unchanged. This is a real-App UI regression
// with a test-only remote-latency stand-in before Actual dispatch. It does not
// claim a native-local query window or a live Firebase/browser backend test.
for (const [viewport, theme] of [['desktop', 'light'], ['mobile', 'dark']]) {
test(`Quick Entry pending linked save blocks Day record open and Plan delete, then permits durable edit/delete ${viewport}-${theme}`, async ({ page }, testInfo) => {
  const options = cases.find(item => item.label === viewport && item.theme === theme);
  if (!options) throw new Error(`Missing Actual guard viewport/theme case: ${viewport}/${theme}`);
  await boot(page, options);
  const seeded = await page.evaluate(async date => {
    const userId = window.__plannerRecoveryHook.snapshot().ownerId;
    const seeded = await window.__plannerRecoveryRepository.seedPlanUndo({ userId, date, withActual: false });
    await window.__plannerRecoveryHook.refresh();
    return seeded;
  }, E2E_TODAY);
  await expect.poll(async () => {
    const state = await hookSnapshot(page);
    return { plans: state.plans.map(plan => plan.id), actuals: state.actuals, ready: state.ready };
  }).toEqual({ plans: [seeded.plan.id], actuals: [], ready: true });
  await navigate(page, '予定');
  await page.getByRole('tab', { name: '日', exact: true }).click();
  await page.getByRole('button', { name: 'クイック追加メニューを開く', exact: true }).click();
  await page.getByRole('menuitem', { name: '学習を追加', exact: true }).click();
  const quickEntry = page.getByRole('dialog', { name: '予定・記録の追加', exact: true });
  await quickEntry.getByRole('tab', { name: '記録', exact: true }).click();
  await quickEntry.getByRole('textbox', { name: 'タイトル', exact: true }).fill(seeded.plan.title);
  await quickEntry.getByLabel('開始時刻', { exact: true }).fill('09:00');
  await quickEntry.getByRole('button', { name: '30分', exact: true }).click();
  await quickEntry.getByRole('textbox', { name: 'メモ', exact: true }).fill('Quick Entry pending save');
  const candidate = quickEntry.locator('.standalone-link-candidate').filter({ hasText: seeded.plan.title });
  const before = await repoSnapshot(page);
  const storageBefore = await durableWrites(page);
  const durableBefore = await durable(page);
  const scheduleBefore = await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'));
  await page.evaluate(() => window.__plannerRecoveryRepository.holdNextActualDispatch());
  try {
    // Save, Close, open, and delete all use visible production UI, not the hook
    // driver. The only control after setup is the external persistence hold.
    await candidate.getByRole('button', { name: 'この予定に紐づけて保存', exact: true }).click();
    await expect.poll(async () => (await repoSnapshot(page)).pendingActualDispatches).toBe(1);
    await expect.poll(async () => (await hookSnapshot(page)).actuals.length).toBe(1);
    const optimistic = (await hookSnapshot(page)).actuals[0];
    expect(optimistic).toMatchObject({ planId: seeded.plan.id, occurrenceDate: E2E_TODAY, note: 'Quick Entry pending save' });
    expect(await durable(page)).toEqual(durableBefore);
    expect(await durableWrites(page)).toEqual(storageBefore);
    expect((await repoSnapshot(page)).calls.slice(before.calls.length)).toEqual([
      { method: 'upsertActualWithMaterialProgress', phase: 'called' },
    ]);
    await quickEntry.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(quickEntry).toHaveCount(0);
    const actualBlock = page.locator('.timeline-actual-block').filter({ hasText: seeded.plan.title });
    await actualBlock.click();
    const actions = page.getByRole('dialog', { name: `${seeded.plan.title}の操作`, exact: true });
    const openRecord = actions.getByRole('button', { name: '記録を編集 実際の内容を保存', exact: true });
    await expect(openRecord).toBeDisabled();
    await expect(actions.getByRole('alert')).toContainText('保存・更新中');
    await expect(page.locator('.actual-editor-card')).toHaveCount(0);
    const heldCalls = (await repoSnapshot(page)).calls;
    await actions.getByRole('button', { name: '削除 この予定を削除', exact: true }).click();
    // Identical busy feedback is shown once; unchanged repository calls and
    // durable bytes below independently prove the Plan deletion was rejected.
    await expect(actions.getByRole('alert').filter({ hasText: '保存・更新中' })).toHaveCount(1);
    await expect(actions).toBeVisible();
    await expect(actions.getByRole('button', { name: '削除 この予定を削除', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toHaveCount(0);
    expect((await repoSnapshot(page)).calls).toEqual(heldCalls);
    expect(await durableWrites(page)).toEqual(storageBefore);
    expect(await durable(page)).toEqual(durableBefore);
    expect((await hookSnapshot(page)).plans.map(plan => plan.id)).toEqual([seeded.plan.id]);
    expect((await hookSnapshot(page)).actuals.map(actual => actual.id)).toEqual([optimistic.id]);
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'))).toEqual(scheduleBefore);

    const busyExplanation = actions.getByRole('alert').filter({ hasText: '保存・更新中' }).last();
    await busyExplanation.scrollIntoViewIfNeeded();
    await expect(busyExplanation).toBeVisible();
    const geometry = await busyExplanation.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { viewport: { width: innerWidth, height: innerHeight },
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        explanation: { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height } };
    });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.explanation.width).toBeGreaterThan(0);
    expect(geometry.explanation.height).toBeGreaterThan(0);
    expect(geometry.explanation.x).toBeGreaterThanOrEqual(-1);
    expect(geometry.explanation.y).toBeGreaterThanOrEqual(-1);
    expect(geometry.explanation.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
    expect(geometry.explanation.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
    const blockedScreenshot = testInfo.outputPath(`actual-pending-${viewport}-${theme}.png`);
    await page.screenshot({ path: blockedScreenshot });
    await testInfo.attach(`Actual busy explanation ${viewport}-${theme}`, { path: blockedScreenshot, contentType: 'image/png' });
    await testInfo.attach(`Actual busy geometry ${viewport}-${theme}`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });

    expect(await page.evaluate(() => window.__plannerRecoveryRepository.releaseActualDispatch())).toBe(true);
    await expect(openRecord).toBeEnabled();
    await expect.poll(async () => (await durable(page)).actuals).toEqual([
      expect.objectContaining({ id: optimistic.id, planId: seeded.plan.id, note: 'Quick Entry pending save' }),
    ]);
    await openRecord.click();
    const editor = page.locator('.actual-editor-card');
    await expect(editor).toBeVisible();
    await editor.getByRole('textbox', { name: 'ズレの理由・メモ', exact: true }).fill('Edited after pending save settled');
    await editor.getByRole('button', { name: '記録保存', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await durable(page)).actuals).toEqual([
      expect.objectContaining({ id: optimistic.id, planId: seeded.plan.id, note: 'Edited after pending save settled' }),
    ]);
    await actualBlock.click();
    await openRecord.click();
    const confirmation = page.waitForEvent('dialog').then(async dialog => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toBe('この記録を削除しますか？');
      await dialog.accept();
    });
    await Promise.all([confirmation, editor.getByRole('button', { name: '記録削除', exact: true }).click()]);
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await durable(page)).actuals).toEqual([]);
    await expect.poll(async () => (await hookSnapshot(page)).actuals).toEqual([]);
    await expect(actualBlock).toHaveCount(0);
    expect(writeMethods(await repoSnapshot(page)).slice(writeMethods(before).length)).toEqual([
      'upsertActualWithMaterialProgress', 'upsertActualWithMaterialProgress', 'deleteActual',
    ]);
    const trace = (await repoSnapshot(page)).calls.slice(before.calls.length);
    await testInfo.attach('pending Actual dispatch then allowed edit-delete', {
      body: JSON.stringify(trace, null, 2), contentType: 'application/json',
    });
    expect((await durable(page)).materials).toEqual(durableBefore.materials);
    expect(await page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'))).toEqual(scheduleBefore);
    expect(await runtimeCalls(page)).toEqual([]);
    const storedBeforeReload = await page.evaluate(() => ({
      actuals: localStorage.getItem('studyplanner.actuals'),
      scheduleEvents: localStorage.getItem('studyplanner.scheduleEvents.v1'),
    }));
    await page.evaluate(() => window.__plannerRecoveryRepository.preserveNextReload());
    await page.reload();
    await page.waitForFunction(() => typeof window.__plannerRecoveryHook?.snapshot === 'function');
    await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem('studyplanner.e2e.preserve-next-reload'))).toBeNull();
    expect(await page.evaluate(() => ({
      actuals: localStorage.getItem('studyplanner.actuals'),
      scheduleEvents: localStorage.getItem('studyplanner.scheduleEvents.v1'),
    }))).toEqual(storedBeforeReload);
    expect((await durable(page)).actuals).toEqual([]);
    expect((await hookSnapshot(page)).actuals).toEqual([]);
    expect((await hookSnapshot(page)).plans.map(plan => plan.id)).toEqual([seeded.plan.id]);
    expect(writeMethods(await repoSnapshot(page)).filter(method =>
      ['upsertActualWithMaterialProgress', 'deleteActual', 'deletePlanWithDependents'].includes(method))).toEqual([]);
    expect(await durableWrites(page)).toEqual([]);
    await navigate(page, '予定');
    await page.getByRole('tab', { name: '日', exact: true }).click();
    await expect(page.locator('.timeline-actual-block')).toHaveCount(0);
    await expect(page.locator('.timeline-plan-block').filter({ hasText: seeded.plan.title })).toBeVisible();
    expect(await runtimeCalls(page)).toEqual([]);
  } finally {
    await page.evaluate(() => window.__plannerRecoveryRepository.releaseActualDispatch());
  }
});
}

// Issue456: one shared Home/Study Session body at two complementary surfaces.
// The pre-dispatch gate models remote latency outside the native-local queue;
// this does not assert live Firebase timing or all-client transaction safety.
const materialAdmissionCallCount = async page => calledMethods(await repoSnapshot(page))
  .filter(method => method === 'upsertActualWithMaterialProgress').length;

const materialReloadTimetableKeys = ['studyplanner.scheduleTemplates.v1',
  'studyplanner.timetableTerms.v1', 'studyplanner.timetablePeriods.v1'];
const readMaterialReloadTimetable = page => page.evaluate(keys => Object.fromEntries(
  keys.map(key => [key, localStorage.getItem(key)])), materialReloadTimetableKeys);

async function observeMaterialAdmissionReload(page) {
  const before = await readMaterialReloadTimetable(page);
  await page.addInitScript(keys => {
    const watched = new Set(keys);
    const writes = window.__materialAdmissionReloadTimetableWrites = [];
    // Installed before the harness/App on the NEXT load only. The normal
    // fixture already observes Actual/material writes; include timetable
    // attempts here so an allowed method call cannot hide physical rewrites.
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        if (this === localStorage && (method === 'clear' || watched.has(String(args[0])))) {
          writes.push({ method, args });
        }
        return original.apply(this, args);
      };
    }
  }, materialReloadTimetableKeys);
  return before;
}

async function expectMaterialAdmissionReloadWithoutReplay(page, timetableBefore) {
  // Bootstrap always invokes normalization. A previously normalized timetable
  // yields a no-op; it must not be confused with replaying a user mutation.
  // Keep the complete mutation-call allowlist exact, not a broad filter.
  expect(writeMethods(await repoSnapshot(page))).toEqual(['applyTimetableMutation']);
  expect(await materialAdmissionCallCount(page)).toBe(0);
  expect(await durableWrites(page)).toEqual([]);
  expect(await page.evaluate(() => window.__materialAdmissionReloadTimetableWrites)).toEqual([]);
  expect(await readMaterialReloadTimetable(page)).toEqual(timetableBefore);
}

async function inspectMaterialAdmissionDraft(page, testInfo, label, record) {
  const explanation = record.getByRole('alert');
  const save = record.getByRole('button', { name: '記録を保存', exact: true });
  await save.scrollIntoViewIfNeeded();
  await expect(explanation).toBeVisible();
  await expect(save).toBeEnabled();
  const boxes = await Promise.all([explanation, save].map(locator => locator.boundingBox()));
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const path = testInfo.outputPath(`${label}-preserved-material-draft.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(`${label} preserved material draft and retry`, { path, contentType: 'image/png' });
  await testInfo.attach(`${label} draft geometry`, {
    body: JSON.stringify({ viewport, explanation: boxes[0], save: boxes[1] }, null, 2),
    contentType: 'application/json',
  });
}

for (const [viewport, theme] of [['desktop', 'light'], ['mobile', 'dark']]) {
  test(`same-material Study Sessions preserve busy draft, retry from committed progress and reload ${viewport}-${theme}`, async ({ page }, testInfo) => {
    await boot(page, cases.find(item => item.label === viewport && item.theme === theme));
    const plans = await page.evaluate(async date => {
      const userId = window.__plannerRecoveryHook.snapshot().ownerId;
      const plans = await window.__plannerRecoveryRepository.seedMaterialAdmissionPlans({ userId, date });
      await window.__plannerRecoveryHook.refresh();
      return plans;
    }, E2E_TODAY);
    await expect.poll(async () => (await hookSnapshot(page)).plans)
      .toEqual(plans.map(plan => expect.objectContaining(plan)));
    const initial = await hookSnapshot(page);
    const nextPlan = page.locator('[data-home-section="next-plan"]');
    await expect(nextPlan.getByRole('heading', { name: plans[0].title, exact: true })).toBeVisible();
    await nextPlan.getByRole('button', { name: '▶ 学習を開始する', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '学習を開始', exact: true })
      .getByRole('heading', { name: plans[0].title, exact: true })).toBeVisible();
    await page.getByRole('dialog', { name: '学習を開始', exact: true })
      .getByRole('button', { name: 'スタート', exact: true }).click();
    // Move beyond A's planned end with the shared deterministic clock. The
    // one-hour plan avoids a fragile one-minute boot/setup budget; no arbitrary
    // wall-clock delay creates the concurrency schedule.
    await page.clock.fastForward(60 * 60_000);
    await page.getByRole('dialog', { name: '学習中', exact: true })
      .getByRole('button', { name: '終了する', exact: true }).click();
    let record = page.getByRole('dialog', { name: '学習を記録', exact: true });
    await record.getByLabel('進捗', { exact: true }).fill('5');
    await page.evaluate(() => window.__plannerRecoveryRepository.holdNextActualDispatch());
    await record.getByRole('button', { name: '記録を保存', exact: true }).click();
    await expect.poll(async () => (await repoSnapshot(page)).pendingActualDispatches).toBe(1);
    const beforeBusy = await durable(page);
    expect(beforeBusy.actuals).toEqual([]);
    expect(beforeBusy.materials).toEqual([expect.objectContaining({ currentUnit: 10 })]);
    const beforeBusyWrites = await durableWrites(page);
    expect(await materialAdmissionCallCount(page)).toBe(1);
    await record.getByRole('button', { name: '戻る', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('dialog', { name: '学習中', exact: true })
      .getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(nextPlan.getByRole('heading', { name: plans[1].title, exact: true })).toBeVisible();
    await nextPlan.getByRole('button', { name: '▶ 学習を開始する', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '学習を開始', exact: true })
      .getByRole('heading', { name: plans[1].title, exact: true })).toBeVisible();
    await page.getByRole('dialog', { name: '学習を開始', exact: true })
      .getByRole('button', { name: 'スタート', exact: true }).click();
    await page.clock.fastForward(60_000);
    await page.getByRole('dialog', { name: '学習中', exact: true })
      .getByRole('button', { name: '終了する', exact: true }).click();
    record = page.getByRole('dialog', { name: '学習を記録', exact: true });
    const progress = record.getByLabel('進捗', { exact: true });
    const note = record.getByPlaceholder('つまずいた点や気づき');
    await progress.fill('7');
    await note.fill('先の保存を待って、この入力で再試行する');
    await record.getByRole('button', { name: '記録を保存', exact: true }).click();
    await expect(record.getByRole('alert')).toContainText('保存・更新中');
    await expect(progress).toHaveValue('7');
    await expect(note).toHaveValue('先の保存を待って、この入力で再試行する');
    expect(await materialAdmissionCallCount(page)).toBe(1);
    expect(await durable(page)).toEqual(beforeBusy);
    expect(await durableWrites(page)).toEqual(beforeBusyWrites);
    await inspectMaterialAdmissionDraft(page, testInfo, `${viewport}-${theme}-busy`, record);

    expect(await page.evaluate(() => window.__plannerRecoveryRepository.releaseActualDispatch())).toBe(true);
    await expect.poll(async () => (await hookSnapshot(page)).materials[0].currentUnit).toBe(15);
    await expect.poll(async () => (await durable(page)).actuals.length).toBe(1);
    // A's late success must neither close B's newly launched session nor consume
    // its +7 intent. Only this next explicit user click creates the second write.
    await expect(record).toBeVisible();
    await expect(progress).toHaveValue('7');
    await expect(note).toHaveValue('先の保存を待って、この入力で再試行する');
    expect(await materialAdmissionCallCount(page)).toBe(1);
    await record.getByRole('button', { name: '記録を保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => (await durable(page)).materials[0].currentUnit).toBe(22);
    const saved = await durable(page);
    expect(saved.actuals).toHaveLength(2);
    expect(saved.actuals.map(actual => actual.planId).sort()).toEqual(plans.map(plan => plan.id).sort());
    expect(saved.actuals.find(actual => actual.planId === plans[1].id).note)
      .toBe('先の保存を待って、この入力で再試行する');
    expect(await materialAdmissionCallCount(page)).toBe(2);
    const lifetime = await hookSnapshot(page);
    expect({ mounts: lifetime.mounts, unmounts: lifetime.unmounts })
      .toEqual({ mounts: initial.mounts, unmounts: initial.unmounts });
    const timetableBeforeReload = await observeMaterialAdmissionReload(page);
    await page.evaluate(() => window.__plannerRecoveryRepository.preserveNextReload());
    await page.reload();
    await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
    await expect.poll(async () => (await hookSnapshot(page)).actuals).toEqual(saved.actuals);
    expect((await hookSnapshot(page)).materials).toEqual(saved.materials);
    expect(await durable(page)).toEqual(saved);
    await expectMaterialAdmissionReloadWithoutReplay(page, timetableBeforeReload);
    expect(await runtimeCalls(page)).toEqual([]);
  });
}

// A distinct absolute-edit boundary, sampled once rather than multiplying the
// Home race matrix. The standalone +5 is driven via the existing public-hook
// fixture; Bookshelf edits and deliberate retry use the real visible controls.
test('Bookshelf preserves an absolute draft through equal reread, busy and stale rejection; reopening saves deliberately desktop-light', async ({ page }, testInfo) => {
  await boot(page, cases.find(item => item.label === 'desktop' && item.theme === 'light'));
  await navigate(page, '教材');
  const openEditor = async () => {
    await page.getByRole('button', { name: '更新前の教材のメニュー', exact: true }).first().click();
    await page.getByRole('button', { name: '教材情報・進捗を編集', exact: true }).click();
    await expect(page.getByRole('heading', { name: '教材を編集', exact: true })).toBeVisible();
    return page.locator('form').filter({ has: page.getByRole('heading', { name: '教材を編集', exact: true }) });
  };
  let editor = await openEditor();
  await editor.getByPlaceholder('黄色チャート').fill('残す教材の入力');
  await editor.getByLabel('現在位置', { exact: true }).fill('12');
  const unchanged = await durable(page);
  await page.evaluate(() => window.__plannerRecoveryHook.refresh());
  await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
  await expect(editor.getByPlaceholder('黄色チャート')).toHaveValue('残す教材の入力');
  await expect(editor.getByLabel('現在位置', { exact: true })).toHaveValue('12');
  // Equal rereads are covered for successful Save/Delete in the component
  // contract. Here the same still-open draft then encounters an actual change.
  expect(await durable(page)).toEqual(unchanged);
  await page.evaluate(() => {
    window.__plannerRecoveryRepository.holdNextActualDispatch();
    window.__plannerRecoveryHook.startActual();
  });
  await expect.poll(async () => (await repoSnapshot(page)).pendingActualDispatches).toBe(1);
  const writesBefore = writeMethods(await repoSnapshot(page));
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.locator('.inline-error')).toContainText('保存・更新中');
  expect(writeMethods(await repoSnapshot(page))).toEqual(writesBefore);
  expect(await durable(page)).toEqual(unchanged);
  expect(await page.evaluate(() => window.__plannerRecoveryRepository.releaseActualDispatch())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook.saveComplete)).toBe(true);
  expect(await page.evaluate(() => window.__plannerRecoveryHook.saveError)).toBeNull();
  await expect.poll(async () => (await hookSnapshot(page)).materials[0].currentUnit).toBe(15);
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.locator('.inline-error')).toContainText('開き直');
  await expect(editor.getByPlaceholder('黄色チャート')).toHaveValue('残す教材の入力');
  await expect(editor.getByLabel('現在位置', { exact: true })).toHaveValue('12');
  expect(writeMethods(await repoSnapshot(page))).toEqual(writesBefore);
  expect((await durable(page)).materials[0].currentUnit).toBe(15);
  const path = testInfo.outputPath('desktop-light-bookshelf-stale-draft.png');
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach('Bookshelf stale draft preserved', { path, contentType: 'image/png' });
  await editor.getByRole('button', { name: 'キャンセル', exact: true }).click();
  editor = await openEditor();
  await expect(editor.getByPlaceholder('黄色チャート')).toHaveValue('更新前の教材');
  await expect(editor.getByLabel('現在位置', { exact: true })).toHaveValue('15');
  await editor.getByLabel('現在位置', { exact: true }).fill('12');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '教材を編集', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await durable(page)).materials[0].currentUnit).toBe(12);
  const saved = await durable(page);
  expect(saved.actuals).toHaveLength(1);
  expect(saved.actuals[0].planId).toBeNull();
  expect(writeMethods(await repoSnapshot(page))).toEqual([...writesBefore, 'upsertStudyMaterial']);
  const timetableBeforeReload = await observeMaterialAdmissionReload(page);
  await page.evaluate(() => window.__plannerRecoveryRepository.preserveNextReload());
  await page.reload();
  await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
  expect(await durable(page)).toEqual(saved);
  expect((await hookSnapshot(page)).materials).toEqual(saved.materials);
  await expectMaterialAdmissionReloadWithoutReplay(page, timetableBeforeReload);
});

for (const operation of ['ordinary Plan save', 'Todo scheduling'])
for (const viewport of cases.filter(item =>
  (item.label === 'desktop' && item.theme === 'light') || (item.label === 'mobile' && item.theme === 'dark'))) {
  test(`${operation} survives refresh and read-only retry ${viewport.label}-${viewport.theme}`, async ({ page }, testInfo) => {
    await boot(page, viewport);
    if (operation === 'Todo scheduling') {
      await page.evaluate(async () => {
        await window.__plannerRecoveryRepository.seedOpenTodo(window.__plannerRecoveryHook.snapshot().ownerId);
        await window.__plannerRecoveryHook.refresh();
      });
      await expect.poll(async () => (await hookSnapshot(page)).todos.length).toBe(1);
    }
    await page.evaluate(({ date, operation }) => {
      const repository = window.__plannerRecoveryRepository;
      const hook = window.__plannerRecoveryHook;
      const draft = { date, title: '再読込と重なった学習予定' };
      if (operation === 'Todo scheduling') {
        repository.holdNextTodoSchedule();
        hook.startTodoSchedule(draft);
      } else {
        repository.holdNextPlanWrite();
        hook.startPlan(draft);
      }
    }, { date: E2E_TODAY, operation });
    await expect.poll(async () => (await repoSnapshot(page)).pendingPlanWrites).toBe(1);
    await page.evaluate(() => window.__plannerRecoveryHook.refresh());
    await expect.poll(async () => (await hookSnapshot(page)).plans).toEqual([]);
    await navigate(page, 'AI計画');
    await composer(page).fill(TEXT);
    await page.evaluate(() => {
      window.__plannerRecoveryRepository.failNextTodoRead();
      window.__plannerRecoveryRepository.releasePlanWrite();
    });
    await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook.saveComplete)).toBe(true);
    expect(await page.evaluate(() => window.__plannerRecoveryHook.saveError)).toBeNull();
    await expect.poll(async () => (await hookSnapshot(page)).recovery?.phase).toBe('failed');
    await expect(retry(page)).toBeVisible();
    expect((await hookSnapshot(page)).ready).toBe(false);
    await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();
    const before = await repoSnapshot(page);
    const writes = await durableWrites(page);
    const readStorage = () => page.evaluate(() => localStorage.getItem('studyplanner.scheduleEvents.v1'));
    const savedBytes = await readStorage();
    expect(savedBytes).toContain('再読込と重なった学習予定');
    const savedTodos = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.todos.v1') ?? '[]'));
    if (operation === 'Todo scheduling') {
      expect(savedTodos[0]).toMatchObject({ status: 'scheduled', scheduledPlanId: expect.any(String) });
      const snapshot = await hookSnapshot(page);
      expect(snapshot.todos[0].status).toBe('open');
      expect(snapshot.plans).toEqual([]);
    }
    await inspectGeometry(page, testInfo, `plan-repair-${viewport.label}-${viewport.theme}`, true);
    await retry(page).click();
    await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
    await expect.poll(async () => (await hookSnapshot(page)).plans.map(plan => plan.title))
      .toEqual(['再読込と重なった学習予定']);
    if (operation === 'Todo scheduling') {
      const snapshot = await hookSnapshot(page);
      expect(snapshot.todos[0]).toMatchObject({ status: 'scheduled', scheduledPlanId: snapshot.plans[0].id });
    }
    expect(calledMethods(await repoSnapshot(page)).slice(calledMethods(before).length).sort())
      .toEqual(['getActuals', 'getPlans', 'getStudyMaterials', 'getTodos']);
    expect(writeMethods(await repoSnapshot(page))).toEqual(writeMethods(before));
    expect(await durableWrites(page)).toEqual(writes);
    expect(await readStorage()).toBe(savedBytes);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.todos.v1') ?? '[]'))).toEqual(savedTodos);
    await expect(composer(page)).toHaveValue(TEXT);
    await expect(page.getByRole('button', { name: '送信', exact: true })).toBeEnabled();
    await expect(recovery(page)).toHaveCount(0);
    await page.evaluate(() => window.__plannerRecoveryRepository.preserveNextReload());
    await page.reload();
    await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
    await expect.poll(async () => (await hookSnapshot(page)).plans.map(plan => plan.title))
      .toEqual(['再読込と重なった学習予定']);
    if (operation === 'Todo scheduling') {
      const snapshot = await hookSnapshot(page);
      expect(snapshot.todos).toEqual(savedTodos);
      expect(snapshot.todos[0]).toMatchObject({ status: 'scheduled', scheduledPlanId: snapshot.plans[0].id });
    }
  });
}

test('native Todo Undo crossing a full read repairs without replay mobile-dark', async ({ page }, testInfo) => {
  await boot(page, cases.find(item => item.label === 'mobile' && item.theme === 'dark'));
  await page.evaluate(async () => {
    await window.__plannerRecoveryRepository.seedOpenTodo(window.__plannerRecoveryHook.snapshot().ownerId);
    await window.__plannerRecoveryHook.refresh();
  });
  await expect.poll(async () => (await hookSnapshot(page)).todos.length).toBe(1);
  const restored = (await hookSnapshot(page)).todos;
  await navigate(page, 'AI計画');
  await composer(page).fill(TEXT);
  await page.evaluate(() => window.__plannerRecoveryHook.deleteTodo('read-repair-todo'));
  await expect.poll(async () => (await hookSnapshot(page)).todos).toEqual([]);
  const undo = page.getByRole('button', { name: '元に戻す', exact: true });
  await expect(undo).toBeVisible();
  await undo.evaluate(button => {
    const refreshing = window.__plannerRecoveryHook.refresh();
    // Full getters have already entered the real local queue. Fail only the
    // later repair, after actual Undo dispatch and successful persistence.
    window.__plannerRecoveryRepository.failNextTodoRead();
    button.click();
    return refreshing;
  });
  await expect.poll(async () => (await hookSnapshot(page)).recovery?.phase).toBe('failed');
  await expect(retry(page)).toBeVisible();
  expect((await hookSnapshot(page)).todos).toEqual([]);
  const readTodos = () => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.todos.v1') ?? '[]'));
  expect(await readTodos()).toEqual(restored);
  const before = await repoSnapshot(page);
  const storageWrites = await durableWrites(page);
  await inspectGeometry(page, testInfo, 'todo-undo-repair-mobile-dark', true);
  await retry(page).click();
  await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
  expect((await hookSnapshot(page)).todos).toEqual(restored);
  expect(calledMethods(await repoSnapshot(page)).slice(calledMethods(before).length).sort())
    .toEqual(['getActuals', 'getPlans', 'getStudyMaterials', 'getTodos']);
  expect(writeMethods(await repoSnapshot(page))).toEqual(writeMethods(before));
  expect(await durableWrites(page)).toEqual(storageWrites);
  expect(await readTodos()).toEqual(restored);
  await expect(composer(page)).toHaveValue(TEXT);
  await expect(recovery(page)).toHaveCount(0);
  await page.evaluate(() => window.__plannerRecoveryRepository.preserveNextReload());
  await page.reload();
  await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
  expect((await hookSnapshot(page)).todos).toEqual(restored);
});

test('native DayNote save crossing full read recovers without resave mobile-dark', async ({ page }, testInfo) => {
  await boot(page, cases.find(item => item.label === 'mobile' && item.theme === 'dark'));
  await navigate(page, 'AI計画');
  await composer(page).fill(TEXT);
  await page.evaluate(date => {
    const refreshing = window.__plannerRecoveryHook.refresh();
    window.__plannerRecoveryRepository.failNextDayNoteRead();
    window.__plannerRecoveryHook.startDayNote({ date, memo: '再読込と重なった日次メモ' });
    return refreshing;
  }, E2E_TODAY);
  await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook.saveComplete)).toBe(true);
  expect(await page.evaluate(() => window.__plannerRecoveryHook.saveError)).toBeNull();
  await expect.poll(async () => (await hookSnapshot(page)).recovery?.phase).toBe('failed');
  expect((await hookSnapshot(page)).dayNotes).toEqual([]);
  expect((await hookSnapshot(page)).ready).toBe(false);
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeDisabled();
  const readNotes = () => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.dayNotes') ?? '[]'));
  const saved = await readNotes();
  expect(saved).toEqual([expect.objectContaining({ quickMemo: '再読込と重なった日次メモ' })]);
  const before = await repoSnapshot(page);
  const storageWrites = await durableWrites(page);
  await inspectGeometry(page, testInfo, 'day-note-repair-mobile-dark', true);
  await retry(page).click();
  await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
  expect((await hookSnapshot(page)).dayNotes).toEqual(saved);
  expect(calledMethods(await repoSnapshot(page)).slice(calledMethods(before).length).sort())
    .toEqual(['getActuals', 'getDayNotes', 'getStudyMaterials']);
  expect(writeMethods(await repoSnapshot(page))).toEqual(writeMethods(before));
  expect(await durableWrites(page)).toEqual(storageWrites);
  expect(await readNotes()).toEqual(saved);
  await expect(composer(page)).toHaveValue(TEXT);
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeEnabled();
  await expect(recovery(page)).toHaveCount(0);
  await page.evaluate(() => window.__plannerRecoveryRepository.preserveNextReload());
  await page.reload();
  await expect.poll(async () => (await hookSnapshot(page)).ready).toBe(true);
  expect((await hookSnapshot(page)).dayNotes).toEqual(saved);
});
