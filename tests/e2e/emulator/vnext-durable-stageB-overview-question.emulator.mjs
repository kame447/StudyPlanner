import { expect, test } from '@playwright/test';
import { projectWeeklyPlanningVNext } from '../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection.ts';
import { SYNTHETIC, VNEXT_READING_SCHEMA, RENDERER_SCHEMA, answer, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';

const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const FOCUSED = 'weekly_planning_focused_contextual_answer_v5';
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const task = (localId, title) => ({ kind: 'task', localId, category: 'study', title });
const workload = (localId, taskId, amount, unitCode, unitLabel) => ({ kind: 'workload', localId,
  taskRef: { localId: taskId }, componentRef: null, quantityRole: 'target', amount, unitCode, unitLabel,
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });

test.afterEach(async ({ request }) => {
  const response = await request.post(`${SYNTHETIC}/__synthetic/reset`);
  expect(response.ok(), 'synthetic provider reset').toBe(true);
});

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
    const cores = chatId ? keys.filter(key => key.startsWith('studyplanner.weeklyPlanning.vnext.') && key.endsWith(`.${chatId}.core`)) : [];
    if (cores.length > 1) throw new Error(`Ambiguous active checkpoints: ${cores.length}`);
    return cores.length ? JSON.parse(localStorage.getItem(cores[0])) : null;
  });
}
// Full owner-scoped runQuery results, including nested approval items, without page-size truncation.
async function documents(request, collection, owner) {
  const response = await request.post(`${FIRESTORE}:runQuery`, { headers: { Authorization: 'Bearer owner' }, data: {
    structuredQuery: { from: [{ collectionId: collection, allDescendants: true }],
      where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: owner } } } },
  } });
  expect(response.ok(), `read all ${collection} for this owner`).toBe(true);
  const rows = await response.json();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.every(row => !row.error), 'owner query completed without an embedded error').toBe(true);
  return rows.flatMap(row => row.document ? [row.document] : []).sort((a, b) => a.name.localeCompare(b.name));
}
async function nativeReading(request) {
  let call = await nextCall(request);
  if (call.schema === FOCUSED) {
    await answer(request, call, { decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    call = await nextCall(request);
  }
  expect(call.schema).toBe(VNEXT_READING_SCHEMA);
  return call;
}
async function showQuestion(page, request, count, overview, amount) {
  const call = await nextCall(request);
  expect(call.schema).toBe(RENDERER_SCHEMA);
  const prompt = call.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
    .find(value => value?.applicationDecision);
  expect(prompt).toBeTruthy();
  expect(prompt.applicationDecision).toMatchObject({ actionKind: 'question', questionCode: 'missing_effort_estimate',
    communication: { goal: 'ask_question', askQuestion: true },
    questionIntent: { kind: 'effort_measurement', measurement: 'total_duration', amount, unitLabel: '枚' } });
  const reply = rendererReply(call);
  const fact = prompt.currentTurnGrounding?.mode === 'required_before_resume'
    ? prompt.currentTurnGrounding.acceptedFacts.find(item => item.factId && item.sourceText?.trim()) : null;
  const acknowledgement = fact ? `「${fact.sourceText}」について確認しました。` : '';
  reply.groundingAcknowledgement = fact ? { factIds: [fact.factId], text: acknowledgement } : null;
  // The scripted wording makes the transport observable; it does not evaluate a real model's wording or meaning.
  reply.text = `${acknowledgement}${overview}数学プリント${amount}枚の全体には何分かかりますか？`;
  for (const label of prompt.applicationDecision.relevantLabels ?? []) {
    if (!reply.text.includes(label)) reply.text += ` ${label}`;
  }
  expect(reply.text.split('？')).toHaveLength(2);
  await answer(request, call, reply);
  const assistant = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
  await expect(assistant).toHaveCount(count);
  await expect(assistant.last()).toHaveText(reply.text);
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  return { prompt, text: reply.text };
}

// Browser, Worker, validation and storage are real emulator paths; interpretation and renderer responses are synthetic.
test('the visible overview question follows its current target and revision after a correction', async ({ page, request }) => {
  const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
  await signIn(page);
  const writes = attachWriteLedger(page);
  const posts = [];
  const statuses = [];
  const polls = [];
  page.on('request', outgoing => {
    if (new URL(outgoing.url()).pathname !== '/weekly-planning/turns') return;
    if (outgoing.method() === 'POST') posts.push(outgoing);
    if (outgoing.method() === 'GET') polls.push(outgoing);
  });
  page.on('response', response => {
    if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/weekly-planning/turns') statuses.push(response.status());
  });
  await openAiPlanning(page);
  await goToTargetPlannerWeek(page);
  const collections = ['plans', 'schedule_events', 'actuals', 'weekly_planning_approval_operations', 'weekly_planning_approval_items'];
  const beforeWrites = Object.fromEntries(await Promise.all(collections.map(async name => [name, await documents(request, name, owner)])));
  const assistant = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
  const baseline = await assistant.count();
  const initialText = '今週は英語60分と数学プリント10枚を進めたい。予定案を作ってください。';
  const correctionText = '数学プリントは10枚ではなく12枚に訂正します。';

  await send(page, initialText);
  const initial = await nativeReading(request);
  await answer(request, initial, { planningIntent: 'create_plan', conversationActs: [], answer: null, delta: { ...EMPTY,
    add: [task('english', '英語'), workload('english-work', 'english', 60, 'minute', '分'),
      task('math', '数学プリント'), workload('math-work', 'math', 10, 'page', '枚')] } });
  const asked = await showQuestion(page, request, baseline + 1, '英語60分と数学プリント10枚ですね。', 10);
  await expect.poll(async () => (await checkpoint(page))?.vnext.messages.length ?? 0).toBe(2);
  const first = await checkpoint(page);
  expect(first.ownerId).toBe(owner);
  const graph = first.vnext.state.graph;
  const english = graph.tasks.find(item => item.title === '英語');
  const math = graph.tasks.find(item => item.title === '数学プリント');
  expect(english).toBeTruthy(); expect(math).toBeTruthy();
  const englishWork = graph.workloads.find(item => item.taskId === english.id);
  const mathWork = graph.workloads.find(item => item.taskId === math.id);
  expect(englishWork).toMatchObject({ amount: 60, unitCode: 'minute' });
  expect(mathWork).toMatchObject({ amount: 10, unitCode: 'page' });
  expect(asked.prompt.currentTurnGrounding.acceptedFacts.map(item => item.factId))
    .toEqual(expect.arrayContaining([english.id, englishWork.id, math.id, mathWork.id]));
  expect(asked.prompt).toMatchObject({
    currentTurnGrounding: { acceptedFacts: expect.arrayContaining([
      expect.objectContaining({ factId: english.id, kind: 'task', data: expect.objectContaining({ title: '英語' }) }),
      expect.objectContaining({ factId: englishWork.id, kind: 'workload', data: expect.objectContaining({
        taskId: english.id, amount: 60, unitCode: 'minute', unitLabel: '分' }) }),
      expect.objectContaining({ factId: math.id, kind: 'task', data: expect.objectContaining({ title: '数学プリント' }) }),
      expect.objectContaining({ factId: mathWork.id, kind: 'workload', data: expect.objectContaining({
        taskId: math.id, amount: 10, unitCode: 'page', unitLabel: '枚' }) }),
    ]) },
    planningStateSummary: { acceptedFacts: {
      tasks: expect.arrayContaining([expect.objectContaining({ id: english.id, title: '英語' }),
        expect.objectContaining({ id: math.id, title: '数学プリント' })]),
      workloads: expect.arrayContaining([expect.objectContaining({ id: englishWork.id, taskId: english.id,
        amount: 60, unitCode: 'minute', unitLabel: '分' }), expect.objectContaining({ id: mathWork.id, taskId: math.id,
        amount: 10, unitCode: 'page', unitLabel: '枚' })]),
    } },
  });
  const firstProjection = projectWeeklyPlanningVNext(first.vnext.state);
  expect(firstProjection.questions).toHaveLength(1);
  expect(firstProjection.questions[0]).toMatchObject({ code: 'missing_effort_estimate', taskId: math.id,
    forWork: { definingFactId: mathWork.id, amount: 10 } });
  expect(asked.prompt.applicationDecision.questionIntent.targetFactId).toBe(mathWork.id);
  expect(first.vnext.presentedQuestion).toEqual({ questionKey: firstProjection.questions[0].key,
    graphRevision: first.vnext.state.graph.revision, shownText: asked.text });
  expect(first.vnext.preview).toBeNull();
  await expect(page.locator('.ai-planning-plan-card')).toHaveCount(0);

  await send(page, correctionText);
  const correction = await nativeReading(request);
  const context = correction.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
    .find(value => value?.activeFacts);
  expect(context.userText).toBe(correctionText);
  const target = context.activeFacts.workloads.find(item => item.amount === 10 && item.unitCode === 'page');
  expect(target).toBeTruthy();
  await answer(request, correction, { planningIntent: 'update_plan', conversationActs: [], answer: null, delta: { ...EMPTY,
    patch: [{ kind: 'workload', localId: 'correct-math', targetFactId: target.id, amountDelta: null,
      changes: { amount: 12, quantityRole: null, unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null,
        perOccurrence: null, periodExpression: null } }] } });
  const updated = await showQuestion(page, request, baseline + 2, '数学プリントを12枚に訂正しました。', 12);
  await expect.poll(async () => (await checkpoint(page))?.vnext.messages.length ?? 0).toBe(4);
  const after = await checkpoint(page);
  expect(after.conversationId).toBe(first.conversationId);
  expect(after.vnext.state.graph.revision).toBeGreaterThan(first.vnext.state.graph.revision);
  const nextGraph = after.vnext.state.graph;
  const oldLife = nextGraph.factLifecycles.find(item => item.factId === mathWork.id);
  expect(oldLife.status).toBe('superseded');
  const newMathWork = nextGraph.workloads.find(item => item.id === oldLife.supersededByFactId);
  expect(newMathWork).toMatchObject({ taskId: math.id, amount: 12, unitCode: 'page' });
  expect(nextGraph.workloads.find(item => item.id === englishWork.id)).toEqual(englishWork);
  const nextProjection = projectWeeklyPlanningVNext(after.vnext.state);
  expect(nextProjection.questions).toHaveLength(1);
  expect(nextProjection.questions[0]).toMatchObject({ code: 'missing_effort_estimate', taskId: math.id,
    forWork: { definingFactId: newMathWork.id, amount: 12 } });
  expect(updated.prompt.applicationDecision.questionIntent.targetFactId).toBe(newMathWork.id);
  expect(after.vnext.presentedQuestion).toEqual({ questionKey: nextProjection.questions[0].key,
    graphRevision: nextGraph.revision, shownText: updated.text });
  expect(after.vnext.presentedQuestion.graphRevision).not.toBe(first.vnext.presentedQuestion.graphRevision);
  await expect(assistant.last()).toContainText('数学プリント12枚');
  await expect(assistant.last()).not.toContainText('数学プリント10枚');
  // The original bubble remains conversation history; only the latest presentation is current.
  await expect(assistant.nth(baseline)).toHaveText(asked.text);
  expect(nextGraph.effortEstimates).toEqual([]);
  expect(after.vnext.preview).toBeNull();
  await expect(page.locator('.ai-planning-plan-card')).toHaveCount(0);

  expect(posts).toHaveLength(2);
  expect(statuses).toEqual([202, 202]);
  for (const post of posts) {
    const identity = post.postDataJSON();
    expect(polls.some(poll => {
      const url = new URL(poll.url());
      return url.searchParams.get('conversationId') === identity.conversationId && url.searchParams.get('requestId') === identity.requestId;
    })).toBe(true);
  }
  expect(protectedWritesIn(writes.writes())).toEqual([]);
  expect(writes.violations(), 'no forbidden or unclassified Firestore writes').toEqual([]);
  for (const name of collections) expect(await documents(request, name, owner)).toEqual(beforeWrites[name]);
});
