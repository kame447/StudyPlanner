import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  // Evidence files are written here; a clean CI checkout has no artifacts directory.
  await mkdir(path.join(root, 'artifacts/incident20261026'), { recursive: true });
  if (process.env.INCIDENT_LIVE === '1') {
    process.env.JEV_D5_LIVE = '1';
    const { startD5BrowserBridge } = await import('../../scripts/jev-d5-browser-bridge.mjs');
    bridge = await startD5BrowserBridge({ workerName: 'studyplanner-ai-proxy',
      evidenceDir: path.join(root, 'artifacts/incident20261026/live-receipts'),
      remainingArgs: ['--remaining-jev', '2', '--remaining-luna', '24', '--remaining-usd', '1.30'],
    });
  }
});
test.afterAll(async () => { await bridge?.close(); });

// Correct reading of the original request: five resolved hard fixed intervals plus
// the typed registration act. The tentative conference keeps fixed time.
function fixedReading() {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日' },
    tasks: events.map(([title, startTime, endTime], i) => ({ localId: `event-${i}`, category: 'non_study', title,
      study: null, sourceText: original, effortEstimates: [], recurrence: [], workloads: [],
      temporalConstraints: [{ localId: `time-${i}`, targetLocalId: `event-${i}`, kind: 'fixed_interval', constraintLevel: 'hard',
        dateExpression: 'tomorrow', namedTimePeriod: null, startTime, endTime,
        precision: i === 4 ? 'approximate' : 'exact', sourceText: original }],
    })), relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [], conversationActs: [{ kind: 'request_event_registration', targetPublicId: null }],
  };
}

// Deterministic stand-in for the renderer: it only restates application facts.
function rendererReply(request) {
  const prompt = JSON.parse(request.messages.filter(m => m.role === 'user').at(-1).content);
  const registration = prompt.applicationDecision.communication?.eventRegistration;
  const overlaps = (registration?.overlaps ?? []).map(o => `${o.startTime}〜${o.endTime}は${o.titles.join('と')}が重なっています。`).join('');
  const text = registration
    ? `${registration.candidates.length}件の予定候補をプレビューに用意しました。${overlaps}まだ保存していないので、確認して「${prompt.applicationDecision.previewPromotionControlLabel ?? 'この内容で仮予定にする'}」から進めてください。`
    : '内容を確認しました。';
  return { actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
    questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null, text };
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
    if (recorded && call.schema === 'weekly_planning_semantic_document_v5') {
      // Replay only the recorded semantic outputs; extra semantic calls are a budget regression.
      const saved = recorded.filter(c => c.schema === call.schema)[calls.filter(c => c.schema === call.schema).length - 1];
      expect(saved, 'No semantic call beyond the recorded initial response and single repair').toBeTruthy();
      Object.assign(call, { response: saved.response, status: saved.status, provider: 'recorded-live-response-not-new-call' });
      return route.fulfill({ status: saved.status, json: saved.response, headers: { 'X-StudyPlanner-AI-Provider': 'openai' } });
    }
    if (recorded && scenario.recordedRenderer && call.schema === 'weekly_planning_stable_v5_dialogue_response') {
      // Same application decision as the recording: replay the real reply, remapping only fresh IDs.
      const saved = structuredClone(recorded.filter(c => c.schema === call.schema)[calls.filter(c => c.schema === call.schema).length - 1]);
      expect(saved?.presentation, 'renderer replay requires the recorded presentation').toBeTruthy();
      const current = request.messages.filter(m => m.role === 'user').map(m => {
        try { return JSON.parse(m.content); } catch { return null; }
      }).find(m => m?.actionId);
      const content = JSON.parse(saved.response.content);
      content.actionId = current.actionId;
      if (content.groundingAcknowledgement) {
        const oldFacts = saved.presentation.facts;
        const newFacts = current.currentTurnGrounding.acceptedFacts;
        expect(newFacts.map(f => [f.kind, f.label])).toEqual(oldFacts.map(f => [f.kind, f.label]));
        content.groundingAcknowledgement.factIds = content.groundingAcknowledgement.factIds.map(id => newFacts[oldFacts.findIndex(f => f.factId === id)].factId);
      }
      saved.response.content = JSON.stringify(content);
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
    if (call.schema === 'weekly_planning_semantic_document_v5') content = fixedReading();
    else if (call.schema === 'weekly_planning_stable_v5_dialogue_response') content = rendererReply(request);
    else if (call.schema === 'weekly_planning_recovery_verdict') {
      const prompt = JSON.parse(request.messages.at(-1).content);
      content = { actionId: prompt.actionId, questionMatches: 'yes', planningDetailsNotApplied: 'yes',
        acceptedStateUnchanged: 'yes', retainedPreviewUnchanged: 'yes', noUnsupportedClaims: 'yes' };
    }
    else throw new Error(`Unexpected mock schema ${call.schema}`);
    call.response = { content: JSON.stringify(content) }; call.status = 200; call.provider = 'injected-not-live';
    return route.fulfill({ json: call.response, headers: { 'X-StudyPlanner-AI-Provider': 'openai' } });
  });
  await page.goto(`${ORIGIN}/full-planner-recovery.html`);
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(page.locator('.ai-planning-composer textarea')).toBeEnabled({ timeout: 45_000 });
}

