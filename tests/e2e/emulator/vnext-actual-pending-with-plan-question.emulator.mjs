import { expect, test } from '@playwright/test';
import { SYNTHETIC, answer, nextCall, rendererReply, VNEXT_READING_SCHEMA, RENDERER_SCHEMA } from '../support/synthetic-provider-client.mjs';
import { WEEK_RECORDS } from '../support/vnext-actual-readings.mjs';
import { goToTargetPlannerWeek, openAiPlanning } from '../support/vnext-production-flows.mjs';
import { emulatorUserId } from '../support/schedule-event-ledger.mjs';
import { attachWriteLedger, protectedWritesIn } from '../support/vnext-firestore-writes.mjs';
import { VNEXT_STUDY_RECORD_SAVE_GUIDE } from '../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextStudyRecords.ts';

// Observation for PR #974: synthetic readings and renderer replies exercise the real
// Pages / durable Worker / Auth and Firestore emulators, not real-model behavior.
// Whether the save guide appears and the number of question marks are unresolved
// contracts: record them in an attachment, never assert either as a pass condition.
// requiredLabels is sent to the renderer as applicationDecision.relevantLabels
// (weeklyPlanningStableV5DialoguePrompt.ts:94-101); save the whole outbound body too.
const FIRESTORE = 'http://127.0.0.1:8180/v1/projects/demo-studyplanner/databases/(default)/documents';
const COLLECTIONS = ['actuals', 'plans', 'schedule_events', 'weekly_planning_approval_operations', 'weekly_planning_approval_items'];
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const focusedSchema = 'weekly_planning_focused_contextual_answer_v5';
const fallback = { decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null };
// P3 contract of vnext-durable-repeated-question.emulator.mjs (612f8c6f):
const p3Labels = ['何分くらい', '所要時間はまだ分からないので、仮置きで予定を組んで見せて', '後で決める'];
const endings = ['', ' お知らせください。', ' 一緒に確認しましょう。', ' ご検討ください。'];
const composer = page => page.locator('.ai-planning-composer textarea');
const bubbles = page => page.locator('.ai-planning-message-row.assistant .ai-planning-bubble');

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
async function previousWeek(page) {
  return page.evaluate(() => {
    const jst = new Date(Date.now() + 9 * 3_600_000);
    const today = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
    const mondayOffset = (jst.getUTCDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, day) => new Date(today + (day - mondayOffset - 7) * 86_400_000).toISOString().slice(0, 10));
  });
}
async function send(page, text) {
  await composer(page).fill(text);
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

// Server runQuery has no page-size limit. All comparisons are scoped to this
// owner, including nested approval items, and reject incomplete/error responses.
async function ownerDocuments(request, owner, collection) {
  const response = await request.post(`${FIRESTORE}:runQuery`, { headers: { Authorization: 'Bearer owner' }, data: {
    structuredQuery: { from: [{ collectionId: collection, allDescendants: true }],
      where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: owner } } } },
  } });
  expect(response.ok(), `owner query ${collection}`).toBe(true);
  const rows = await response.json();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.every(row => !row.error), `complete query ${collection}`).toBe(true);
  return rows.flatMap(row => row.document ? [row.document] : []).sort((a, b) => a.name.localeCompare(b.name));
}
async function snapshot(request, owner) {
  return Object.fromEntries(await Promise.all(COLLECTIONS.map(async collection => [collection, await ownerDocuments(request, owner, collection)])));
}

// A focused answer may abstain; the existing P3 spec then supplies one native
// unknown reading. This synthetic fallback asserts no interpretation by keywords.
async function nativeReading(request) {
  let call = await nextCall(request);
  if (call.schema === focusedSchema) {
    await answer(request, call, fallback);
    call = await nextCall(request);
  }
  expect(call.schema).toBe(VNEXT_READING_SCHEMA);
  return call;
}
async function receivedCount(request) {
  const response = await request.get(`${SYNTHETIC}/__synthetic/requests`);
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(Array.isArray(payload.received)).toBe(true);
  return payload.received.length;
}
function renderPrompt(call) {
  const prompt = call.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
    .find(value => value?.applicationDecision);
  expect(prompt, 'renderer request carries an application decision').toBeTruthy();
  expect(Array.isArray(prompt.applicationDecision.relevantLabels), 'renderer requiredLabels').toBe(true);
  return prompt;
}

