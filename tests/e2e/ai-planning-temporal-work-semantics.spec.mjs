import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Issue #870: fixed time occupies its exact interval; movable work is an amount
// placed in free time, split only as a fallback and never when one sitting is stated.
// The semantic reading is injected; parsing, scheduling, preview, approval and
// local persistence run in the real browser pipeline.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'http://127.0.0.1:4174';
const PROXY = `${ORIGIN}/temporal-work-proxy/chat/completions`;
const TOMORROW = '2026-10-27';
const LIVE = process.env.TEMPORAL_LIVE === '1';
const evidenceDir = path.join(root, 'artifacts/temporal-work-870');
let bridge;
test.describe.configure({ retries: 0 });
test.beforeAll(async () => {
  if (!LIVE) return;
  // Opt-in, budgeted real-provider run through the existing remote-dev Worker bridge.
  await mkdir(evidenceDir, { recursive: true });
  process.env.JEV_D5_LIVE = '1';
  const { startD5BrowserBridge } = await import('../../scripts/jev-d5-browser-bridge.mjs');
  bridge = await startD5BrowserBridge({ workerName: 'studyplanner-ai-proxy', evidenceDir: path.join(evidenceDir, 'live-receipts'),
    remainingArgs: ['--remaining-jev', '4', '--remaining-luna', '30', '--remaining-usd', '1.50'] });
});
test.afterAll(async () => { await bridge?.close(); });

const document = (text, tasks, extra = {}) => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
  planningWindow: { localId: 'window', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日' },
  tasks, relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
  uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...extra,
  tasks: tasks.map(task => ({ sourceText: text, effortEstimates: [], recurrence: [], workloads: [], temporalConstraints: [], ...task })) });
const study = (localId, title, minutes, text) => ({ localId, decompositionStatus: 'atomic', category: 'study', title,
  study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
  workloads: [{ localId: `${localId}-amount`, quantityRole: 'target', amount: minutes, unitCode: 'minute', unitLabel: '分',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: text }] });
const clock = (localId, targetLocalId, kind, constraintLevel, startTime, endTime, text) => ({ localId, targetLocalId, kind,
  constraintLevel, dateExpression: 'tomorrow', namedTimePeriod: null, startTime, endTime, precision: 'exact', sourceText: text });
const busy = (startTime, endTime, text) => ({ localId: `busy-${startTime}`, kind: 'unavailable', dateExpression: 'tomorrow',
  namedTimePeriod: null, startTime, endTime, recurrenceKind: null, days: [], constraintLevel: 'hard', capacityMinutes: null, sourceText: text });

const windowText = '明日は13時40分から16時20分まで埋まっています。明日の13〜17時の間に1時間数学をしたい';
const sittingText = '明日は13時40分から16時20分まで埋まっています。明日の13〜17時の間に、連続で1時間数学をしたい';
const compoundText = '明日13〜17時にゼミがあるので予定に入れて。あと英語を1時間やりたい';
const scenarios = {
  // A hard window as the provider may send it; it must stay hard and the 60 minutes may use both 30-minute gaps.
  window: { text: windowText, reading: () => document(windowText, [{ ...study('math', '数学', 60, windowText),
    temporalConstraints: [clock('math-window', 'math', 'preferred_window', 'hard', '13:00', '17:00', windowText)] }],
  { availabilityDeclarations: [busy('13:40', '16:20', windowText)] }) },
  // The same work stated as one sitting must not be split into the gaps.
  sitting: { text: sittingText, reading: () => document(sittingText, [{ ...study('math', '数学', 60, sittingText),
    effortEstimates: [{ localId: 'math-sitting', targetLocalId: 'math-amount', kind: 'session_duration', minutes: 60,
      unitCode: null, precision: 'exact', sourceText: sittingText }],
    temporalConstraints: [clock('math-from', 'math', 'earliest_start', 'hard', '13:00', null, sittingText),
      clock('math-until', 'math', 'latest_end', 'hard', null, '17:00', sittingText)] }],
  { availabilityDeclarations: [busy('13:40', '16:20', sittingText)] }) },
  // A registration and a movable study amount in one request keep both meanings.
  compound: { text: compoundText, reading: () => document(compoundText, [
    { localId: 'seminar', category: 'non_study', title: 'ゼミ', study: null,
      temporalConstraints: [clock('seminar-time', 'seminar', 'fixed_interval', 'hard', '13:00', '17:00', compoundText)] },
    study('english', '英語', 60, compoundText)], { conversationActs: [{ kind: 'request_event_registration', targetPublicId: null }] }) },
};

