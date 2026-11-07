import { expect, test } from '@playwright/test';
import { answer, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek } from '../support/vnext-production-flows.mjs';

const origin = 'http://127.0.0.1:4176';
const email = 'e2e-conversation-sync@example.test';
async function signIn(page) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(process.env.STUDYPLANNER_LIVE_PASSWORD);
  await page.getByRole('button', { name: 'ログインする' }).click();
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  const tour = page.getByRole('dialog', { name: 'Laplanceの使い方' });
  if (await tour.isVisible()) await tour.getByRole('button', { name: 'スキップ' }).click();
  await page.locator('.primary-bottom-nav').getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(page.locator('.ai-planning-view')).toBeVisible();
}
const sync = page => page.locator('.ai-planning-sync');
async function message(page, text) {
  await page.locator('.ai-planning-composer textarea').fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
}
async function completePlan(request) {
  const reading = await nextCall(request);
  expect(reading.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, reading, { planningIntent: 'create_plan', conversationActs: [], answer: null,
    delta: { add: [
      { kind: 'task', localId: 'math', category: 'study', title: '数学' },
      { kind: 'workload', localId: 'minutes', taskRef: { localId: 'math' }, componentRef: null,
        quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null },
    ], patch: [], remove: [], relate: [], defer: [] } });
  const render = await nextCall(request); expect(render.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  await answer(request, render, rendererReply(render));
}
async function answerAddedTask(request, reading, title) {
  expect(reading.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, reading, { planningIntent: 'discuss', conversationActs: [], answer: null,
    delta: { add: [
      { kind: 'task', localId: 'added-task', category: 'study', title },
      { kind: 'workload', localId: 'added-minutes', taskRef: { localId: 'added-task' }, componentRef: null,
        quantityRole: 'target', amount: 30, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null },
    ], patch: [], remove: [], relate: [], defer: [] } });
  const renderer = await nextCall(request);
  expect(renderer.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  await answer(request, renderer, rendererReply(renderer));
}
async function inspect(page) {
  return page.evaluate(async () => {
    const uidKey = Object.keys(localStorage).find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.') && !key.endsWith('.anonymous'));
    const uid = uidKey?.slice('studyplanner.aiPlanning.chats.v1.'.length);
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('laplance-conversation-sync-v1');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const request = db.transaction('sessions').objectStore('sessions').index('owner').getAll(uid);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    db.close();
    return { uid, index: JSON.parse(localStorage.getItem(uidKey)), rows };
  });
}

test('real UI opts in, restores across independent devices and reloads, with no implicit Plan/Actual save', async ({ page, browser, request }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page); await goToTargetPlannerWeek(page);
  await expect(sync(page)).toHaveAttribute('data-sync-state', 'disabled');
  await message(page, '数学を60分、この条件で予定を作ってください。'); await completePlan(request);
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
  await page.getByRole('button', { name: '端末間同期を有効にする' }).click();
  await page.getByRole('button', { name: '同意して同期する', exact: true }).click();
  await expect(sync(page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 20_000 });
  const a = await inspect(page);
  expect(a.rows).toHaveLength(1); expect(a.rows[0].pending).toBeNull();
  expect(JSON.parse(a.rows[0].working.core).vnext.state.graph.tasks[0].title).toBe('数学');
  const sourceCore = a.rows[0].working.core;
  const state = await page.context().storageState();
  // Only onboarding flags are shared: neither Auth, local conversation bytes nor IndexedDB is cloned.
  const newState = { cookies: [], origins: state.origins.map(item => ({ origin: item.origin,
    localStorage: item.localStorage.filter(row => row.name.startsWith('laplance-first-run-tour-v1:')) })) };
  const second = await browser.newContext({ baseURL: origin, timezoneId: 'Asia/Tokyo', viewport: { width: 390, height: 844 }, storageState: newState });
  try {
    const other = await second.newPage(); other.on('pageerror', error => errors.push(error.message));
    await signIn(other);
    await expect(sync(other)).toHaveAttribute('data-sync-state', 'synced', { timeout: 20_000 });
    await expect(other.locator('.ai-planning-message-row.user .ai-planning-bubble')).toContainText('数学を60分');
    await expect(other.locator('.ai-planning-plan-card')).toBeVisible();
    const b = await inspect(other);
    expect(b.index.activeChatId).toBe(a.index.activeChatId); expect(b.rows[0].working.core).toBe(sourceCore);
    // Exclusive write ownership inside one browser account: no simultaneous-tab local lost update.
    const tab = await second.newPage(); await tab.goto('/');
    await tab.locator('.primary-bottom-nav').getByRole('button', { name: 'AI計画', exact: true }).click();
    // The account bootstrap may remount the older tab, so either tab can hold the lease.
    // The invariant is exactly one writable replica, not that the newest tab must lose.
    await other.locator('.primary-bottom-nav').getByRole('button', { name: 'AI計画', exact: true }).click();
    await expect.poll(async () => (await Promise.all([sync(tab).getAttribute('data-sync-state'),
      sync(other).getAttribute('data-sync-state')])).sort()).toEqual(['locked', 'synced']);
    const locks = await tab.evaluate(() => navigator.locks.query());
    expect(locks.held.filter(lock => lock.name.startsWith('laplance-conversation-sync:'))).toHaveLength(1);
    await tab.close();
    if (await sync(other).getAttribute('data-sync-state') === 'locked') await other.getByRole('button', { name: '同期を再試行' }).click();
    await expect(sync(other)).toHaveAttribute('data-sync-state', 'synced', { timeout: 20_000 });
    // A synced replica remains available when offline and reloaded, then reconnects idempotently.
    await second.setOffline(true);
    await expect(other.locator('.ai-planning-message-row.user .ai-planning-bubble')).toContainText('数学を60分');
    await second.setOffline(false);
    await other.reload();
    await other.locator('.primary-bottom-nav').getByRole('button', { name: 'AI計画', exact: true }).click();
    await other.getByRole('button', { name: /会話を更新|同期を再試行/ }).click();
    await expect(sync(other)).toHaveAttribute('data-sync-state', 'synced', { timeout: 20_000 });
    const after = await inspect(other); expect(after.rows[0].working.core).toBe(sourceCore);
    for (const collection of ['plans', 'schedule_events', 'actuals']) {
      const response = await request.post('http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents:runQuery', {
        headers: { Authorization: 'Bearer owner' }, data: { structuredQuery: { from: [{ collectionId: collection }],
          where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: a.uid } } } } },
      });
      expect(response.ok()).toBe(true); expect((await response.json()).filter(row => row.document)).toEqual([]);
    }
    // Both editors start from the same accepted version. B's Firestore connection drops,
    // while the existing AI gateway remains online; its edits are durable but not shared.
    expect((await inspect(other)).rows[0].confirmed.revision).toBe((await inspect(page)).rows[0].confirmed.revision);
    await second.setOffline(true);
    await second.route('http://127.0.0.1:8180/**', route => route.abort('internetdisconnected'));
    await second.setOffline(false);
    await message(other, '化学も30分あります。');
    await answerAddedTask(request, await nextCall(request), '化学');
    await expect.poll(async () => (await inspect(other)).rows[0].working.core).toContain('化学');
    await page.getByRole('button', { name: /会話を更新|同期を再試行/ }).click();
    await expect(sync(page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 20_000 });
    await message(page, '英語も30分あります。');
    await answerAddedTask(request, await nextCall(request), '英語');
    await expect.poll(async () => (await inspect(page)).rows[0].confirmed?.payload?.core).toContain('英語');
    const acceptedA = await inspect(page);
    await second.unroute('http://127.0.0.1:8180/**');
    await other.getByRole('button', { name: /会話を更新|同期を再試行/ }).click();
    await expect(sync(other)).toHaveAttribute('data-sync-state', 'conflict', { timeout: 20_000 });
    const conflict = await inspect(other);
    expect(JSON.parse(conflict.rows[0].working.core).vnext.state.graph.tasks.map(task => task.title)).toContain('化学');
    expect(JSON.parse(conflict.rows[0].conflict.payload.core).vnext.state.graph.tasks.map(task => task.title)).toContain('英語');
    await other.getByText('両方の内容を確認', { exact: true }).click();
    await other.screenshot({ path: testInfo.outputPath('mobile-conflict.png'), fullPage: true });
    other.once('dialog', dialog => dialog.accept());
    await other.getByRole('button', { name: '別端末の内容で続ける', exact: true }).click();
    await expect(sync(other)).toHaveAttribute('data-sync-state', 'synced', { timeout: 20_000 });
    expect((await inspect(other)).rows[0].working.core).toBe(acceptedA.rows[0].working.core);
    await other.screenshot({ path: testInfo.outputPath('mobile-sync.png'), fullPage: true });
  } finally { await second.close(); }
  await page.screenshot({ path: testInfo.outputPath('desktop-sync.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('pending edits reach the other device exactly once after reconnect without a competing edit', async ({ page, browser, request }) => {
  const firstMessage = '再接続確認の数学を60分予定にしてください。';
  const edit = '地理も30分あります。';
  await signIn(page);
  await expect(sync(page)).toHaveAttribute('data-sync-state', /disabled|synced/);
  // Synced sessions live in IndexedDB, so a fresh device has no legacy .ui
  // localStorage key for the week helper. Use the hydrated chat index instead.
  let plannerWeek = null;
  if (await sync(page).getAttribute('data-sync-state') === 'synced') {
    const { index } = await inspect(page);
    plannerWeek = index.chats.find(chat => chat.id === index.activeChatId)?.weekStartDate;
  }
  await goToTargetPlannerWeek(page, { plannerWeek });
  // A separate chat keeps this case independent of the preceding conflict case.
  await page.getByLabel('チャット一覧を開く').click();
  await page.getByRole('button', { name: '新しいチャット', exact: true }).click();
  await expect(page.locator('.ai-planning-message-row')).toHaveCount(0);
  await message(page, firstMessage); await completePlan(request);
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
  if (await sync(page).getAttribute('data-sync-state') === 'disabled') {
    await page.getByRole('button', { name: '端末間同期を有効にする' }).click();
    await page.getByRole('button', { name: '同意して同期する', exact: true }).click();
  }
  await expect(sync(page)).toHaveAttribute('data-sync-state', 'synced', { timeout: 20_000 });
  await expect.poll(async () => {
    const current = await inspect(page);
    const row = current.rows.find(item => item.scope.chatId === current.index.activeChatId);
    return Boolean(row && !row.pending && !row.dirty && row.confirmed?.payload?.core?.includes('数学'));
  }, { timeout: 20_000 }).toBe(true);
  const a = await inspect(page);
  const baseline = a.rows.find(row => row.scope.chatId === a.index.activeChatId);
  expect(baseline.confirmed).not.toBeNull(); expect(baseline.pending).toBeNull();
  const record = async device => (await inspect(device)).rows.find(row =>
    row.scope.chatId === baseline.scope.chatId && row.scope.weekStartDate === baseline.scope.weekStartDate);
  const state = await page.context().storageState();
  const second = await browser.newContext({ baseURL: origin, timezoneId: 'Asia/Tokyo', storageState: {
    cookies: [], origins: state.origins.map(item => ({ origin: item.origin,
      localStorage: item.localStorage.filter(row => row.name.startsWith('laplance-first-run-tour-v1:')) })),
  } });
  try {
    const other = await second.newPage();
    await signIn(other);
    await expect(sync(other)).toHaveAttribute('data-sync-state', 'synced', { timeout: 20_000 });
    await other.getByLabel('チャット一覧を開く').click();
    await other.locator('.ai-chat-list').getByText(firstMessage, { exact: true }).click();
    await expect(other.locator('.ai-planning-message-row.user .ai-planning-bubble')).toHaveText([firstMessage]);
    expect((await record(other)).confirmed.revision).toBe(baseline.confirmed.revision);

    // Interrupt only B's transaction commit for this conversation. Auth, reads,
    // the synthetic AI and A's connection keep using their real emulator paths.
    const document = `projects/demo-studyplanner/databases/(default)/documents/weekly_planning_conversations/${a.uid}/sessions/${baseline.scope.chatId}.${baseline.scope.weekStartDate}`;
    const firestore = 'http://127.0.0.1:8180/**';
    let blockedCommits = 0;
    await second.route(firestore, route => {
      const outgoing = route.request();
      if (outgoing.method() === 'POST' && new URL(outgoing.url()).pathname.endsWith('/documents:commit')
        && outgoing.postDataJSON()?.writes?.some(write => write.update?.name === document)) {
        blockedCommits++;
        return route.abort('internetdisconnected');
      }
      return route.continue();
    });
    await message(other, edit);
    await answerAddedTask(request, await nextCall(request), '地理');
    await expect.poll(() => blockedCommits, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(async () => Boolean((await record(other))?.pending)).toBe(true);
    await expect.poll(async () => (await record(other))?.working?.core).toContain('地理');
    // A makes no edit and retains the accepted baseline while B cannot send.
    expect((await record(page)).confirmed.revision).toBe(baseline.confirmed.revision);
    await expect(page.locator('.ai-planning-message-row.user .ai-planning-bubble').filter({ hasText: edit })).toHaveCount(0);

    await second.unroute(firestore);
    await other.getByRole('button', { name: /会話を更新|同期を再試行/ }).click();
    await expect.poll(async () => {
      const row = await record(other);
      return Boolean(row && !row.pending && !row.dirty && row.confirmed?.payload?.core?.includes('地理'));
    }, { timeout: 20_000 }).toBe(true);
    await expect(sync(other)).toHaveAttribute('data-sync-state', 'synced');
    const delivered = await record(other);
    expect(delivered.blocked).toBeNull();
    expect(delivered.confirmed.revision).toBeGreaterThan(baseline.confirmed.revision);

    await page.getByRole('button', { name: /会話を更新|同期を再試行/ }).click();
    await expect.poll(async () => (await record(page))?.confirmed?.revision, { timeout: 20_000 })
      .toBe(delivered.confirmed.revision);
    await expect(page.locator('.ai-planning-message-row.user .ai-planning-bubble').filter({ hasText: edit })).toHaveCount(1);
    const restored = await record(page);
    expect(restored.pending).toBeNull(); expect(restored.blocked).toBeNull();
    expect(restored.working.core).toBe(delivered.confirmed.payload.core);
    expect(JSON.parse(restored.working.core).vnext.state.graph.tasks.filter(task => task.title === '地理')).toHaveLength(1);
  } finally { await second.close(); }
});
