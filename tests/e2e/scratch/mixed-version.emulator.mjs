import { expect, test } from '@playwright/test';
import { SYNTHETIC, answer, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';

// Real time is required by the durable job. Pages and Worker come from separate
// checkouts; only the model provider is scripted. No durable response is mocked.
const firestore = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const failedText = '数学を90分に変更して';
const providerFailedText = '数学を75分に変更して';
const emptyDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };

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

async function answerRaw(request, call, content) {
  const response = await request.post(`${SYNTHETIC}/__synthetic/respond`, { data: {
    id: call.id, status: 200, body: { id: `synthetic-${call.id}`, object: 'chat.completion', model: call.body.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  } });
  expect(response.ok()).toBe(true);
}

function terminalTurn(page) {
  const response = page.waitForResponse(async candidate => {
    const url = new URL(candidate.url());
    if (url.pathname !== '/weekly-planning/turns' || candidate.request().method() !== 'GET' || candidate.status() !== 200) return false;
    try { return ['completed', 'failed', 'expired'].includes((await candidate.json()).status); } catch { return false; }
  });
  response.catch(() => {});
  return response;
}

async function activeCheckpoint(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(key => !key.includes('.anonymous'));
    const indexKey = keys.find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.'));
    const chatId = indexKey ? JSON.parse(localStorage.getItem(indexKey)).activeChatId : null;
    const coreKeys = chatId ? keys.filter(key => key.startsWith('studyplanner.weeklyPlanning.vnext.') && key.endsWith(`.${chatId}.core`)) : [];
    if (coreKeys.length > 1) throw new Error(`Ambiguous active checkpoints: ${coreKeys.length}`);
    return coreKeys.length ? localStorage.getItem(coreKeys[0]) : null;
  });
}

async function documents(request, collection) {
  const response = await request.get(`${firestore}/${collection}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok(), `read ${collection} from emulator`).toBe(true);
  return (await response.json()).documents ?? [];
}

test('old Pages rejects a new Worker checkpoint after an unparseable response', async ({ page, request }) => {
  const email = test.info().project.metadata.email;
  const owner = await emulatorUserId(request, { email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
  await signIn(page);
  const writes = attachWriteLedger(page);
  await openAiPlanning(page);
  await goToTargetPlannerWeek(page);
  const beforePlans = await documents(request, 'schedule_events');
  const beforeActuals = await documents(request, 'actuals');
  const beforeApprovals = await documents(request, 'weekly_planning_approval_operations');

  await send(page, '数学を60分');
  const facts = await nextCall(request);
  expect(facts.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, facts, { planningIntent: 'discuss', conversationActs: [], answer: null, delta: {
    patch: [], remove: [], relate: [], defer: [], add: [
      { kind: 'task', localId: 'math', category: 'study', title: '数学' },
      { kind: 'workload', localId: 'math-minutes', taskRef: { localId: 'math' }, componentRef: null,
        quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null },
    ],
  } });
  const factsRenderer = await nextCall(request);
  await answer(request, factsRenderer, rendererReply(factsRenderer));
  await expect.poll(async () => {
    const raw = await activeCheckpoint(page);
    return raw ? JSON.parse(raw).vnext.messages.length : 0;
  }).toBe(2);

  await send(page, 'この条件で予定を作って');
  const plan = await nextCall(request);
  expect(plan.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, plan, { planningIntent: 'create_plan', conversationActs: [], answer: null, delta: emptyDelta });
  const planRenderer = await nextCall(request);
  await answer(request, planRenderer, rendererReply(planRenderer));
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
  const beforeRaw = await activeCheckpoint(page);
  const beforeCheckpoint = JSON.parse(beforeRaw);
  expect(beforeCheckpoint.ownerId).toBe(owner);
  expect(JSON.stringify(beforeCheckpoint.vnext.state.graph)).toContain('数学');
  expect(beforeCheckpoint.vnext.preview).not.toBeNull();
  expect(beforeCheckpoint.vnext.failureRecovery).toBeUndefined();

  // A transport failure is terminal in the durable job. Verify its UI first,
  // then use a distinct next utterance to prove that another turn is accepted.
  const providerTerminal = terminalTurn(page);
  await send(page, providerFailedText);
  const failedProviderCall = await nextCall(request);
  expect(failedProviderCall.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, failedProviderCall, null, 500);
  const providerWire = await (await providerTerminal).json();
  expect(providerWire).toMatchObject({ status: 'failed', failure: 'provider_failure' });
  await expect(page.locator('.ai-planning-error[role="alert"]'))
    .toHaveText('返信の生成が中断しました。自動でAIを再実行していません。');
  await expect(page.locator('.ai-planning-conversation').getByText(providerFailedText, { exact: true })).toHaveCount(1);
  await expect(page.locator('.ai-planning-composer textarea')).toHaveValue(providerFailedText);
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
  expect(await activeCheckpoint(page)).toBe(beforeRaw);

  // An HTTP 200 with a non-JSON model content is journaled successfully, then
  // fails semantic parsing; the new Worker can return failureRecovery itself.
  const completed = terminalTurn(page);
  const turnPost = page.waitForRequest(request => new URL(request.url()).pathname === '/weekly-planning/turns' && request.method() === 'POST');
  turnPost.catch(() => {});
  await send(page, failedText);
  const posted = await turnPost;
  expect(posted.postDataJSON().payload.checkpoint).toBe(beforeRaw);
  const failedReading = await nextCall(request);
  expect(failedReading.schema).toBe('weekly_planning_vnext_native_v1');
  await answerRaw(request, failedReading, 'not valid JSON');
  // Recovery is allowed after a completed semantic dispatch. Return a second
  // malformed content so the renderer falls back without a verification call.
  const recoveryRenderer = await nextCall(request);
  expect(recoveryRenderer.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  await answerRaw(request, recoveryRenderer, 'not valid JSON');
  const wire = await (await completed).json();
  expect(wire.status).toBe('completed');
  const result = JSON.parse(wire.result);
  expect(result.core).toBe('vnext');
  expect(result.checkpointBefore).toBe(beforeRaw);
  expect(typeof result.checkpointAfter).toBe('string');
  expect(JSON.parse(result.checkpointAfter).vnext.failureRecovery)
    .toMatchObject({ reason: 'unparseable', consecutiveCount: 1 });

  // Old Pages rejects the actual returned bytes before staging the checkpoint.
  await expect(page.locator('.ai-planning-error[role="alert"]')).toHaveText('Invalid VNext result checkpoint.');
  await expect(page.locator('.ai-planning-conversation').getByText('週間計画の会話状態を更新できませんでした。', { exact: true })).toHaveCount(2);
  await expect(page.locator('.ai-planning-conversation').getByText(failedText, { exact: true })).toHaveCount(1);
  await expect(page.locator('.ai-planning-composer textarea')).toHaveValue(failedText);
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
  expect(await activeCheckpoint(page)).toBe(beforeRaw);
  await expect(page.locator('.ai-planning-conversation')).not.toContainText('保存しました');
  expect(protectedWritesIn(writes.writes())).toEqual([]);
  expect(await documents(request, 'schedule_events')).toEqual(beforePlans);
  expect(await documents(request, 'actuals')).toEqual(beforeActuals);
  expect(await documents(request, 'weekly_planning_approval_operations')).toEqual(beforeApprovals);
});