function rendererReply(request) {
  // A renderer repair appends a plain-text instruction; answer the structured prompt it repairs.
  const prompt = request.messages.filter(m => m.role === 'user').map(m => {
    try { return JSON.parse(m.content); } catch { return null; }
  }).findLast(value => value?.applicationDecision);
  return { actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
    questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null, text: '内容を確認しました。' };
}

async function boot(page, calls, reading) {
  await page.clock.setFixedTime(new Date('2026-10-26T07:59:00.000Z'));
  await page.addInitScript(() => sessionStorage.setItem('studyplanner.ai.runtime.v1', JSON.stringify({ provider: 'openai', apiKey: '' })));
  await page.route('**/*', route => new URL(route.request().url()).origin === ORIGIN ? route.continue() : route.abort());
  await page.route('**/weeklyPlanningTurnRuntimeGateway.stub.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export { weeklyPlanningTurnRuntimeGateway } from ${JSON.stringify(`/@fs${root}/src/features/weeklyPlanning/application/weeklyPlanningTurnRuntimeGateway.ts`)};`,
  }));
  const seams = [
    ['lib/aiConfig.ts', 'function getCloudflareAiProxyUrl() {', `return ${JSON.stringify(PROXY)};`],
    ['lib/firebaseClient.ts', 'function getFirebaseAuth() {', 'return { currentUser: { uid: "planner-recovery-owner", getIdToken: async () => "synthetic-local-session" } };'],
    ['features/weeklyPlanning/useWeeklyPlanningState.ts', 'const getPlanningState = useCallback(() => planningStateRef.current, []);', 'globalThis.__temporalReadState = getPlanningState;'],
    ['features/weeklyPlanning/trace/weeklyPlanningStableV5DebugTrace.ts', 'function recordWeeklyPlanningStableV5DebugTrace(params) {', '(globalThis.__temporalTrace ??= []).push(structuredClone(params));'],
  ];
  for (const [file, marker, added] of seams) await page.route(`**/src/${file}*`, async route => {
    const response = await route.fetch(); const code = await response.text();
    expect(code.split(marker)).toHaveLength(2);
    await route.fulfill({ response, body: code.replace(marker, `${marker}\n${added}`) });
  });
  await page.route(PROXY, async route => {
    const request = route.request().postDataJSON();
    const schema = request.response_format?.json_schema?.name; calls.push(schema);
    if (bridge) {
      const response = await fetch(bridge.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify(request) });
      const provider = response.headers.get('X-StudyPlanner-AI-Provider') ?? 'unknown';
      return route.fulfill({ status: response.status, body: await response.text(), headers: { 'Content-Type': 'application/json', 'X-StudyPlanner-AI-Provider': provider } });
    }
    let content;
    if (schema === 'weekly_planning_semantic_document_v5') content = reading;
    else if (schema === 'weekly_planning_stable_v5_dialogue_response') content = rendererReply(request);
    else if (schema === 'weekly_planning_recovery_verdict') {
      const prompt = JSON.parse(request.messages.at(-1).content);
      content = { actionId: prompt.actionId, questionMatches: 'yes', planningDetailsNotApplied: 'yes',
        acceptedStateUnchanged: 'yes', retainedPreviewUnchanged: 'yes', noUnsupportedClaims: 'yes' };
    } else throw new Error(`Unexpected mock schema ${schema}`);
    return route.fulfill({ json: { content: JSON.stringify(content) }, headers: { 'X-StudyPlanner-AI-Provider': 'openai' } });
  });
  await page.goto(`${ORIGIN}/full-planner-recovery.html`);
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled({ timeout: 45_000 });
}

