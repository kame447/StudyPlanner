import { expect, test } from '@playwright/test';
import { VNEXT_REPEATED_EFFORT_INCONSISTENT_GUIDANCE, VNEXT_REPEATED_COMPLETED_EXCEEDS_TOTAL_GUIDANCE } from '../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDialogue.ts';
import { SYNTHETIC, answer, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';

const guidance = { effort_inconsistent: VNEXT_REPEATED_EFFORT_INCONSISTENT_GUIDANCE,
  completed_exceeds_total: VNEXT_REPEATED_COMPLETED_EXCEEDS_TOTAL_GUIDANCE };
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const emptyDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const nativeSchema = 'weekly_planning_vnext_native_v1';
const rendererSchema = 'weekly_planning_stable_v5_dialogue_response';
const focusedSchema = 'weekly_planning_focused_contextual_answer_v5';
const fallback = { decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null };
const endings = ['', ' お知らせください。', ' 一緒に確認しましょう。', ' ご検討ください。', ' ご確認ください。'];
const math = { kind: 'task', localId: 'math', category: 'study', title: '数学プリント' };
const pages = (localId, quantityRole, amount) => ({ kind: 'workload', localId, taskRef: { localId: 'math' },
  componentRef: null, quantityRole, amount, unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null });
test.afterEach(async ({ request }) => {
  const response = await request.post(`${SYNTHETIC}/__synthetic/reset`);
  expect(response.ok(), 'synthetic provider reset').toBe(true);
});

const cases = [
  {
    code: 'effort_inconsistent',
    initialText: '数学プリントは残り8枚で、1枚5分、全体60分です。この条件で予定を作ってください。',
    facts: [math, pages('pages', 'remaining', 8),
      { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'math' }, targetRef: { localId: 'pages' },
        effortKind: 'duration_per_unit', minutes: 5, unitCode: 'page', unitLabel: '枚', precision: 'exact' },
      { kind: 'effort_estimate', localId: 'total', taskRef: { localId: 'math' }, targetRef: { localId: 'pages' },
        effortKind: 'total_duration', minutes: 60, unitCode: null, unitLabel: null, precision: 'exact' }],
    values: ['5分', '60分'],
    correctionText: '全体60分の方を40分に訂正してください。1枚5分はそのままです。',
    correction: context => ({ kind: 'effort_estimate', localId: 'correct-total',
      targetFactId: context.activeFacts.effortEstimates.find(estimate => estimate.kind === 'total_duration').id,
      changes: { minutes: 40, effortKind: null, unitCode: null, unitLabel: null, precision: null } }),
  },
  {
    code: 'completed_exceeds_total',
    initialText: '数学プリントは全体10枚で12枚終わりました。この条件で予定を作ってください。',
    facts: [math, pages('total', 'scope_total', 10), pages('done', 'completed', 12)],
    values: ['10枚', '12枚'],
    correctionText: '完了は12枚ではなく8枚です。全体10枚はそのままです。',
    correction: context => ({ kind: 'workload', localId: 'correct-completed',
      targetFactId: context.activeFacts.workloads.find(workload => workload.quantityRole === 'completed').id,
      amountDelta: null, changes: { amount: 8, quantityRole: null, unitCode: null, unitLabel: null,
        rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }),
  },
];

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
// runQuery has no page-size limit: consume its complete streamed result and
// compare only this test owner's documents, including nested approval items.
async function documents(request, collection, owner) {
  const response = await request.post(`${FIRESTORE}:runQuery`, { headers: { Authorization: 'Bearer owner' }, data: {
    structuredQuery: { from: [{ collectionId: collection, allDescendants: true }],
      where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: owner } } } },
  } });
  expect(response.ok(), `read ${collection} for this owner from emulator`).toBe(true);
  const rows = await response.json();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.every(row => !row.error), 'the full owner query completed without an embedded error').toBe(true);
  return rows.flatMap(row => row.document ? [row.document] : []).sort((a, b) => a.name.localeCompare(b.name));
}
async function nativeReading(request) {
  let call = await nextCall(request);
  if (call.schema === focusedSchema) {
    await answer(request, call, fallback);
    call = await nextCall(request);
  }
  expect(call.schema).toBe(nativeSchema);
  return call;
}
async function renderTurn(page, request, index, expectedCount) {
  const render = await nextCall(request);
  expect(render.schema).toBe(rendererSchema);
  const prompt = render.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
    .find(value => value?.applicationDecision);
  expect(prompt).toBeTruthy();
  const reply = rendererReply(render);
  // Avoid the separate same-text renderer validator; the changed decision and
  // exact guidance are asserted separately, so this suffix is never the oracle.
  reply.text += endings[index];
  await answer(request, render, reply);
  const assistant = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
  await expect(assistant).toHaveCount(expectedCount);
  await expect(assistant.last()).toHaveText(reply.text);
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  return { decision: prompt.applicationDecision, text: reply.text };
}

