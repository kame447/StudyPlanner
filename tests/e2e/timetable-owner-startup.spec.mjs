import { expect, test } from './support/fixed-clock.mjs';
import {
  FOREIGN_OWNER, FOREIGN_PERIODS, FOREIGN_TEMPLATES, FOREIGN_TERMS, LEGACY_TERM_ID,
  OWNER_TEMPLATES, PRESERVE_TIMETABLE_RELOAD, TIMETABLE_OWNER, TIMETABLE_STORAGE_KEYS,
} from './harness/timetableOwnerSeed.fixture.mjs';

const HARNESS_URL = 'http://127.0.0.1:4174/timetable-owner-startup.html';
const canonicalTermId = `timetable-term:${Buffer.from(TIMETABLE_OWNER.id, 'utf8').toString('base64url')}:2026-full-year`;
const hookSnapshot = page => page.evaluate(() => window.__plannerRecoveryHook?.snapshot?.() ?? { ready: false });
const repositorySnapshot = page => page.evaluate(() => window.__plannerRecoveryRepository.snapshot());
const rawTimetable = page => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), TIMETABLE_STORAGE_KEYS);
const readTimetable = raw => ({
  terms: JSON.parse(raw[TIMETABLE_STORAGE_KEYS[0]]),
  templates: JSON.parse(raw[TIMETABLE_STORAGE_KEYS[1]]),
  periods: JSON.parse(raw[TIMETABLE_STORAGE_KEYS[2]]),
});
const navigate = (page, name) => page.getByRole('navigation', { name: '主要ナビゲーション' })
  .getByRole('button', { name, exact: true }).click();
const timetableWrites = page => page.evaluate(() => structuredClone(window.__timetableOwnerStartup.writes));

function expectForeignRowsUnchanged(state) {
  expect(state.terms.filter(item => item.userId === FOREIGN_OWNER.id)).toEqual(FOREIGN_TERMS);
  expect(state.templates.filter(item => item.userId === FOREIGN_OWNER.id)).toEqual(FOREIGN_TEMPLATES);
  expect(state.periods.filter(item => item.userId === FOREIGN_OWNER.id)).toEqual(FOREIGN_PERIODS);
}

