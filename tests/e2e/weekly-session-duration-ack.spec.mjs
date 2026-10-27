import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Synthetic provider responses; real semantic validation, renderer validation,
// scheduler, preview, approval and local persistence. No production requests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'http://127.0.0.1:4174';
const PROXY = `${ORIGIN}/session-ack-proxy/chat/completions`;
const TEXT = '明日、連続で1時間英語を勉強したい';
const ACK = '英語の勉強は明日、連続で1時間（1回あたり60分）ですね。';
const reading = {
  schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
  planningWindow: { localId: 'window', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日' },
  tasks: [{ localId: 'english', category: 'study', title: '英語の勉強', decompositionStatus: 'atomic',
    study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
    workloads: [{ localId: 'amount', quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: TEXT }],
    effortEstimates: [{ localId: 'session', targetLocalId: 'amount', kind: 'session_duration', minutes: 60,
      unitCode: null, precision: 'exact', sourceText: TEXT }],
    temporalConstraints: [], recurrence: [], sourceText: TEXT }],
  relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
  uncertainties: [], corrections: [], decisions: [], conversationActs: [],
};

test.describe.configure({ retries: 0 });
const savedEvents = page => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'));

async function boot(page, mode) {
  const calls = [];
  await page.clock.setFixedTime(new Date('2026-10-26T07:59:00.000Z'));
  await page.addInitScript(() => sessionStorage.setItem('studyplanner.ai.runtime.v1', JSON.stringify({ provider: 'openai', apiKey: '' })));
  await page.route('**/*', route => new URL(route.request().url()).origin === ORIGIN ? route.continue() : route.abort());
  await page.route('**/weeklyPlanningTurnRuntimeGateway.stub.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export { weeklyPlanningTurnRuntimeGateway } from ${JSON.stringify(`/@fs${root}/src/features/weeklyPlanning/application/weeklyPlanningTurnRuntimeGateway.ts`)};`,
  }));
  const seams = [
    ['lib/aiConfig.ts', 'function getCloudflareAiProxyUrl() {', `return ${JSON.stringify(PROXY)};`],
    ['lib/firebaseClient.ts', 'function getFirebaseAuth() {', 'return { currentUser: { uid: "planner-recovery-owner", getIdToken: async () => "synthetic-session" } };'],
    ['features/weeklyPlanning/useWeeklyPlanningState.ts', 'const getPlanningState = useCallback(() => planningStateRef.current, []);', 'globalThis.__sessionAckState = getPlanningState;'],
  ];
  for (const [file, marker, added] of seams) await page.route(`**/src/${file}*`, async route => {
    const response = await route.fetch(); const code = await response.text();
    expect(code.split(marker)).toHaveLength(2);
    await route.fulfill({ response, body: code.replace(marker, `${marker}\n${added}`) });
  });
  await page.route(PROXY, async route => {
    const request = route.request().postDataJSON();
    const schema = request.response_format?.json_schema?.name;
    calls.push(schema);
    let content;
    if (schema === 'weekly_planning_semantic_document_v5') content = reading;
    else if (schema === 'weekly_planning_stable_v5_dialogue_response') {
      const prompt = request.messages.filter(message => message.role === 'user').map(message => {
        try { return JSON.parse(message.content); } catch { return null; }
      }).findLast(value => value?.applicationDecision);
      const effort = prompt.currentTurnGrounding.acceptedFacts.find(fact => fact.kind === 'effort_estimate');
      expect(effort?.data).toMatchObject({ kind: 'session_duration', minutes: 60 });
      const ack = mode === 'invented' ? ACK.replace('60分', '90分') : ACK;
      const applicationAck = mode === 'canonical' || mode === 'echo' || mode === 'extra-duration';
      if (applicationAck) expect(prompt.applicationDecision.sessionAcknowledgement).toMatchObject({ source: 'application', factIds: [effort.factId] });
      content = { actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
        questionCode: prompt.applicationDecision.questionCode,
        groundingAcknowledgement: applicationAck ? null : { factIds: [effort.factId], text: ack },
        text: `${applicationAck ? mode === 'extra-duration' ? '1時間の希望も受け取りました。' : mode === 'echo' ? prompt.applicationDecision.sessionAcknowledgement.text : '' : ack}${prompt.applicationDecision.previewCount}件の候補を用意しました。「${prompt.applicationDecision.previewPromotionControlLabel}」を選べます。` };
    } else throw new Error(`Unexpected provider schema: ${schema}`);
    await route.fulfill({ json: { content: JSON.stringify(content) }, headers: { 'X-StudyPlanner-AI-Provider': 'openai' } });
  });
  await page.goto(`${ORIGIN}/full-planner-recovery.html`);
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled({ timeout: 45_000 });
  await page.locator('.ai-planning-composer textarea').fill(TEXT);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__sessionAckState?.();
    return Boolean(state && !state.pendingTurn && state.messages.at(-1)?.role === 'assistant');
  }), { timeout: 60_000 }).toBe(true);
  expect(calls.filter(schema => schema === 'weekly_planning_semantic_document_v5')).toHaveLength(1);
  expect(calls.filter(schema => schema === 'weekly_planning_stable_v5_dialogue_response').length).toBeGreaterThan(0);
  return page.evaluate(() => globalThis.__sessionAckState());
}

for (const width of [390, 1280]) test.describe(`session duration ACK at ${width}px`, () => {
  test.use({ timezoneId: 'Asia/Tokyo', viewport: { width, height: 844 } });

  for (const mode of ['equivalent', 'canonical', 'echo']) test(`${mode} confirmation reaches preview, explicit approval, one save and reload`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const state = await boot(page, mode);
    const expectedAck = mode === 'equivalent' ? ACK : '「英語の勉強」は1回あたり60分です。';
    expect(state.messages.at(-1).content.split(expectedAck)).toHaveLength(2);
    expect(state.messages.at(-1).content).not.toContain('返信を作れませんでした');
    expect(state.previewCandidates).toHaveLength(1);
    const candidate = state.previewCandidates[0];
    expect(candidate).toMatchObject({ title: '英語の勉強 60分', date: '2026-10-27' });
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    expect(minutes(candidate.endTime) - minutes(candidate.startTime)).toBe(60);
    expect(await savedEvents(page)).toEqual([]);
    await page.getByRole('button', { name: '計画プレビューを確認' }).click();
    const dialog = page.getByRole('dialog', { name: '計画プレビュー' });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'この内容で仮予定にする' }).click();
    expect(await savedEvents(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'この内容で保存' }).click();
    await expect.poll(async () => (await savedEvents(page)).length).toBe(1);
    const saved = await savedEvents(page);
    expect(saved[0]).toMatchObject({ title: candidate.title, date: candidate.date, startTime: candidate.startTime, endTime: candidate.endTime });
    await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
    await page.reload();
    await expect.poll(async () => await savedEvents(page)).toEqual(saved);
    expect(errors).toEqual([]);
  });

  for (const mode of ['invented', 'extra-duration']) test(`${mode} cannot expose a preview or save`, async ({ page }) => {
    const state = await boot(page, mode);
    expect(state.messages.at(-1).content).toContain('返信を作れませんでした');
    expect(state.previewCandidates ?? []).toEqual([]);
    await expect(page.getByRole('button', { name: '計画プレビューを確認' })).toHaveCount(0);
    expect(await savedEvents(page)).toEqual([]);
  });
});