// Handle the existing renderer's one permitted repair if it actually requests it;
// capture both requests and the final UI text, including a possible fallback.
async function renderTurn(page, request, assistantCount, index, observation) {
  const attempts = observation.attempts = [];
  let call = await nextCall(request);
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(call.schema).toBe(RENDERER_SCHEMA);
    const prompt = renderPrompt(call);
    const response = rendererReply(call);
    response.text += endings[index] + (attempt ? ' 別の言い方でお伝えします。' : '');
    const observed = await receivedCount(request);
    attempts.push({ rendererRequest: call.body, requiredLabels: prompt.applicationDecision.relevantLabels,
      decision: prompt.applicationDecision, syntheticResponse: response });
    await answer(request, call, response);
    let state;
    await expect.poll(async () => {
      if (await receivedCount(request) > observed) return 'next';
      if (await bubbles(page).count() === assistantCount + 1 && await composer(page).isEnabled()) return 'done';
      return 'waiting';
    }, { message: 'renderer settles or requests repair' }).not.toBe('waiting');
    const after = await receivedCount(request);
    state = after > observed ? 'next' : 'done';
    if (state === 'done') break;
    if (attempt === 1) throw new Error('Unexpected additional renderer request after the bounded repair');
    call = await nextCall(request);
  }
  await expect(bubbles(page)).toHaveCount(assistantCount + 1);
  await expect(composer(page)).toBeEnabled();
  const displayed = await bubbles(page).last().innerText();
  Object.assign(observation, { displayed,
    fullwidthQuestionMarks: [...displayed].filter(char => char === '？').length,
    asciiQuestionMarks: [...displayed].filter(char => char === '?').length,
    containsSaveGuide: displayed.includes(VNEXT_STUDY_RECORD_SAVE_GUIDE),
    containsSaveWord: displayed.includes('保存') });
  return observation;
}

