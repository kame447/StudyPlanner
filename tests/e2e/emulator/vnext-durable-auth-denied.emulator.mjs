import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { answerScriptedTurn } from '../support/synthetic-provider-client.mjs';
import { attachWriteLedger } from '../support/vnext-firestore-writes.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { openScheduleDay } from '../support/schedule-plan-cleanup.mjs';

// A RED checkout may point P4_ORACLE_ROOT at the fixed product source.
let DENIED;
test.beforeAll(async () => {
  const root = process.env.P4_ORACLE_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
  const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom' });
  try {
    const product = await server.ssrLoadModule('/src/features/weeklyPlanning/application/weeklyPlanningDurableAccessDeniedError.ts');
    const ErrorType = product.WeeklyPlanningDurableAccessDeniedError;
    expect(ErrorType).toEqual(expect.any(Function));
    DENIED = new ErrorType(403).userMessage;
  } finally {
    await server.close();
  }
});
const AUTH = 'http://127.0.0.1:9199';
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const SYNTHETIC = 'http://127.0.0.1:18790';
const ownerHeaders = { Authorization: 'Bearer owner' }; // Emulator administrator only; never sent to the app or Worker.
const email = () => test.info().project.metadata.email;
const password = () => process.env.STUDYPLANNER_LIVE_PASSWORD;
const composer = page => page.locator('.ai-planning-composer textarea');
const assistant = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');

async function signIn(page) {
  await page.goto('/');
  const nav = page.locator('.primary-bottom-nav');
  const tab = page.getByRole('tab', { name: 'ログイン', exact: true });
  await expect(nav.or(tab).first()).toBeVisible();
  if (await tab.isVisible()) {
    await tab.click();
    await page.getByLabel('メールアドレス').fill(email());
    await page.getByLabel('パスワード', { exact: true }).fill(password());
    await page.getByRole('button', { name: 'ログインする' }).click();
  }
  await expect(nav).toBeVisible();
}

