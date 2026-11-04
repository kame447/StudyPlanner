import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { SYNTHETIC, answer, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';

// A RED checkout may point P1_ORACLE_ROOT at the fixed product source.
let interpretationFailureReply;
test.beforeAll(async () => {
  const root = process.env.P1_ORACLE_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
  const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom' });
  try {
    const product = await server.ssrLoadModule('/src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextExperimentalSession.ts');
    interpretationFailureReply = product.interpretationFailureReply;
    expect(interpretationFailureReply).toEqual(expect.any(Function));
  } finally {
    await server.close();
  }
});
const genericFailure = '週間計画の会話状態を更新できませんでした。';
const genericInterruption = '返信の生成が中断しました。自動でAIを再実行していません。';
const firestore = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
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

async function checkpoint(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(key => !key.includes('.anonymous'));
    const indexKey = keys.find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.'));
    const chatId = indexKey ? JSON.parse(localStorage.getItem(indexKey)).activeChatId : null;
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

// The production durable job uses real time; all provider replies come from the synthetic server.
test('durable 500 preserves the preview, explains repeated failure and accepts the next turn', async ({ page, request }) => {
  const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
  await signIn(page);
  const writes = attachWriteLedger(page);
  const posts = [];
  page.on('request', outgoing => {
    if (outgoing.method() === 'POST' && new URL(outgoing.url()).pathname === '/weekly-planning/turns') posts.push(outgoing);
  });
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
  expect(factsRenderer.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  await answer(request, factsRenderer, rendererReply(factsRenderer));
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
  expect(JSON.stringify(before.vnext.state.graph)).toContain('数学');
  expect(before.vnext.preview).not.toBeNull();
  expect(before.vnext.failureRecovery).toBeUndefined();

  const conversation = page.locator('.ai-planning-conversation');
  for (const [index, text] of ['数学を90分に変更して', '数学を90分に変更して'].entries()) {
    const expected = interpretationFailureReply(
      { reason: 'provider_error', consecutiveCount: index + 1 }, before.vnext.preview,
    );
    const beforeMessages = await bubbles(page).count();
    const beforePosts = posts.length;
    const beforeProvider = await providerCount(request);
    await send(page, text);
    const failure = await nextCall(request);
    expect(failure.schema).toBe('weekly_planning_vnext_native_v1');
    await answer(request, failure, null, 500);
    await expect(bubbles(page)).toHaveCount(beforeMessages + 1);
    await expect(bubbles(page).last()).toHaveText(expected);
    await expect(conversation.getByText(text, { exact: true })).toHaveCount(index + 1);
    await expect(conversation.getByText(genericFailure, { exact: true })).toHaveCount(0);
    await expect(page.getByText(genericInterruption, { exact: true })).toHaveCount(0);
    await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
    await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
    const after = await checkpoint(page);
    expect(after.vnext.state.graph).toEqual(before.vnext.state.graph);
    expect(after.vnext.preview).toEqual(before.vnext.preview);
    expect(after.vnext.presentedQuestion).toEqual(before.vnext.presentedQuestion);
    expect(posts).toHaveLength(beforePosts + 1);
    expect(await providerCount(request)).toBe(beforeProvider + 1);
    expect(protectedWritesIn(writes.writes())).toEqual([]);
    expect(await documents(request, 'schedule_events')).toEqual(beforePlans);
    expect(await documents(request, 'actuals')).toEqual(beforeActuals);
    expect(await documents(request, 'weekly_planning_approval_operations')).toEqual(beforeApprovals);
  }
  await expect(conversation.getByText('数学を90分に変更して', { exact: true })).toHaveCount(2);
  await expect(conversation.getByText('保存しました', { exact: true })).toHaveCount(0);

  const beforeResumePosts = posts.length;
  await send(page, '英語の音読は30分です');
  const resumed = await nextCall(request);
  expect(resumed.schema).toBe('weekly_planning_vnext_native_v1');
  await answer(request, resumed, { planningIntent: 'discuss', conversationActs: [], answer: null, delta: {
    patch: [], remove: [], relate: [], defer: [], add: [
      { kind: 'task', localId: 'reading', category: 'study', title: '英語の音読' },
      { kind: 'workload', localId: 'reading-minutes', taskRef: { localId: 'reading' }, componentRef: null,
        quantityRole: 'target', amount: 30, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null },
    ],
  } });
  const resumedRenderer = await nextCall(request);
  expect(resumedRenderer.schema).toBe('weekly_planning_stable_v5_dialogue_response');
  await answer(request, resumedRenderer, rendererReply(resumedRenderer));
  await expect.poll(async () => JSON.stringify((await checkpoint(page))?.vnext.state.graph)).toContain('英語の音読');
  await expect(conversation.getByText('英語の音読は30分です', { exact: true })).toHaveCount(1);
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  expect(posts).toHaveLength(beforeResumePosts + 1);
  expect(protectedWritesIn(writes.writes())).toEqual([]);
  expect(await documents(request, 'schedule_events')).toEqual(beforePlans);
  expect(await documents(request, 'actuals')).toEqual(beforeActuals);
  expect(await documents(request, 'weekly_planning_approval_operations')).toEqual(beforeApprovals);
});