const readSaved = page => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'));
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const project = items => items.map(e => [e.title, e.date, e.startTime, e.endTime]).sort();

async function submit(page, scenario) {
  const calls = []; const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, calls, scenario.reading());
  await page.locator('.ai-planning-composer textarea').fill(scenario.text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__temporalReadState?.();
    return Boolean(state && !state.pendingTurn && state.messages.at(-1)?.role === 'assistant');
  }), { timeout: LIVE ? 240_000 : 60_000 }).toBe(true);
  const { state, trace } = await page.evaluate(() => ({ state: globalThis.__temporalReadState(), trace: globalThis.__temporalTrace ?? [] }));
  expect(errors).toEqual([]);
  // Initial interpretation, plus at most the single permitted repair when live.
  expect(calls.filter(schema => schema === 'weekly_planning_semantic_document_v5').length).toBeLessThanOrEqual(LIVE ? 2 : 1);
  // A preview never saves.
  expect(await readSaved(page)).toEqual([]);
  if (LIVE) {
    const accepted = [...trace].reverse().find(e => e.stage === 'semantic_validation_result' && e.data.accepted)?.data.parsedDocument ?? null;
    const branch = [...trace].reverse().find(e => e.stage === 'runtime_branch_selected')?.data ?? null;
    const reply = state.messages.at(-1)?.content ?? '';
    const candidates = (state.previewCandidates ?? []).map(c => ({ title: c.title, date: c.date, startTime: c.startTime, endTime: c.endTime, source: c.source }));
    // Evidence is written before judging so a failed live turn can be diagnosed.
    const stages = trace.filter(e => /renderer|dialogue|validation|branch|error|threw|repair/.test(e.stage))
      .map(e => ({ stage: e.stage, severity: e.severity, data: JSON.stringify(e.data).slice(0, 4000) }));
    await writeFile(path.join(evidenceDir, `${scenario.name}.json`), JSON.stringify({ utterance: scenario.text, accepted, branch: branch?.branch, questionCode: branch?.basis?.questionCode ?? null, reply, candidates, calls, stages }, null, 2));
    expect(reply, 'live reply must not be the technical fallback').not.toContain('返信を作れませんでした');
  }
  return state.previewCandidates ?? [];
}