async function setEmailVerified(request, userId, emailVerified) {
  const response = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-studyplanner/accounts:update`,
    { headers: ownerHeaders, data: { localId: userId, emailVerified } });
  expect(response.ok(), `Auth emulator account update: ${response.status()}`).toBe(true);
  expect((await response.json()).emailVerified).toBe(emailVerified);
}

async function ownerDocuments(request, userId) {
  const documents = [];
  for (const collection of ['plans', 'schedule_events', 'actuals', 'weekly_planning_approval_operations', 'weekly_planning_approval_items']) {
    // Query the owner directly, including nested approval items: a bounded list
    // of the first page of all users could miss this account's documents.
    const response = await request.post(`${FIRESTORE}:runQuery`, { headers: ownerHeaders, data: { structuredQuery: {
      from: [{ collectionId: collection, allDescendants: true }],
      where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: userId } } },
    } } });
    expect(response.ok(), `Firestore emulator ${collection}`).toBe(true);
    for (const { document: doc } of await response.json()) {
      if (doc) documents.push({ name: doc.name, fields: doc.fields });
    }
  }
  return documents.sort((a, b) => a.name.localeCompare(b.name));
}

async function previewSnapshot(page, userId) {
  return page.evaluate(owner => {
    const index = JSON.parse(localStorage.getItem(`studyplanner.aiPlanning.chats.v1.${owner}`) ?? 'null');
    const active = index?.activeChatId;
    const keys = Object.keys(localStorage).filter(key => key.startsWith(`studyplanner.weeklyPlanning.vnext.${owner}.`)
      && key.endsWith(`.${active}.ui`));
    const states = keys.map(key => JSON.parse(localStorage.getItem(key)).payload.state);
    const candidates = states.filter(state => (state.previewCandidates ?? []).length > 0);
    return { active, candidates: candidates.map(state => state.previewCandidates),
      drafts: states.flatMap(state => state.draftBlocks ?? []) };
  }, userId);
}

async function scriptedTurn(page, request, text, turn) {
  const pending = answerScriptedTurn(request, turn);
  pending.catch(() => undefined);
  const baseline = await assistant(page).count();
  await composer(page).fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => assistant(page).count(), { timeout: 120_000 }).toBeGreaterThan(baseline);
  await expect(composer(page)).toBeEnabled({ timeout: 60_000 });
  await pending;
}

test('real durable Worker 403 preserves the conversation and accepts a turn after re-login', async ({ page, request }) => {
  test.setTimeout(420_000);
  const userId = await emulatorUserId(request, { email: email(), password: password() });
  const firestore = attachWriteLedger(page);
  const durablePostStatuses = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === 'http://127.0.0.1:18788' && url.pathname === '/weekly-planning/turns'
      && response.request().method() === 'POST') durablePostStatuses.push(response.status());
  });
  await signIn(page);
  await openAiPlanning(page);
  const target = await goToTargetPlannerWeek(page);
  const initial = `${target.text}の10:30から12:00まで部活があります。その予定を登録したいです。`;
  await scriptedTurn(page, request, initial, { kind: 'registration', title: '部活', date: target.iso });
  expect(durablePostStatuses).toEqual([202]);
  await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toBeVisible();
  const before = await previewSnapshot(page, userId);
  expect(before.active).toBeTruthy();
  expect(before.candidates).toHaveLength(1);
  expect(before.candidates[0].length).toBeGreaterThan(0);
  expect(before.drafts).toEqual([]);
  const beforeDocuments = await ownerDocuments(request, userId);
  expect(beforeDocuments, 'the isolated account begins with no saved plans or actuals').toEqual([]);
  expect(firestore.violations()).toEqual([]);
  const syntheticBefore = (await (await request.get(`${SYNTHETIC}/__synthetic/requests`)).json()).received.length;

  const failedText = '数学の予定を変更したい';
  try {
    await setEmailVerified(request, userId, false);
    const workerResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === 'http://127.0.0.1:18788' && url.pathname === '/weekly-planning/turns'
        && response.request().method() === 'POST';
    });
    await composer(page).fill(failedText);
    await page.getByRole('button', { name: '送信', exact: true }).click();
    const response = await workerResponse;
    expect(response.status(), 'the real Worker rejected the actual emulator identity').toBe(403);
    expect(response.request().headers().authorization?.startsWith('Bearer ')).toBe(true);
    expect(durablePostStatuses).toEqual([202, 403]);
    await expect(page.locator('.ai-planning-conversation').getByText(DENIED, { exact: true })).toHaveCount(1);
    await expect(page.locator('.ai-planning-conversation').getByText(failedText, { exact: true })).toHaveCount(1);
    await expect(composer(page)).toHaveValue('');
    await expect(composer(page)).toBeEnabled();
    expect(await previewSnapshot(page, userId)).toEqual(before);
    expect(await ownerDocuments(request, userId)).toEqual(beforeDocuments);
    expect(firestore.violations()).toEqual([]);
    expect((await (await request.get(`${SYNTHETIC}/__synthetic/requests`)).json()).received).toHaveLength(syntheticBefore);
  } finally {
    await setEmailVerified(request, userId, true);
  }

  // Exercise the real logout/login UI with the same account after restoring its
  // emulator verification. The same conversation and preview must survive.
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'ホーム', exact: true }).click();
  await page.getByRole('button', { name: 'マイページを開く', exact: true }).click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'ログイン', exact: true })).toBeVisible();
  await signIn(page);
  await openScheduleDay(page, target.date);
  await openAiPlanning(page);
  expect(await previewSnapshot(page, userId)).toEqual(before);
  await expect(page.locator('.ai-planning-conversation').getByText(failedText, { exact: true })).toHaveCount(1);
  const nextText = '続けて勉強の相談をしたいです。';
  await scriptedTurn(page, request, nextText, { kind: 'consultation', title: null, date: null });
  expect(durablePostStatuses).toEqual([202, 403, 202]);
  await expect(page.locator('.ai-planning-conversation').getByText(nextText, { exact: true })).toHaveCount(1);
  expect(await ownerDocuments(request, userId)).toEqual(beforeDocuments);
  expect(firestore.violations()).toEqual([]);
});
