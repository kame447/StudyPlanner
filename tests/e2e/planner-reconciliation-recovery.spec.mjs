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