test('observe unanswered plan question while six actuals remain provisional', async ({ page, request }, testInfo) => {
  const observations = [];
  try {
    const owner = await emulatorUserId(request, { email: test.info().project.metadata.email, password: process.env.STUDYPLANNER_LIVE_PASSWORD });
    await signIn(page);
    const writes = attachWriteLedger(page);
    const baseline = await snapshot(request, owner);
    const week = await previousWeek(page);
    await openAiPlanning(page);
    await goToTargetPlannerWeek(page);

    const suffix = String(Date.now());
    const records = WEEK_RECORDS.map(item => ({ dateExpression: week[item.day], subject: `${item.subject}${suffix}`, minutes: item.minutes }));
    const initial = `先週の実績です。月曜は数学${suffix}を60分、火曜は英語${suffix}を45分、水曜は現代文${suffix}を30分、木曜は休み、金曜は英語${suffix}を50分、土曜は数学${suffix}を120分、日曜は化学${suffix}を90分勉強しました。`;
    let count = await bubbles(page).count();
    await send(page, initial);
    const initialReading = await nativeReading(request);
    await answer(request, initialReading, { planningIntent: 'discuss', conversationActs: [], answer: null, delta: EMPTY,
      studyRecords: records, studyRecordQuestion: null, studyRestDays: [week[3]] });
    await expect(bubbles(page)).toHaveCount(count + 1);
    await expect(composer(page)).toBeEnabled();
    const actualCheckpoint = await checkpoint(page);
    expect(actualCheckpoint.ownerId).toBe(owner);
    expect(actualCheckpoint.vnext.actualRecords).toHaveLength(6);
    expect(actualCheckpoint.vnext.actualRecords.every(record => record.status === 'pending')).toBe(true);
    expect(await snapshot(request, owner)).toEqual(baseline);
    expect(protectedWritesIn(writes.writes())).toEqual([]);

    count = await bubbles(page).count();
    await send(page, 'ゼミ資料は20枚で12枚できた');
    const planReading = await nativeReading(request);
    await answer(request, planReading, { planningIntent: 'discuss', conversationActs: [], answer: null, delta: {
      ...EMPTY, add: [
        { kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' },
        { kind: 'workload', localId: 'total', taskRef: { localId: 'slides' }, componentRef: null,
          quantityRole: 'scope_total', amount: 20, unitCode: 'page', unitLabel: '枚',
          rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
        { kind: 'workload', localId: 'done', taskRef: { localId: 'slides' }, componentRef: null,
          quantityRole: 'completed', amount: 12, unitCode: 'page', unitLabel: '枚',
          rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
      ],
    }, studyRecords: [], studyRecordQuestion: null, studyRestDays: [] });
    const planObservation = { turn: 'initial_plan_question' };
    observations.push(planObservation);
    const asked = await renderTurn(page, request, count, 0, planObservation);
    expect(asked.attempts.at(-1).decision.questionCode).toBe('missing_effort_estimate');
    const first = await checkpoint(page);
    expect(first.vnext.presentedQuestion).not.toBeNull();
    expect(first.vnext.preview).toBeNull();
    expect(first.vnext.actualRecords).toEqual(actualCheckpoint.vnext.actualRecords);
    const questionKey = first.vnext.presentedQuestion.questionKey;
    const revision = first.vnext.presentedQuestion.graphRevision;
    expect(questionKey).toBeTruthy();
    expect(await snapshot(request, owner)).toEqual(baseline);
    expect(protectedWritesIn(writes.writes())).toEqual([]);

    for (const [index, text] of ['全部', 'ない', 'そういうこと'].entries()) {
      count = await bubbles(page).count();
      await send(page, text);
      const reading = await nativeReading(request);
      const context = reading.body.messages.map(message => { try { return JSON.parse(message.content); } catch { return null; } })
        .find(value => value?.openQuestions);
      // Provider question keys are invocation-local aliases; checkpoint keys are domain identities.
      const presented = context?.presentedQuestion;
      expect(presented?.key).toBeTruthy();
      expect(presented?.code).toBe('missing_effort_estimate');
      expect(context.openQuestions.some(question => question.key === presented.key && question.code === 'missing_effort_estimate')).toBe(true);
      await answer(request, reading, { planningIntent: 'unknown', conversationActs: [], answer: null, delta: EMPTY,
        studyRecords: [], studyRecordQuestion: null, studyRestDays: [] });
      const observation = { turn: index + 1, userText: text };
      observations.push(observation);
      const observed = await renderTurn(page, request, count, index + 1, observation);
      const current = await checkpoint(page);
      expect(current.conversationId).toBe(first.conversationId);
      expect(current.vnext.presentedQuestion).toMatchObject({ questionKey, graphRevision: revision });
      expect(current.vnext.state.graph).toEqual(first.vnext.state.graph);
      expect(current.vnext.actualRecords).toEqual(first.vnext.actualRecords);
      expect(current.vnext.unansweredQuestionStreak).toMatchObject({ questionKey, count: index + 1 });
      expect(await snapshot(request, owner)).toEqual(baseline);
      expect(protectedWritesIn(writes.writes())).toEqual([]);
      if (index === 2) {
        const decision = observed.attempts.at(-1).decision;
        expect(decision.questionCode).toBe('missing_effort_estimate');
        expect(decision.communication.goal).toBe('explain_question');
        expect(decision.relevantLabels).toEqual(expect.arrayContaining(p3Labels));
        for (const label of p3Labels) expect(observed.displayed).toContain(label);
      }
    }
  } finally {
    // The data is entirely synthetic; attach even on an assertion failure so the
    // observed renderer requests and displayed replies remain available to review.
    await testInfo.attach('pending-actuals-plan-question-observations.json', {
      body: JSON.stringify(observations, null, 2), contentType: 'application/json',
    });
  }
});
