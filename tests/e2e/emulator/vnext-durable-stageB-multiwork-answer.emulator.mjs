import { expect, test } from '@playwright/test';
import { SYNTHETIC, VNEXT_READING_SCHEMA, RENDERER_SCHEMA, answer, nextCall, rendererReply } from '../support/synthetic-provider-client.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { previewDialog } from '../support/vnext-chat-storage.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';

const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const FOCUSED_SCHEMA = 'weekly_planning_focused_contextual_answer_v5';
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

// runQuery streams all matches without a page-size cutoff, including nested approval items.
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

async function renderTurn(page, request, count, suffix) {
  const call = await nextCall(request);
  expect(call.schema).toBe(RENDERER_SCHEMA);
  const prompt = call.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
    .find(value => value?.applicationDecision);
  expect(prompt).toBeTruthy();
  const reply = rendererReply(call);
  reply.text += suffix;
  await answer(request, call, reply);
  const assistant = page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');
  await expect(assistant).toHaveCount(count);
  await expect(assistant.last()).toHaveText(reply.text);
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled();
  return { decision: prompt.applicationDecision, text: reply.text };
}

// The browser, durable Worker, VNext validation and scheduler are real; provider responses are synthetic.
test('durable multi-work answer keeps each known fact and presents an unsaved preview', async ({ page, request }) => {
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
  const answerText = '数学プリント全体で40分です。';

  await send(page, initialText);
  const initial = await nextCall(request);
  expect(initial.schema).toBe(VNEXT_READING_SCHEMA);
  await answer(request, initial, { planningIntent: 'create_plan', conversationActs: [], answer: null, delta: { ...EMPTY,
    add: [task('english', '英語'), workload('english-work', 'english', 60, 'minute', '分'),
      task('math', '数学プリント'), workload('math-work', 'math', 10, 'page', '枚')] } });
  const asked = await renderTurn(page, request, baseline + 1, ' 教えてください。');
  expect(asked.decision.questionCode).toBe('missing_effort_estimate');
  await expect.poll(async () => (await checkpoint(page))?.vnext.messages.length ?? 0).toBe(2);
  const first = await checkpoint(page);
  expect(first.ownerId).toBe(owner);
  expect(first.vnext.preview).toBeNull();
  expect(first.vnext.presentedQuestion).toMatchObject({ shownText: asked.text, graphRevision: first.vnext.state.graph.revision });
  const graph = first.vnext.state.graph;
  expect(graph.tasks).toHaveLength(2);
  expect(graph.workloads).toHaveLength(2);
  const english = graph.tasks.find(item => item.title === '英語');
  const math = graph.tasks.find(item => item.title === '数学プリント');
  expect(english).toBeTruthy(); expect(math).toBeTruthy();
  const englishWork = graph.workloads.find(item => item.taskId === english.id);
  const mathWork = graph.workloads.find(item => item.taskId === math.id);
  expect(englishWork).toMatchObject({ amount: 60, unitCode: 'minute' });
  expect(mathWork).toMatchObject({ amount: 10, unitCode: 'page' });
  expect(graph.effortEstimates).toEqual([]);
  await expect(page.locator('.ai-planning-plan-card')).toHaveCount(0);
  await expect(page.locator('.ai-planning-conversation').getByText(initialText, { exact: true })).toHaveCount(1);

  await send(page, answerText);
  const focused = await nextCall(request);
  expect(focused.schema).toBe(FOCUSED_SCHEMA);
  const focusContext = focused.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
    .find(value => value?.pendingQuestion);
  expect(focusContext).toMatchObject({ currentUserText: answerText, pendingQuestion: { questionCode: 'missing_effort_estimate',
    effortMeasurement: 'total_duration', questionTargetWorkload: { amount: 10, unitCode: 'page' } } });
  await answer(request, focused, { decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'total_duration',
    minutes: 40, precision: 'exact', quantityRole: null });
  const completed = await renderTurn(page, request, baseline + 2, ' 仮案を確認できます。');
  expect(completed.decision.actionKind).toBe('preview_ready');
  await expect(page.locator('.ai-planning-plan-card')).toBeVisible();
  await expect(page.locator('.ai-planning-conversation').getByText(answerText, { exact: true })).toHaveCount(1);
  await expect.poll(async () => (await checkpoint(page))?.vnext.messages.length ?? 0).toBe(4);
  const final = await checkpoint(page);
  expect(final.conversationId).toBe(first.conversationId);
  expect(final.vnext.state.graph.tasks).toEqual(graph.tasks);
  expect(final.vnext.state.graph.workloads).toEqual(graph.workloads);
  expect(final.vnext.state.graph.effortEstimates).toHaveLength(1);
  expect(final.vnext.state.graph.effortEstimates[0]).toMatchObject({ taskId: math.id, targetFactId: mathWork.id, kind: 'total_duration', minutes: 40 });
  expect(final.vnext.preview).not.toBeNull();
  expect(final.vnext.preview.blocks.map(block => block.title)).toEqual(expect.arrayContaining(['英語 60分', '数学プリント 10枚']));
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const preview = previewDialog(page);
  await expect(preview).toBeVisible();
  await expect(preview.locator('.ai-planning-draft-block').filter({ hasText: '英語' }).first()).toBeVisible();
  await expect(preview.locator('.ai-planning-draft-block').filter({ hasText: '数学プリント' }).first()).toBeVisible();

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
  for (const name of collections) expect(await documents(request, name, owner)).toEqual(beforeWrites[name]);
});