const recording = process.env.INCIDENT_REPLAY === '1' ? JSON.parse(await readFile(new URL('./fixtures/fixed-event-registration.live-20261026.json', import.meta.url), 'utf8')) : null;
// Live cases use the anonymized utterance and synthetic regressions only (no real user data).
const liveRegressions = [
  { name: 'live-time-unresolved', kind: 'unresolved', width: 390, text: '明日カンファレンスが入りそうなので予定に入れておいてほしいです' },
  { name: 'live-busy-study-consult', kind: 'consult', width: 1280, text: '明日は9時から10時半と13時から16時が埋まっています。空いている時間に英語を2時間勉強したいです' },
  { name: 'live-compound', kind: 'compound', width: 390, text: '明日の13時から15時のゼミを予定に入れて。あと数学の問題集を1時間やりたいので、それも予定を作って' },
];
const cases = recording ? [
  { name: 'replay-original', kind: 'replay-original', text: recording.original.text, width: 390, recorded: recording.original.calls },
  { name: 'replay-explicit-registration', kind: 'registration', text: recording.explicit.text, width: 1280, recorded: recording.explicit.calls, recordedRenderer: true },
] : process.env.INCIDENT_LIVE === '1'
  ? [{ name: 'live-original', kind: 'registration', text: original, width: 390 }, ...liveRegressions]
  : [{ name: 'injected-registration-mobile', kind: 'registration', text: original, width: 390, approve: true },
     { name: 'injected-registration-desktop', kind: 'registration', text: original, width: 1280, approve: true }];

