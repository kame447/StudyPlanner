import { expect, test } from '@playwright/test';
import { SYNTHETIC, answer, nextCall, rendererReply, VNEXT_READING_SCHEMA, RENDERER_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { VNEXT_REPEATED_REMAINING_INCONSISTENT_GUIDANCE, VNEXT_REPEATED_SAME_OR_DISTINCT_WORK_GUIDANCE } from '../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDialogue.ts';

const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const GUIDANCE = {
  remaining_inconsistent: VNEXT_REPEATED_REMAINING_INCONSISTENT_GUIDANCE,
  same_or_distinct_work: VNEXT_REPEATED_SAME_OR_DISTINCT_WORK_GUIDANCE,
};
const endings = ['', ' お知らせください。', ' 一緒に確認しましょう。', ' ご検討ください。', ' ご確認ください。'];
const task = { kind: 'task', localId: 'task', category: 'study', title: '数学プリント' };
const workload = (localId, quantityRole, amount, unitCode, unitLabel) => ({ kind: 'workload', localId,
  taskRef: { localId: 'task' }, componentRef: null, quantityRole, amount, unitCode, unitLabel,
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
test.afterEach(async ({ request }) => {
  const response = await request.post(`${SYNTHETIC}/__synthetic/reset`);
  expect(response.ok(), 'synthetic provider reset').toBe(true);
});

const cases = [
  { code: 'remaining_inconsistent', initial: '数学プリントは全体20枚、12枚終わって残り7枚',
    facts: [task, workload('total', 'scope_total', 20, 'page', '枚'),
      workload('done', 'completed', 12, 'page', '枚'), workload('left', 'remaining', 7, 'page', '枚')],
    labels: ['残りを8枚にする', '終わった量を13枚にする'], choice: '残りを8枚にする' },
  { code: 'same_or_distinct_work', initial: '数学プリントを10枚やりたい。残り45分です',
    facts: [task, workload('pages', 'target', 10, 'page', '枚'), workload('minutes', 'remaining', 45, 'minute', '分')],
    labels: ['別々の作業として両方やる', '同じ作業としてまとめる'], choice: '別々の作業として両方やる' },
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
    const active = index ? JSON.parse(localStorage.getItem(index)).activeChatId : null;
    const cores = active ? keys.filter(key => key.startsWith('studyplanner.weeklyPlanning.vnext.') && key.endsWith(`.${active}.core`)) : [];
    if (cores.length > 1) throw new Error(`Ambiguous active checkpoints: ${cores.length}`);
    return cores.length ? JSON.parse(localStorage.getItem(cores[0])) : null;
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
const providerCount = async request => (await (await request.get(`${SYNTHETIC}/__synthetic/requests`)).json()).received.length;

// Answer the real Worker's outbound Jev decision. For a non-answer select the supplied
// none option; for the final turn select the leaf whose actual candidate label was displayed.
async function answerChoice(request, selectedLabel, expectedQuestion) {
  const response = await request.get(`${SYNTHETIC}/__synthetic/next?route=decision`, { timeout: 30_000 });
  expect(response.ok()).toBe(true);
  const call = await response.json();
  expect(call.body.state.context.question.code).toBe(expectedQuestion);
  const criteria = call.body.questions.candidate.criteria;
  const ids = Object.keys(criteria);
  let selected = 'none';
  if (selectedLabel !== null) {
    const candidates = Object.entries(criteria).flatMap(([id, value]) => {
      try { return [{ id, value: JSON.parse(value) }]; } catch { return []; }
    });
    const matching = candidates.filter(entry => entry.value.label === selectedLabel);
    expect(matching, 'the displayed choice is offered to the real candidate selector').toHaveLength(1);
    selected = matching[0].id;
  }
  expect(ids).toContain(selected);
  const probabilities = Object.fromEntries(ids.map(id => [id, id === selected ? 0.998 : 0.002 / (ids.length - 1)]));
  const body = { model: 'typesafe/jev-1.14', answers: {
    candidate: { type: 'choice', choice: selected, confidence: 0.998, probabilities },
    condition_change: { type: 'noul', noul: 0.001 }, independent_meaning: { type: 'noul', noul: 0.001 },
  } };
  const result = await request.post(`${SYNTHETIC}/__synthetic/respond`, { data: { id: call.id, status: 200, body } });
  expect(result.ok()).toBe(true);
}
async function answerReading(request, delta) {
  const call = await nextCall(request);
  expect(call.schema).toBe(VNEXT_READING_SCHEMA);
  await answer(request, call, { planningIntent: 'discuss', conversationActs: [], answer: null, delta });
}
async function render(page, request, index, count) {
  const call = await nextCall(request);
  expect(call.schema).toBe(RENDERER_SCHEMA);
  const prompt = call.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
    .find(value => value?.applicationDecision);
  expect(prompt).toBeTruthy();
  const reply = rendererReply(call);
  // The separate renderer validator rejects verbatim repeats. These suffixes do
  // not prove a method change: goal and the product guidance do so below.
  reply.text += endings[index];
  await answer(request, call, reply);
  const assistant = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
  await expect(assistant).toHaveCount(count);
  await expect(assistant.last()).toHaveText(reply.text);
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  return { decision: prompt.applicationDecision, text: reply.text };
}

// Real Pages / durable Worker / Firestore emulator. Both model providers are synthetic.
for (const scenario of cases) {
  test(`durable ${scenario.code}: third non-answer explains the options and a displayed choice advances`, async ({ page, request }) => {
    const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
    await signIn(page);
    const writes = attachWriteLedger(page);
    const posts = [];
    const postStatuses = [];
    const polls = [];
    page.on('request', outgoing => {
      const url = new URL(outgoing.url());
      if (url.origin !== 'http://127.0.0.1:18788' || url.pathname !== '/weekly-planning/turns') return;
      if (outgoing.method() === 'POST') posts.push(outgoing);
      if (outgoing.method() === 'GET') polls.push(outgoing);
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === 'http://127.0.0.1:18788' && url.pathname === '/weekly-planning/turns'
        && response.request().method() === 'POST') postStatuses.push(response.status());
    });
    await openAiPlanning(page);
    await goToTargetPlannerWeek(page);
    const beforeLegacyPlans = await documents(request, 'plans', owner);
    const beforePlans = await documents(request, 'schedule_events', owner);
    const beforeApprovalItems = await documents(request, 'weekly_planning_approval_items', owner);
    const beforeActuals = await documents(request, 'actuals', owner);
    const beforeApprovals = await documents(request, 'weekly_planning_approval_operations', owner);
    const baseline = await page.locator('.ai-planning-message-row.assistant .ai-planning-bubble').count();
    const providerBefore = await providerCount(request);

    await send(page, scenario.initial);
    await answerReading(request, { ...EMPTY, add: scenario.facts });
    const asked = await render(page, request, 0, baseline + 1);
    expect(asked.decision.questionCode).toBe(scenario.code);
    await expect.poll(async () => (await checkpoint(page))?.vnext.messages.length ?? 0).toBe(2);
    const first = await checkpoint(page);
    expect(first.ownerId).toBe(owner);
    expect(first.vnext.preview).toBeNull();
    expect(first.vnext.presentedQuestion).not.toBeNull();
    await expect(page.locator('.ai-planning-conversation').getByText(scenario.initial, { exact: true })).toHaveCount(1);

    const presentations = [];
    for (const [index, text] of ['うーん', 'まだ分からない', 'そうですね'].entries()) {
      const priorCount = await providerCount(request);
      await send(page, text);
      await answerChoice(request, null, scenario.code);
      await answerReading(request, EMPTY);
      const shown = await render(page, request, index + 1, baseline + index + 2);
      expect(shown.decision.questionCode).toBe(scenario.code);
      presentations.push(shown);
      const after = await checkpoint(page);
      expect(after.vnext.state.graph).toEqual(first.vnext.state.graph);
      expect(after.vnext.preview).toBeNull();
      await expect(page.locator('.ai-planning-conversation').getByText(text, { exact: true })).toHaveCount(1);
      expect(await providerCount(request)).toBe(priorCount + 3); // one choice, one full reading, one render
    }
    const [, second, third] = presentations;
    expect(second.decision.relevantLabels).not.toContain(GUIDANCE[scenario.code]);
    expect(third.decision.relevantLabels).toContain(GUIDANCE[scenario.code]);
    expect(third.decision.communication.goal).toBe('explain_question');
    expect(third.text).toContain(GUIDANCE[scenario.code]);
    expect(third.text).not.toBe(second.text);
    for (const label of scenario.labels) {
      expect(third.decision.relevantLabels).toContain(label);
      expect(third.text).toContain(label);
    }
    const afterThird = await checkpoint(page);
    expect(afterThird.vnext.unansweredQuestionStreak).toMatchObject({ questionKey: first.vnext.presentedQuestion.questionKey, count: 3 });
    expect(protectedWritesIn(writes.writes())).toEqual([]);

    const priorCount = await providerCount(request);
    await send(page, scenario.choice);
    await answerChoice(request, scenario.choice, scenario.code);
    const resolved = await render(page, request, 4, baseline + 5);
    expect(resolved.decision.questionCode).not.toBe(scenario.code);
    const after = await checkpoint(page);
    expect(after.conversationId).toBe(first.conversationId);
    if (scenario.code === 'remaining_inconsistent') {
      const active = new Set(after.vnext.state.graph.factLifecycles.filter(item => item.status === 'active').map(item => item.factId));
      expect(after.vnext.state.graph.workloads.find(item => active.has(item.id) && item.quantityRole === 'remaining').amount).toBe(8);
    } else {
      expect(after.vnext.state.workRelations).toMatchObject([{ kind: 'distinct' }]);
    }
    await expect(page.locator('.ai-planning-conversation').getByText(scenario.choice, { exact: true })).toHaveCount(1);
    expect(posts).toHaveLength(5);
    expect(postStatuses).toEqual([202, 202, 202, 202, 202]);
    for (const post of posts) {
      const identity = post.postDataJSON();
      expect(polls.some(poll => {
        const url = new URL(poll.url());
        return url.searchParams.get('conversationId') === identity.conversationId
          && url.searchParams.get('requestId') === identity.requestId;
      })).toBe(true);
    }
    expect(await providerCount(request)).toBe(priorCount + 2); // one selected choice and one render, no full reading
    expect(await providerCount(request)).toBe(providerBefore + 13);
    expect(protectedWritesIn(writes.writes())).toEqual([]);
    expect(await documents(request, 'plans', owner)).toEqual(beforeLegacyPlans);
    expect(await documents(request, 'schedule_events', owner)).toEqual(beforePlans);
    expect(await documents(request, 'weekly_planning_approval_items', owner)).toEqual(beforeApprovalItems);
    expect(await documents(request, 'actuals', owner)).toEqual(beforeActuals);
    expect(await documents(request, 'weekly_planning_approval_operations', owner)).toEqual(beforeApprovals);
  });
}