async function expectClassesVisible(page) {
  await expect(page.locator('.timetable-view')).toBeVisible();
  await expect(page.locator('.timetable-period-trigger')).toContainText('2026年 通年');
  await expect(page.locator('.timetable-class-card')).toHaveCount(6);
  for (const template of OWNER_TEMPLATES) {
    await expect(page.locator('.timetable-class-card').getByText(template.title, { exact: true })).toBeVisible();
  }
  await expect(page.locator('.timetable-view')).not.toContainText('別ユーザー');
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// This is real-App/local-repository UI evidence. It does not emulate or prove
// deployed Firestore Rules; the independent Rules model owns that boundary.
test('owner-scoped timetable startup preserves a foreign legacy term and six classes across mobile reload', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  const externalRequests = [];
  // Fail closed even if a future import changes provider selection.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.continue();
    externalRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
    return route.abort();
  });
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => typeof window.__plannerRecoveryHook?.snapshot === 'function');
  await expect.poll(async () => {
    const { ready, ownerId } = await hookSnapshot(page);
    return { ready, ownerId };
  }).toEqual({ ready: true, ownerId: TIMETABLE_OWNER.id });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await hookSnapshot(page)).ownerId).toBe(TIMETABLE_OWNER.id);

  const initialRaw = await page.evaluate(() => window.__timetableOwnerStartup.initial);
  const initial = readTimetable(initialRaw);
  expectForeignRowsUnchanged(initial);
  expect(initial.terms.filter(item => item.userId === TIMETABLE_OWNER.id)).toEqual([]);
  expect(initial.periods.filter(item => item.userId === TIMETABLE_OWNER.id)).toEqual([]);
  expect(initial.templates.filter(item => item.userId === TIMETABLE_OWNER.id)).toEqual(OWNER_TEMPLATES);
  expect(OWNER_TEMPLATES).toHaveLength(6);
  expect(OWNER_TEMPLATES.every(item => item.active && item.termId === LEGACY_TERM_ID)).toBe(true);

  const committedRaw = await rawTimetable(page);
  const committed = readTimetable(committedRaw);
  expectForeignRowsUnchanged(committed);
  const ownerTerms = committed.terms.filter(item => item.userId === TIMETABLE_OWNER.id);
  expect(ownerTerms).toEqual([expect.objectContaining({
    id: canonicalTermId, userId: TIMETABLE_OWNER.id, year: 2026, kind: 'fullYear', isActive: true,
  })]);
  expect(canonicalTermId).not.toBe(LEGACY_TERM_ID);
  expect(new Set(committed.terms.map(term => term.id)).size).toBe(committed.terms.length);
  const ownerTemplates = committed.templates.filter(item => item.userId === TIMETABLE_OWNER.id);
  expect(ownerTemplates).toHaveLength(6);
  for (const before of OWNER_TEMPLATES) {
    const after = ownerTemplates.find(item => item.id === before.id);
    // Every saved field survives; only its owned reference and timestamp change.
    expect(after).toEqual({ ...before, termId: canonicalTermId, updatedAt: expect.any(String) });
  }
  expect(committed.periods.filter(item => item.userId === TIMETABLE_OWNER.id)).toEqual([]);
  const startupWrites = await timetableWrites(page);
  expect(startupWrites.map(write => write.key).sort()).toEqual(TIMETABLE_STORAGE_KEYS.slice(0, 2).sort());
  const startupCalls = (await repositorySnapshot(page)).calls;
  expect(startupCalls.filter(call => call.method === 'applyTimetableMutation' && call.phase === 'returned')).toHaveLength(1);
  expect(startupCalls.filter(call => call.phase === 'rejected' || call.phase === 'failed')).toEqual([]);

  await navigate(page, '時間割');
  await expectClassesVisible(page);
  // The recovered row opens the real editor; closing it must not replay a save.
  await page.getByRole('button', { name: '月曜 1限 数学Iを編集', exact: true }).click();
  const editor = page.locator('.timetable-editor-modal');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('授業名', { exact: true })).toHaveValue(OWNER_TEMPLATES[0].title);
  await editor.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await navigate(page, '予定');
  await expect(page.getByRole('tab', { name: '月', exact: true })).toBeVisible();
  await navigate(page, '時間割');
  await expectClassesVisible(page);
  expect(await rawTimetable(page)).toEqual(committedRaw);
  expect(await timetableWrites(page)).toEqual(startupWrites);

  await page.evaluate(key => sessionStorage.setItem(key, 'true'), PRESERVE_TIMETABLE_RELOAD);
  await page.reload();
  await page.waitForFunction(() => typeof window.__plannerRecoveryHook?.snapshot === 'function');
  await expect.poll(async () => {
    const { ready, ownerId } = await hookSnapshot(page);
    return { ready, ownerId };
  }).toEqual({ ready: true, ownerId: TIMETABLE_OWNER.id });
  expect(await page.evaluate(key => sessionStorage.getItem(key), PRESERVE_TIMETABLE_RELOAD)).toBeNull();
  // Equal bytes before App mounts and after it loads prove no fixture reseed and
  // no durable normalization replay, rather than just another optimistic view.
  expect(await page.evaluate(() => window.__timetableOwnerStartup.initial)).toEqual(committedRaw);
  expect(await rawTimetable(page)).toEqual(committedRaw);
  expect(await timetableWrites(page)).toEqual([]);
  const reloadCalls = (await repositorySnapshot(page)).calls;
  expect(reloadCalls.filter(call => call.phase === 'rejected' || call.phase === 'failed')).toEqual([]);
  await navigate(page, '時間割');
  await expectClassesVisible(page);
  const geometry = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  await expect(page.getByText('時間割データを整合化できませんでした。再読み込みしてください。', { exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(await page.evaluate(() => window.__realWeeklyEvents)).toEqual([]);
  const screenshot = testInfo.outputPath('owner-timetable-mobile-durable-reload.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('Six recovered classes after durable mobile reload', { path: screenshot, contentType: 'image/png' });
  await testInfo.attach('Owner separation and durable reload evidence', {
    body: JSON.stringify({ scope: 'real App + local repository; not live Firestore Rules',
      initial, committed, startupWrites, startupCalls, reloadCalls, geometry }, null, 2),
    contentType: 'application/json',
  });
});