async function approveAndReload(page, expectedCount) {
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const dialog = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  expect(await readSaved(page)).toEqual([]);
  const save = dialog.getByRole('button', { name: 'この内容で保存' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(async () => (await readSaved(page)).length, { timeout: 30_000 }).toBe(expectedCount);
  const saved = await readSaved(page);
  await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
  await page.reload();
  await expect.poll(async () => project(await readSaved(page))).toEqual(project(saved));
  return saved;
}

// Anonymous synthetic utterances for the opt-in live run. A clarifying question is a valid
// outcome; when candidates appear they must respect the product rule for each meaning.
const span = c => minutes(c.endTime) - minutes(c.startTime);
const total = list => list.reduce((sum, c) => sum + span(c), 0);
const work = list => list.filter(c => c.source !== 'fixed_event_registration');
const registered = list => list.filter(c => c.source === 'fixed_event_registration');
const inside = (list, from, to) => list.every(c => c.date === TOMORROW && minutes(c.startTime) >= minutes(from) && minutes(c.endTime) <= minutes(to));
const liveCases = [
  { name: 'live-fixed-seminar', text: '明日13〜17時にゼミがあるので予定に入れて', check: c => {
    expect(registered(c)).toEqual([expect.objectContaining({ date: TOMORROW, startTime: '13:00', endTime: '17:00' })]); expect(work(c)).toEqual([]); } },
  { name: 'live-window-hour', text: '明日の13〜17時の間に1時間数学を勉強したい', check: c => {
    expect(registered(c)).toEqual([]); expect(total(work(c))).toBe(60); expect(inside(c, '13:00', '17:00')).toBe(true); } },
  { name: 'live-after-two', text: '明日14時以降に1時間物理を勉強したい', check: c => {
    expect(total(work(c))).toBe(60); expect(inside(c, '14:00', '24:00')).toBe(true); } },
  { name: 'live-one-sitting', text: '明日、連続で1時間英語を勉強したい', check: c => {
    expect(work(c)).toHaveLength(1); expect(span(work(c)[0])).toBe(60); } },
  { name: 'live-fixed-then-work', text: '明日は10時から12時がバイトです。そのあと化学を2時間勉強したい', check: c => {
    expect(total(work(c))).toBe(120); expect(inside(work(c), '12:00', '24:00')).toBe(true); } },
  { name: 'live-evening-window', text: '明日18〜20時の間で30分だけ英単語をやりたい', check: c => {
    expect(total(work(c))).toBe(30); expect(inside(c, '18:00', '20:00')).toBe(true); } },
  { name: 'live-noon-registration', text: '明日正午から1時間読書する予定を入れて', check: c => {
    expect(c).toEqual([expect.objectContaining({ date: TOMORROW, startTime: '12:00', endTime: '13:00' })]); } },
  { name: 'live-compound', text: '明日の15時から1時間の会議を予定に入れて。あと数学を1時間やりたい', check: c => {
    expect(registered(c)).toEqual([expect.objectContaining({ date: TOMORROW, startTime: '15:00', endTime: '16:00' })]);
    for (const w of work(c)) expect(minutes(w.endTime) <= 15 * 60 || minutes(w.startTime) >= 16 * 60).toBe(true); } },
];

if (LIVE) test.describe('temporal work semantics with the real provider', () => {
  test.use({ timezoneId: 'Asia/Tokyo', viewport: { width: 390, height: 844 } });
  for (const scenario of liveCases) test(scenario.name, async ({ page }) => {
    const candidates = await submit(page, { ...scenario, reading: () => null });
    if (candidates.length) scenario.check(candidates);
  });
});

if (!LIVE) for (const width of [390, 1280]) test.describe(`temporal work semantics at ${width}px`, () => {
  test.use({ timezoneId: 'Asia/Tokyo', viewport: { width, height: 844 } });

  test('a hard window keeps work inside it and may use two gaps', async ({ page }) => {
    const candidates = await submit(page, scenarios.window);
    for (const c of candidates) {
      expect(c.date).toBe(TOMORROW);
      expect(minutes(c.startTime) >= 13 * 60 && minutes(c.endTime) <= 17 * 60, `${c.startTime}-${c.endTime} leaves 13-17`).toBe(true);
      expect(minutes(c.endTime) <= minutes('13:40') || minutes(c.startTime) >= minutes('16:20'), `${c.startTime}-${c.endTime} overlaps busy`).toBe(true);
    }
    expect(candidates.length, 'the hour fits only as two 30-minute parts').toBe(2);
    expect(candidates.reduce((sum, c) => sum + minutes(c.endTime) - minutes(c.startTime), 0)).toBe(60);
    expect(minutes(candidates[0].startTime)).toBeLessThan(minutes(candidates[1].startTime));
    const saved = await approveAndReload(page, 2);
    expect(saved.every(e => e.plan?.planType === 'study')).toBe(true);
  });

  test('one stated sitting is never split into gaps', async ({ page }) => {
    const candidates = await submit(page, scenarios.sitting);
    expect(candidates, 'no 60-minute free block exists inside 13-17').toEqual([]);
    expect(await readSaved(page)).toEqual([]);
  });

  test('a fixed registration and movable study keep both meanings', async ({ page }) => {
    const candidates = await submit(page, scenarios.compound);
    const registrations = candidates.filter(c => c.source === 'fixed_event_registration');
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ date: TOMORROW, startTime: '13:00', endTime: '17:00' });
    const work = candidates.filter(c => c.source !== 'fixed_event_registration');
    expect(work).toHaveLength(1);
    expect(minutes(work[0].endTime) - minutes(work[0].startTime)).toBe(60);
    expect(minutes(work[0].endTime) <= 13 * 60 || minutes(work[0].startTime) >= 17 * 60, 'study must not overlap the seminar').toBe(true);
    const saved = await approveAndReload(page, 2);
    expect(saved.find(e => e.title === 'ゼミ')).toMatchObject({ date: TOMORROW, startTime: '13:00', endTime: '17:00' });
  });
});