const readSaved = page => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'));
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

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
  const visibleText = await page.locator('body').innerText();
  const evidence = { scenario: { ...scenario, recorded: undefined }, boundary: bridge ? 'real-provider, real-Worker-chat-ingress, real-browser-pipeline; synthetic-auth, local-only-persistence; no-production-save' : recording ? 'recorded-semantic-provider, stub-renderer, real-browser-pipeline, local-only-persistence' : 'injected-provider, real-browser-pipeline, local-only-persistence', calls, errors, ...snapshot, visibleText };
  await writeFile(path.join(root, `artifacts/incident20261026/${scenario.name}.json`), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(root, `artifacts/incident20261026/${scenario.name}.png`), fullPage: true });
  await testInfo.attach('incident-evidence', { body: Buffer.from(JSON.stringify(evidence)), contentType: 'application/json' });
  console.log('INCIDENT', JSON.stringify({ scenario: scenario.name, calls: calls.map(c => ({ schema: c.schema, status: c.status, provider: c.provider })),
    candidates: snapshot.state.previewCandidates?.map(c => [c.title, c.date, c.startTime, c.endTime, c.source]), message: snapshot.state.messages.at(-1)?.content, errors }));
  expect(errors).toEqual([]);
  // Preview generation never saves an event.
  expect(snapshot.savedEvents).toEqual([]);
  const candidates = snapshot.state.previewCandidates ?? [];
  const semanticCalls = calls.filter(c => c.schema === 'weekly_planning_semantic_document_v5');
  expect(semanticCalls.length, 'initial interpretation plus at most one repair').toBeLessThanOrEqual(2);
  const accepted = [...snapshot.trace].reverse().find(e => e.stage === 'semantic_validation_result' && e.data.accepted)?.data.parsedDocument;

  if (scenario.kind === 'replay-original') {
    // The recorded repair turned the tentative conference movable and dropped the
    // registration act. It must be rejected, not converted into split work.
    expect(semanticCalls).toHaveLength(2);
    expect(accepted, 'the semantically corrupted repair must not be accepted').toBeUndefined();
    expect(candidates).toEqual([]);
    return;
  }
  const lastBranchEvent = [...snapshot.trace].reverse().find(e => e.stage === 'runtime_branch_selected')?.data;
  const lastBranch = lastBranchEvent?.branch;
  // A question outcome: an explicit question branch, or a no-candidate branch that carries a question.
  const askedQuestion = lastBranch === 'ask_question' || Boolean(lastBranchEvent?.basis?.questionCode);
  const reply = snapshot.state.messages.at(-1)?.content ?? '';
  // Every live outcome, with or without candidates, must reach the user as a real reply.
  if (bridge) expect(reply, 'live reply must not be the technical fallback').not.toContain('返信を作れませんでした');
  if (scenario.kind === 'unresolved') {
    expect(candidates, 'an unresolved time must not become a guessed registration').toEqual([]);
    // A real question or the truthful manual-entry handoff; never a rejected interpretation or fallback.
    expect(lastBranch).not.toBe('normalization_rejected');
    expect(askedQuestion || lastBranch === 'fixed_event_manual_entry', `question or manual entry expected, got ${lastBranch}`).toBe(true);
    expect(reply).not.toContain('返信を作れませんでした');
    return;
  }
  if (scenario.kind === 'consult') {
    // Busy times constrain study placement only; no registration candidate appears.
    expect(candidates.length, 'the requested study must be placed').toBeGreaterThan(0);
    expect(candidates.filter(c => c.source === 'fixed_event_registration')).toEqual([]);
    for (const c of candidates) for (const [s, e] of [['09:00', '10:30'], ['13:00', '16:00']]) {
      expect(minutes(c.endTime) <= minutes(s) || minutes(c.startTime) >= minutes(e), `${c.title} ${c.startTime}-${c.endTime} overlaps busy ${s}-${e}`).toBe(true);
    }
    return;
  }
  if (scenario.kind === 'compound') {
    const registrations = candidates.filter(c => c.source === 'fixed_event_registration');
    if (candidates.length === 0) {
      // A clarification is valid only as a real question; nothing was guessed or saved.
      expect(lastBranch).not.toBe('normalization_rejected');
      expect(askedQuestion, `question expected, got ${lastBranch}`).toBe(true);
      expect(reply).not.toContain('返信を作れませんでした');
      return;
    }
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ date: '2026-10-27', startTime: '13:00', endTime: '15:00' });
    for (const c of candidates.filter(c => c.source !== 'fixed_event_registration')) {
      expect(minutes(c.endTime) <= 13 * 60 || minutes(c.startTime) >= 15 * 60, 'study must not overlap the registered seminar').toBe(true);
    }
    return;
  }

  // Registration of the original five appointments.
  expect(accepted?.tasks).toHaveLength(5);
  for (const [title, startTime, endTime] of events) {
    const task = accepted.tasks.find(task => task.title === title);
    expect(task?.temporalConstraints, `${title}: uncertainty must not grant rescheduling`).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'fixed_interval', startTime, endTime }),
    ]));
    expect(task.temporalConstraints.filter(c => c.kind === 'preferred_window'), `${title}: must not become movable`).toEqual([]);
  }
  if (!bridge) expect(accepted.conversationActs).toContainEqual(expect.objectContaining({ kind: 'request_event_registration' }));
  if (candidates.length === 0) {
    const branch = [...snapshot.trace].reverse().find(e => e.stage === 'runtime_branch_selected');
    expect(branch?.data.branch, 'without candidates the turn must ask a real question').toBe('ask_question');
    if (!bridge) {
      // The recorded explicit request asks a truthful question that names the overlap.
      expect(snapshot.state.messages.at(-1)?.content).toContain('17:00');
      expect(snapshot.state.messages.at(-1)?.content).toContain('17:30');
      return;
    }
    // Live: answer one clarification as a user would; then all five must be offered unchanged.
    const before = snapshot.state.messages.length;
    await composer.fill('カンファレンスも17時から21時で確定です。5件とも予定に入れてください。');
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await expect.poll(() => page.evaluate(count => {
      const state = globalThis.__incidentReadState?.();
      return Boolean(state && !state.pendingTurn && state.messages.length > count && state.messages.at(-1)?.role === 'assistant');
    }, before), { timeout: 240_000 }).toBe(true);
    Object.assign(snapshot, await page.evaluate(() => ({ state: globalThis.__incidentReadState(),
      savedEvents: JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]') })));
    expect(snapshot.savedEvents).toEqual([]);
    candidates.splice(0, candidates.length, ...(snapshot.state.previewCandidates ?? []));
    await writeFile(path.join(root, `artifacts/incident20261026/${scenario.name}-after-answer.json`), JSON.stringify({ calls, state: snapshot.state }, null, 2));
  }
  expect(candidates, 'All five requested appointments must remain available; none may be dropped or rescheduled').toHaveLength(5);
  for (const [title, startTime, endTime] of events) {
    expect(candidates.find(c => c.title === title)).toMatchObject({ date: '2026-10-27', startTime, endTime, source: 'fixed_event_registration' });
  }
  // A renderer repair appends a plain-text instruction; read the structured prompt it repairs.
  const rendererPrompts = calls.filter(c => c.schema === 'weekly_planning_stable_v5_dialogue_response')
    .flatMap(c => c.request.messages.filter(m => m.role === 'user').flatMap(m => {
      try { const value = JSON.parse(m.content); return value?.applicationDecision ? [value] : []; } catch { return []; }
    }));
  const overlaps = rendererPrompts.at(-1)?.applicationDecision.communication?.eventRegistration?.overlaps ?? [];
  expect(overlaps).toContainEqual(expect.objectContaining({ date: '2026-10-27', startTime: '17:00', endTime: '17:30' }));
  if (bridge) {
    // A correct real-model reply must reach the user instead of the technical fallback.
    const reply = snapshot.state.messages.at(-1)?.content ?? '';
    expect(reply).not.toContain('返信を作れませんでした');
    expect(reply).toContain('17');
  }
  if (!scenario.approve) return;

  // Explicit approval is the only save boundary; it saves each appointment once, unchanged.
  await page.getByRole('button', { name: '計画プレビューを確認' }).click();
  const dialog = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(dialog).toBeVisible();
  for (const [title] of events) await expect(dialog.getByText(title, { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Overlapping appointments are shown side by side; neither hides the other's end.
  const band = dialog.locator('[title="バンドBの合わせ 16:00-17:30"]').first();
  const conference = dialog.locator('[title="カンファレンス 17:00-21:00"]').first();
  await expect(band).toBeVisible(); await expect(conference).toBeVisible();
  const [bandBox, conferenceBox] = [await band.boundingBox(), await conference.boundingBox()];
  expect(bandBox.x + bandBox.width <= conferenceBox.x + 1 || conferenceBox.x + conferenceBox.width <= bandBox.x + 1,
    `overlapping blocks must not cover each other: ${JSON.stringify({ bandBox, conferenceBox })}`).toBe(true);
  await dialog.screenshot({ path: path.join(root, `artifacts/incident20261026/${scenario.name}-preview.png`) });
  await dialog.getByRole('button', { name: 'この内容で仮予定にする' }).click();
  expect(await readSaved(page)).toEqual([]);
  const save = dialog.getByRole('button', { name: 'この内容で保存' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(async () => (await readSaved(page)).length, { timeout: 30_000 }).toBe(5);
  const project = items => items.map(e => [e.title, e.date, e.startTime, e.endTime, e.kind, e.plan?.planType, e.provenance?.sourceType]).sort();
  const savedOnce = await readSaved(page);
  expect(project(savedOnce)).toEqual(events.map(([title, s, e]) => [title, '2026-10-27', s, e, 'general', 'other', 'weekly-planning']).sort());
  await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
  await page.reload();
  await expect.poll(async () => project(await readSaved(page))).toEqual(project(savedOnce));
  await page.screenshot({ path: path.join(root, `artifacts/incident20261026/${scenario.name}-after-reload.png`), fullPage: true });
});
