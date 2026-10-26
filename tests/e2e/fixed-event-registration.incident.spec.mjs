import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'http://127.0.0.1:4174';
const PROXY = `${ORIGIN}/incident-proxy/chat/completions`;
const original = '明日の予定にいれて欲しいんだけど、バンドAの合わせが9~10:30\nバンドBの合わせが16~17:30で、全体ゼミが13~15、15~16時が領域ゼミで17~21時までカンファレンスになりそうです';
const events = [
  ['バンドAの合わせ', '09:00', '10:30'], ['バンドBの合わせ', '16:00', '17:30'],
  ['全体ゼミ', '13:00', '15:00'], ['領域ゼミ', '15:00', '16:00'], ['カンファレンス', '17:00', '21:00'],
];
let bridge;
test.describe.configure({ retries: 0 });
test.beforeAll(async () => {
  if (process.env.INCIDENT_LIVE === '1') {
    process.env.JEV_D5_LIVE = '1';
    const { startD5BrowserBridge } = await import('../../scripts/jev-d5-browser-bridge.mjs');
    bridge = await startD5BrowserBridge({ workerName: 'studyplanner-ai-proxy',
      evidenceDir: path.join(root, 'artifacts/incident20261026/live-receipts'),
      remainingArgs: ['--remaining-jev', '2', '--remaining-luna', '12', '--remaining-usd', '.70'],
    });
  }
});
test.afterAll(async () => { await bridge?.close(); });

function mixedReading() {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-10-27', start: '2026-10-27', end: '2026-10-27', sourceText: '明日' },
    tasks: events.map(([title, startTime, endTime], i) => ({ localId: `event-${i}`, category: 'non_study', title,
      study: null, sourceText: original, effortEstimates: [], recurrence: [],
      workloads: i === 4 ? [{ localId: 'conference-work', quantityRole: 'target', amount: 240,
        unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: original }] : [],
      temporalConstraints: [{ localId: `time-${i}`, targetLocalId: `event-${i}`,
        kind: i === 4 ? 'preferred_window' : 'fixed_interval', constraintLevel: i === 4 ? 'soft' : 'hard',
        dateExpression: '2026-10-27', namedTimePeriod: null, startTime, endTime,
        precision: i === 4 ? 'approximate' : 'exact', sourceText: original }],
    })), relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [], conversationActs: [{ kind: 'request_event_registration', targetPublicId: null }],
  };
}

async function boot(page, calls, scenario) {
  const recorded = scenario.recorded;
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
    ['features/weeklyPlanning/useWeeklyPlanningState.ts', 'const getPlanningState = useCallback(() => planningStateRef.current, []);', 'globalThis.__incidentReadState = getPlanningState;'],
    ['features/weeklyPlanning/trace/weeklyPlanningStableV5DebugTrace.ts', 'function recordWeeklyPlanningStableV5DebugTrace(params) {', '(globalThis.__incidentTrace ??= []).push(structuredClone(params));'],
  ];
  for (const [file, marker, added] of seams) await page.route(`**/src/${file}*`, async route => {
    const response = await route.fetch(); const code = await response.text();
    expect(code.split(marker)).toHaveLength(2);
    await route.fulfill({ response, body: code.replace(marker, `${marker}\n${added}`) });
  });
  await page.route(PROXY, async route => {
    const request = route.request().postDataJSON();
    const call = { schema: request.response_format?.json_schema?.name, request }; calls.push(call);
    if (recorded) {
      const saved = structuredClone(recorded[calls.length - 1]);
      expect(saved?.schema).toBe(call.schema);
      if (saved.response?.content && saved.presentation) {
        const current = request.messages.filter(m => m.role === 'user').map(m => {
          try { return JSON.parse(m.content); } catch { return null; }
        }).find(m => m?.actionId);
        const content = JSON.parse(saved.response.content);
        content.actionId = current.actionId;
        if (content.groundingAcknowledgement) {
          const oldFacts = saved.presentation.facts;
          const newFacts = current.currentTurnGrounding.acceptedFacts;
          expect(newFacts.map(f => [f.kind, f.label])).toEqual(oldFacts.map(f => [f.kind, f.label]));
          content.groundingAcknowledgement.factIds = content.groundingAcknowledgement.factIds.map(id => {
            const index = oldFacts.findIndex(f => f.factId === id);
            expect(index).toBeGreaterThanOrEqual(0);
            return newFacts[index].factId;
          });
        }
        saved.response.content = JSON.stringify(content);
      }
      Object.assign(call, { response: saved.response, status: saved.status, provider: 'recorded-live-response-not-new-call' });
      return route.fulfill({ status: saved.status, json: saved.response, headers: { 'X-StudyPlanner-AI-Provider': 'openai' } });
    }
    if (bridge) {
      const response = await fetch(bridge.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify(request) });
      const text = await response.text(); call.status = response.status;
      call.provider = response.headers.get('X-StudyPlanner-AI-Provider');
      call.response = JSON.parse(text);
      return route.fulfill({ status: response.status, body: text, headers: { 'Content-Type': 'application/json', 'X-StudyPlanner-AI-Provider': call.provider ?? 'unknown' } });
    }
    let content;
    if (call.schema === 'weekly_planning_semantic_document_v5') content = mixedReading();
    else if (call.schema === 'weekly_planning_stable_v5_dialogue_response') {
      const prompt = JSON.parse(request.messages.filter(m => m.role === 'user').at(-1).content);
      content = { actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
        questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null,
        text: '候補が3件できています。「この内容で仮予定にする」から進められます。' };
    } else throw new Error(`Unexpected mock schema ${call.schema}`);
    call.response = { content: JSON.stringify(content) }; call.status = 200; call.provider = 'injected-not-live';
    return route.fulfill({ json: call.response, headers: { 'X-StudyPlanner-AI-Provider': 'openai' } });
  });
  await page.goto(`${ORIGIN}/full-planner-recovery.html`);
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled({ timeout: 45_000 });
}

