import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { SYNTHETIC, answer, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// RED checkout predates the constant: point this at the same product source in
// the fixed checkout so the oracle is identical for both versions.
const messageSource = process.env.DURABLE_TERMINAL_MESSAGE_SOURCE ?? path.join(repoRoot,
  'src/features/weeklyPlanning/application/weeklyPlanningDurableWorkerUnavailableError.ts');
const { WEEKLY_PLANNING_DURABLE_WORKER_UNAVAILABLE_USER_MESSAGE: expectedMessage } = await import(pathToFileURL(messageSource).href);
const firestore = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const endpoint = 'http://127.0.0.1:18788/weekly-planning/turns';
const routePattern = `${endpoint}*`;
const emptyDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const failedText = '英語の音読は30分です';

async function signIn(page) {
  await page.goto('/');
  const nav = page.locator('.primary-bottom-nav');
  const tab = page.getByRole('tab', { name: 'ログイン', exact: true });
  await expect(nav.or(tab).first()).toBeVisible();
  if (await tab.isVisible()) {
    await tab.click();
    await page.getByLabel('メールアドレス').fill(test.info().project.metadata.email);
    await page.getByLabel('パスワード', { exact: true }).fill(process.env.STUDYPLANNER_LIVE_PASSWORD);
    await page.getByRole('button', { name: 'ログインする' }).click();
  }
  await expect(nav).toBeVisible();
}
async function send(page, text) {
  await page.locator('.ai-planning-composer textarea').fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
}
async function checkpoint(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(key => !key.includes('.anonymous'));
    const index = keys.find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.'));
    const chatId = index ? JSON.parse(localStorage.getItem(index)).activeChatId : null;
    const core = chatId ? keys.filter(key => key.startsWith('studyplanner.weeklyPlanning.vnext.') && key.endsWith(`.${chatId}.core`)) : [];
    if (core.length > 1) throw new Error(`Ambiguous active checkpoints: ${core.length}`);
    return core.length ? JSON.parse(localStorage.getItem(core[0])) : null;
  });
}
async function documents(request, collection) {
  const response = await request.get(`${firestore}/${collection}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok(), `read ${collection} from emulator`).toBe(true);
  return (await response.json()).documents ?? [];
}
const providerCount = async request => (await (await request.get(`${SYNTHETIC}/__synthetic/requests`)).json()).received.length;
const bubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
async function respondReading(request, title, minutes, localId) {
  const reading = await nextCall(request);
  expect(reading.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, reading, { planningIntent: 'discuss', conversationActs: [], answer: null, delta: {
    ...emptyDelta, add: [
      { kind: 'task', localId, category: 'study', title },
      { kind: 'workload', localId: `${localId}-minutes`, taskRef: { localId }, componentRef: null,
        quantityRole: 'target', amount: minutes, unitCode: 'minute', unitLabel: '分',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
    ],
  } });
  const render = await nextCall(request);
  expect(render.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  const reply = rendererReply(render);
  await answer(request, render, reply);
  return reply.text;
}

test('terminal 503 reports the retained preview and the next turn remains usable', async ({ page, request }) => {
  const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
  await signIn(page);
  const writes = attachWriteLedger(page);
  await openAiPlanning(page);
  await goToTargetPlannerWeek(page);
  const beforePlans = await documents(request, 'schedule_events');
  const beforeActuals = await documents(request, 'actuals');
  const beforeApprovals = await documents(request, 'weekly_planning_approval_operations');

  await send(page, '数学を60分');
  await respondReading(request, '数学', 60, 'math');
  await expect.poll(async () => (await checkpoint(page))?.vnext.messages.length ?? 0).toBe(2);
  await send(page, 'この条件で予定を作って');
  const plan = await nextCall(request);
  expect(plan.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, plan, { planningIntent: 'create_plan', conversationActs: [], answer: null, delta: emptyDelta });
  const planRenderer = await nextCall(request);
  expect(planRenderer.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  await answer(request, planRenderer, rendererReply(planRenderer));
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
  const before = await checkpoint(page);
  expect(before.ownerId).toBe(owner);
  expect(before.vnext.preview).not.toBeNull();
  const beforeAssistant = await bubbles(page).count();
  const beforeProvider = await providerCount(request);
  const posts = [];
  page.on('request', outgoing => {
    const url = new URL(outgoing.url());
    if (url.origin === 'http://127.0.0.1:18788' && url.pathname === '/weekly-planning/turns' && outgoing.method() === 'POST') {
      posts.push(outgoing.postDataJSON());
    }
  });
  let release503;
  const gate = new Promise(resolve => { release503 = resolve; });
  const handler = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    await gate;
    return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': 'http://127.0.0.1:4180' }, json: { error: 'test_worker_unavailable' } });
  };
  await page.route(routePattern, handler);
  try {
    const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/weekly-planning/turns'
      && response.request().method() === 'POST' && response.status() === 202);
    await send(page, failedText);
    const postRequest = (await accepted).request();
    const identity = postRequest.postDataJSON();
    const auth = await postRequest.headerValue('authorization');
    expect(auth).toBeTruthy();
    expect(identity.conversationId).toBe(before.conversationId);
    await respondReading(request, '英語の音読', 30, 'reading');
    // Read the real Worker result without altering it. This guarantees the job
    // has finished before 503 and the next user turn; the page still sees 503.
    const query = new URLSearchParams({ conversationId: identity.conversationId, requestId: identity.requestId });
    await expect.poll(async () => {
      const response = await request.get(`${endpoint}?${query}`, { headers: { authorization: auth } });
      if (!response.ok()) return `HTTP ${response.status()}`;
      return (await response.json()).status;
    }).toBe('completed');
    release503();
    await expect(bubbles(page)).toHaveCount(beforeAssistant + 1);
    await expect(bubbles(page).last()).toHaveText(expectedMessage);
    await expect(page.locator('.ai-planning-conversation').getByText(failedText, { exact: true })).toHaveCount(1);
    await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
    await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
    expect((await checkpoint(page)).vnext).toEqual(before.vnext);
    expect(posts).toHaveLength(1);
    expect(await providerCount(request)).toBe(beforeProvider + 2); // one semantic call and one render, no replay
    expect(protectedWritesIn(writes.writes())).toEqual([]);
    expect(await documents(request, 'schedule_events')).toEqual(beforePlans);
    expect(await documents(request, 'actuals')).toEqual(beforeActuals);
    expect(await documents(request, 'weekly_planning_approval_operations')).toEqual(beforeApprovals);

    await page.unroute(routePattern, handler);
    await send(page, '生物は20分です');
    const nextReply = await respondReading(request, '生物', 20, 'biology');
    await expect(bubbles(page)).toHaveCount(beforeAssistant + 2);
    await expect(bubbles(page).last()).toHaveText(nextReply);
    await expect.poll(async () => JSON.stringify((await checkpoint(page))?.vnext.state.graph)).toContain('生物');
    const after = await checkpoint(page);
    expect(after.conversationId).toBe(identity.conversationId);
    expect(JSON.stringify(after.vnext.state.graph)).not.toContain('英語の音読');
    expect(posts).toHaveLength(2);
    expect(posts[1].conversationId).toBe(identity.conversationId);
    expect(posts[1].requestId).not.toBe(identity.requestId);
    expect(await providerCount(request)).toBe(beforeProvider + 4);
    expect(protectedWritesIn(writes.writes())).toEqual([]);
    expect(await documents(request, 'schedule_events')).toEqual(beforePlans);
    expect(await documents(request, 'actuals')).toEqual(beforeActuals);
    expect(await documents(request, 'weekly_planning_approval_operations')).toEqual(beforeApprovals);
  } finally {
    release503();
    await page.unroute(routePattern, handler);
  }
});
