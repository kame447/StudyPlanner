import { expect, test } from '@playwright/test';
import { SYNTHETIC, answer, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';

const firestore = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const emptyDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const heldText = '英語の音読は30分です';
const nextText = '生物は20分です';
const turnsRoute = 'http://127.0.0.1:18788/weekly-planning/turns*';

async function signIn(page) {
  await page.goto('/');
  const nav = page.locator('.primary-bottom-nav');
  const signInTab = page.getByRole('tab', { name: 'ログイン', exact: true });
  await expect(nav.or(signInTab).first()).toBeVisible();
  if (await signInTab.isVisible()) {
    await signInTab.click();
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

async function receipt(page, owner) {
  const key = `studyplanner.durableWeeklyTurn.vnext.v1:${encodeURIComponent(owner)}`;
  return page.evaluate(name => JSON.parse(localStorage.getItem(name)), key);
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

// AIが回答を作成中 is the exact pending status label in AiPlanningViewLegacy.tsx:976-981.
// There is no claim that a submitted turn was not applied while its result is unknown.
test('an accepted durable turn is reconciled after Worker polling is unreachable', async ({ page, request }) => {
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
  const previousAssistantCount = await bubbles(page).count();
  const beforeProvider = await providerCount(request);
  const attempts = [];
  page.on('request', outgoing => {
    const url = new URL(outgoing.url());
    if (url.origin !== 'http://127.0.0.1:18788' || url.pathname !== '/weekly-planning/turns') return;
    if (outgoing.method() === 'POST') {
      const body = outgoing.postDataJSON();
      attempts.push({ method: 'POST', conversationId: body.conversationId, requestId: body.requestId });
    } else if (outgoing.method() === 'GET') {
      attempts.push({ method: 'GET', conversationId: url.searchParams.get('conversationId'), requestId: url.searchParams.get('requestId') });
    }
  });
  const handler = async route => {
    const intercepted = route.request();
    if (intercepted.method() === 'GET') {
      return route.abort('connectionfailed');
    }
    return route.continue();
  };
  await page.route(turnsRoute, handler);
  try {
    const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/weekly-planning/turns'
      && response.request().method() === 'POST' && response.status() === 202);
    await send(page, heldText);
    await accepted;
    const firstReply = await respondReading(request, '英語の音読', 30, 'reading');
    await expect.poll(() => attempts.filter(attempt => attempt.method === 'GET').length).toBeGreaterThanOrEqual(2);
    const submitted = attempts.filter(attempt => attempt.method === 'POST');
    expect(submitted).toHaveLength(1);
    const identity = submitted[0];
    expect(identity.conversationId).toBe(before.conversationId);
    expect(attempts.filter(attempt => attempt.method === 'GET')).toEqual(expect.arrayContaining([
      expect.objectContaining({ conversationId: identity.conversationId, requestId: identity.requestId }),
    ]));
    for (const attempt of attempts) {
      expect(attempt.conversationId).toBe(identity.conversationId);
      expect(attempt.requestId).toBe(identity.requestId);
    }
    const savedReceipt = await receipt(page, owner);
    expect(savedReceipt.pending.conversationId).toBe(identity.conversationId);
    expect(savedReceipt.pending.requestId).toBe(identity.requestId);
    expect(savedReceipt.payload.input.userText).toBe(heldText);
    await expect(page.getByRole('status', { name: 'AIが回答を作成中', exact: true })).toBeVisible();
    await expect(page.locator('.ai-planning-conversation').getByText(heldText, { exact: true })).toHaveCount(1);
    await expect(page.locator('.ai-planning-composer textarea')).toBeDisabled();
    await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
    expect((await checkpoint(page)).vnext).toEqual(before.vnext);
    expect(await providerCount(request)).toBe(beforeProvider + 2); // one interpretation and one rendering
    expect(protectedWritesIn(writes.writes())).toEqual([]);
    expect(await documents(request, 'schedule_events')).toEqual(beforePlans);
    expect(await documents(request, 'actuals')).toEqual(beforeActuals);
    expect(await documents(request, 'weekly_planning_approval_operations')).toEqual(beforeApprovals);

    // Once polling is restored, the existing result is fetched; no second POST or AI run.
    const settled = page.waitForResponse(async response => {
      if (new URL(response.url()).pathname !== '/weekly-planning/turns' || response.request().method() !== 'GET' || response.status() !== 200) return false;
      try { const body = await response.json(); return body.status === 'completed' && body.identity.requestId === identity.requestId; } catch { return false; }
    });
    settled.catch(() => {});
    await page.unroute(turnsRoute, handler);
    await settled;
    await expect(bubbles(page)).toHaveCount(previousAssistantCount + 1);
    await expect(bubbles(page).last()).toHaveText(firstReply);
    await expect.poll(async () => JSON.stringify((await checkpoint(page))?.vnext.state.graph)).toContain('英語の音読');
    expect((await checkpoint(page)).conversationId).toBe(identity.conversationId);
    expect(attempts.filter(attempt => attempt.method === 'POST')).toHaveLength(1);
    expect(await providerCount(request)).toBe(beforeProvider + 2);

    // A later user utterance starts a distinct turn in the same conversation.
    const nextPost = page.waitForRequest(outgoing => new URL(outgoing.url()).pathname === '/weekly-planning/turns' && outgoing.method() === 'POST');
    nextPost.catch(() => {});
    await send(page, nextText);
    const secondRequest = (await nextPost).postDataJSON();
    expect(secondRequest.conversationId).toBe(identity.conversationId);
    expect(secondRequest.requestId).not.toBe(identity.requestId);
    const secondReply = await respondReading(request, '生物', 20, 'biology');
    await expect(bubbles(page)).toHaveCount(previousAssistantCount + 2);
    await expect(bubbles(page).last()).toHaveText(secondReply);
    await expect.poll(async () => JSON.stringify((await checkpoint(page))?.vnext.state.graph)).toContain('生物');
    await expect(page.locator('.ai-planning-conversation').getByText(nextText, { exact: true })).toHaveCount(1);
    expect(protectedWritesIn(writes.writes())).toEqual([]);
    expect(await documents(request, 'schedule_events')).toEqual(beforePlans);
    expect(await documents(request, 'actuals')).toEqual(beforeActuals);
    expect(await documents(request, 'weekly_planning_approval_operations')).toEqual(beforeApprovals);
  } finally {
    await page.unroute(turnsRoute, handler);
  }
});