// Real clock and same-commit Pages/Worker. The provider alone is synthetic.
for (const scenario of cases) {
  test(`durable ${scenario.code} offers a different explanation after three non-answers and accepts an explicit correction`, async ({ page, request }) => {
    const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
    await signIn(page);
    const writes = attachWriteLedger(page);
    const posts = [];
    const postStatuses = [];
    const polls = [];
    page.on('request', outgoing => {
      if (new URL(outgoing.url()).pathname !== '/weekly-planning/turns') return;
      if (outgoing.method() === 'POST') posts.push(outgoing);
      if (outgoing.method() === 'GET') polls.push(outgoing);
    });
    page.on('response', response => {
      if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/weekly-planning/turns') {
        postStatuses.push(response.status());
      }
    });
    await openAiPlanning(page);
    await goToTargetPlannerWeek(page);
    const beforeLegacyPlans = await documents(request, 'plans', owner);
    const beforePlans = await documents(request, 'schedule_events', owner);
    const beforeApprovalItems = await documents(request, 'weekly_planning_approval_items', owner);
    const beforeActuals = await documents(request, 'actuals', owner);
    const beforeApprovals = await documents(request, 'weekly_planning_approval_operations', owner);
    const assistant = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
    const baseline = await assistant.count();
    const providerBefore = (await (await request.get(`${SYNTHETIC}/__synthetic/requests`)).json()).received.length;

    await send(page, scenario.initialText);
    const initial = await nativeReading(request);
    await answer(request, initial, { planningIntent: 'create_plan', conversationActs: [], answer: null,
      delta: { ...emptyDelta, add: scenario.facts } });
    const asked = await renderTurn(page, request, 0, baseline + 1);
    expect(asked.decision.questionCode).toBe(scenario.code);
    await expect.poll(async () => (await checkpoint(page))?.vnext.messages.length ?? 0).toBe(2);
    const first = await checkpoint(page);
    expect(first.ownerId).toBe(owner);
    expect(first.vnext.preview).toBeNull();
    expect(first.vnext.presentedQuestion).not.toBeNull();
    if (scenario.code === 'effort_inconsistent') {
      expect(first.vnext.state.graph.effortEstimates.map(item => [item.kind, item.minutes]))
        .toEqual([['duration_per_unit', 5], ['total_duration', 60]]);
    } else {
      expect(first.vnext.state.graph.workloads.map(item => [item.quantityRole, item.amount]))
        .toEqual([['scope_total', 10], ['completed', 12]]);
    }
    await expect(page.locator('.ai-planning-conversation').getByText(scenario.initialText, { exact: true })).toHaveCount(1);

    const presentations = [];
    for (const [index, text] of ['うーん', 'まだ分からない', 'そうですね'].entries()) {
      await send(page, text);
      const reading = await nativeReading(request);
      const context = reading.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
        .find(value => value?.openQuestions);
      expect(context?.presentedQuestion?.key).toBeTruthy();
      const question = context.openQuestions.find(item => item.key === context.presentedQuestion.key);
      expect(question).toMatchObject({ code: scenario.code, options: [] });
      await answer(request, reading, { planningIntent: 'unknown', conversationActs: [], answer: null, delta: emptyDelta });
      const shown = await renderTurn(page, request, index + 1, baseline + index + 2);
      expect(shown.decision.questionCode).toBe(scenario.code);
      presentations.push(shown);
      const current = await checkpoint(page);
      expect(current.vnext.state.graph).toEqual(first.vnext.state.graph);
      expect(current.vnext.preview).toBeNull();
      await expect(page.locator('.ai-planning-conversation').getByText(text, { exact: true })).toHaveCount(1);
    }
    const [second, third] = presentations.slice(1);
    expect(second.decision.relevantLabels).not.toContain(guidance[scenario.code]);
    expect(third.decision.communication.goal).toBe('explain_question');
    expect(third.decision.relevantLabels).toContain(guidance[scenario.code]);
    expect(third.text).toContain(guidance[scenario.code]);
    expect(third.text).not.toBe(second.text);
    for (const value of scenario.values) expect(third.text).toContain(value);
    const afterThird = await checkpoint(page);
    expect(afterThird.vnext.unansweredQuestionStreak).toMatchObject({ questionKey: first.vnext.presentedQuestion.questionKey, count: 3 });
    await expect(page.locator('.ai-planning-plan-card')).toHaveCount(0);

    await send(page, scenario.correctionText);
    const correction = await nativeReading(request);
    const context = correction.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
      .find(value => value?.activeFacts);
    expect(context.userText).toBe(scenario.correctionText);
    await answer(request, correction, { planningIntent: 'update_plan', conversationActs: [], answer: null,
      delta: { ...emptyDelta, patch: [scenario.correction(context)] } });
    const corrected = await renderTurn(page, request, 4, baseline + 5);
    expect(corrected.decision.questionCode).not.toBe(scenario.code);
    const after = await checkpoint(page);
    const active = new Set(after.vnext.state.graph.factLifecycles.filter(item => item.status === 'active').map(item => item.factId));
    if (scenario.code === 'effort_inconsistent') {
      expect(after.vnext.state.graph.effortEstimates.filter(item => active.has(item.id)).map(item => [item.kind, item.minutes]))
        .toEqual([['duration_per_unit', 5], ['total_duration', 40]]);
      await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
    } else {
      expect(after.vnext.state.graph.workloads.filter(item => active.has(item.id)).map(item => [item.quantityRole, item.amount]))
        .toEqual([['scope_total', 10], ['completed', 8]]);
      expect(corrected.decision.questionCode).toBe('missing_effort_estimate');
      expect(after.vnext.preview).toBeNull();
    }
    expect(posts).toHaveLength(5);
    expect(postStatuses).toEqual([202, 202, 202, 202, 202]);
    for (const post of posts) {
      const identity = JSON.parse(post.postData());
      expect(polls.some(poll => {
        const url = new URL(poll.url());
        return url.searchParams.get('conversationId') === identity.conversationId
          && url.searchParams.get('requestId') === identity.requestId;
      })).toBe(true);
    }
    // Each turn makes one native interpretation and one render. Any extra dispatch is visible.
    const providerAfter = (await (await request.get(`${SYNTHETIC}/__synthetic/requests`)).json()).received.length;
    expect(providerAfter - providerBefore).toBe(10);
    expect(protectedWritesIn(writes.writes())).toEqual([]);
    expect(await documents(request, 'plans', owner)).toEqual(beforeLegacyPlans);
    expect(await documents(request, 'schedule_events', owner)).toEqual(beforePlans);
    expect(await documents(request, 'weekly_planning_approval_items', owner)).toEqual(beforeApprovalItems);
    expect(await documents(request, 'actuals', owner)).toEqual(beforeActuals);
    expect(await documents(request, 'weekly_planning_approval_operations', owner)).toEqual(beforeApprovals);
  });
}