const recording = process.env.INCIDENT_REPLAY === '1' ? JSON.parse(await readFile(new URL('./fixtures/fixed-event-registration.live-20261026.json', import.meta.url), 'utf8')) : null;
const cases = recording ? [
  { name: 'replay-original', text: recording.original.text, width: 390, recorded: recording.original.calls },
  { name: 'replay-explicit-registration', text: recording.explicit.text, width: 390, recorded: recording.explicit.calls },
] : process.env.INCIDENT_LIVE === '1'
  ? [{ name: 'live-original', text: original, width: 390 },
     { name: 'live-explicit-registration', text: `${original}\n5件とも指定した開始・終了時刻の固定予定として登録してください。学習作業ではないので、分割・移動しないでください。重なっている予定は勝手に変更せず確認してください。`, width: 390 }]
  : [{ name: 'injected-mixed-mobile', text: original, width: 390 }, { name: 'injected-mixed-desktop', text: original, width: 1280 }];

for (const scenario of cases) test(scenario.name, async ({ page }, testInfo) => {
  const calls = []; const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: scenario.width, height: 844 });
  await boot(page, calls, scenario);
  const composer = page.locator('.ai-planning-composer textarea');
  await composer.fill(scenario.text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => calls.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__incidentReadState?.();
    return Boolean(state && !state.pendingTurn && state.messages.at(-1)?.role === 'assistant');
  }), { timeout: 240_000 }).toBe(true);
  const snapshot = await page.evaluate(() => ({ state: globalThis.__incidentReadState(), trace: globalThis.__incidentTrace ?? [],
    savedEvents: JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]') }));
  const preview = page.getByRole('button', { name: '計画プレビューを確認' });
  if (await preview.count()) await preview.click();
  const visibleText = await page.locator('body').innerText();
  const evidence = { scenario, boundary: bridge ? 'real-provider, real-Worker-chat-ingress, real-browser-pipeline; synthetic-auth, local-only-persistence; no-production-save' : 'injected-provider, real-browser-pipeline, local-only-persistence', calls, errors, ...snapshot, visibleText };
  await writeFile(path.join(root, `artifacts/incident20261026/${scenario.name}.json`), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(root, `artifacts/incident20261026/${scenario.name}.png`), fullPage: true });
  await testInfo.attach('incident-evidence', { body: Buffer.from(JSON.stringify(evidence)), contentType: 'application/json' });
  console.log('INCIDENT', JSON.stringify({ scenario: scenario.name, calls: calls.map(c => ({ schema: c.schema, status: c.status, provider: c.provider })),
    candidates: snapshot.state.previewCandidates, message: snapshot.state.messages.at(-1)?.content, errors }));
  expect(snapshot.savedEvents).toEqual([]);
  // A truthful conflict question is allowed; disappearing or movable appointments are not.
  const accepted = [...snapshot.trace].reverse().find(e => e.stage === 'semantic_validation_result' && e.data.accepted)?.data.parsedDocument;
  expect(accepted?.tasks).toHaveLength(5);
  for (const [title, startTime, endTime] of events) {
    const task = accepted.tasks.find(task => task.title === title);
    expect.soft(task?.temporalConstraints, `${title}: uncertainty must not grant rescheduling`).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'fixed_interval', startTime, endTime }),
    ]));
  }
  expect.soft(accepted?.conversationActs, 'Registration intent must survive representation repair').toContainEqual(
    expect.objectContaining({ kind: 'request_event_registration' }));
  if (accepted.uncertainties.some(item => item.field === 'overlap')) {
    const branch = snapshot.trace.find(e => e.stage === 'runtime_branch_selected');
    expect(branch?.data.branch).toBe('ask_question');
    expect(snapshot.state.messages.at(-1)?.content).toContain('17:00');
    expect(snapshot.state.messages.at(-1)?.content).toContain('17:30');
    expect(snapshot.state.previewCandidates).toEqual([]);
    return;
  }
  // Without a blocking question, all requested appointments must be offered unchanged.
  const candidates = snapshot.state.previewCandidates ?? [];
  expect(candidates, 'All five requested appointments must remain available; none may be dropped or rescheduled').toHaveLength(5);
  for (const [title, startTime, endTime] of events) {
    const item = candidates.find(candidate => candidate.title === title);
    expect(item).toMatchObject({ date: '2026-10-27', startTime, endTime });
  }
});
