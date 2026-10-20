import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './support/fixed-clock.mjs';

// Tier A+B: real client/semantic/runtime/application/UI and the existing local
// repository. Only final Worker responses are stipulated; no real provider or Worker ingress executes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const URL = 'http://127.0.0.1:4174/full-planner-recovery.html';
const PROXY = 'http://127.0.0.1:4174/mock-jev-proxy/chat/completions';
const SETUP = '8月20日から26日で数学20問を1問2分。まず条件だけ確認してください。';
const CORRECTION = '期間を8月21日から27日に訂正してください。まだ保存しないで。';
const REGENERATE = '訂正した条件で計画案を再生成してください。';
const AUTHORIZATION = 'この条件で未保存の計画案を作ってください。';
const modes = ['jev accepted', 'abstain → Luna', 'unavailable → Luna', 'generic escape', 'dual failure'];
const composer = page => page.locator('.ai-planning-composer textarea');
const previewButton = page => page.getByRole('button', { name: '計画プレビューを確認' });
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]'));

function delta(planningIntent = 'create_plan') {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent, planningWindow: null, tasks: [],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [] };
}
// Same bounded task/workload/effort shape as ProviderBoundary.integration.test.tsx:50.
function initialConditions() {
  const document = delta('discuss');
  document.planningWindow = { localId: 'window', kind: 'absolute', value: '2026-08-20/2026-08-26',
    start: '2026-08-20', end: '2026-08-26', sourceText: '8月20日から26日' };
  document.tasks = [{ localId: 'task', category: 'study', title: '数学',
    study: { purpose: 'self_study', contextLabel: '数学', components: [] },
    workloads: [{ localId: 'work', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学20問' }],
    effortEstimates: [{ localId: 'effort', targetLocalId: 'work', kind: 'duration_per_unit', minutes: 2,
      unitCode: 'problem', precision: 'exact', sourceText: '1問2分' }],
    temporalConstraints: [], recurrence: [], sourceText: '数学20問を1問2分' }];
  return document;
}

const D5_POLICY = 'd5-answer-proposal-2026-10-21-v2';
const D5_SETUP = '8月20日から26日で数学20問と英語15ページを進めたい。英語15ページは全部で45分。数学の時間はまだ決めていません。';
const D5_CORRECTION = 'いや、数学は全部で60分です。';
let liveBridge;
test.beforeAll(async () => {
  if (process.env.JEV_D5_LIVE === '1') {
    const { startD5BrowserBridge } = await import('../../scripts/jev-d5-browser-bridge.mjs');
    liveBridge = await startD5BrowserBridge({ workerName: process.env.JEV_D5_WORKER ?? 'studyplanner-ai-proxy', evidenceDir: process.env.JEV_D5_EVIDENCE_DIR, remainingArgs: ['--remaining-jev', process.env.JEV_D5_REMAINING_JEV, '--remaining-luna', process.env.JEV_D5_REMAINING_LUNA, '--remaining-usd', process.env.JEV_D5_REMAINING_USD] });
  }
});
test.afterAll(async () => { await liveBridge?.close(); });

function structuredUserPrompt(body, field) {
  for (const message of body.messages ?? []) {
    if (message.role !== 'user') continue;
    try { const parsed = JSON.parse(message.content); if (parsed && Object.hasOwn(parsed, field)) return parsed; } catch { /* Bounded repair instructions are prose. */ }
  }
  throw new Error(`Missing structured fixture prompt: ${field}`);
}
function groundedRendererReply(prompt) {
  const decision = prompt.applicationDecision;
  const facts = prompt.currentTurnGrounding.acceptedFacts.filter(f => f.kind === 'effort_estimate');
  const acknowledgement = facts.map(f => {
    const d = f.data; const measurement = d.kind === 'total_duration' ? '全部で' : `1${d.kind === 'session_duration' ? '回' : d.unitLabel}`;
    return `${d.targetLabels.join('の')}は${measurement}${d.minutes}分${d.precision === 'approximate' ? 'くらい' : ''}で見積もります。`;
  }).join('');
  let body = `内容を確認してください。${decision.previewPromotionControlLabel ?? ''}`;
  if (decision.questionCode === 'missing_effort_estimate') {
    body = `数学20問は${decision.questionIntent?.measurement === 'duration_per_unit' ? '1問あたり' : '全部で'}何分かかりますか？`;
  }
  return { actionId: prompt.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode,
    groundingAcknowledgement: facts.length ? { factIds: facts.map(f => f.factId), text: acknowledgement } : null, text: acknowledgement + body };
}
function d5InitialConditions() {
  const document = initialConditions(); document.tasks[0].effortEstimates = []; document.tasks[0].sourceText = '数学20問';
  document.tasks.push({ ...structuredClone(document.tasks[0]), localId: 'english', title: '英語',
    study: { purpose: 'self_study', contextLabel: '英語', components: [] },
    workloads: [{ ...document.tasks[0].workloads[0], localId: 'english-work', amount: 15, unitCode: 'page', unitLabel: 'ページ', sourceText: '英語15ページ' }],
    effortEstimates: [{ localId: 'english-effort', targetLocalId: 'english-work', kind: 'total_duration', minutes: 45, unitCode: null, precision: 'exact', sourceText: '全部で45分' }],
    sourceText: '英語15ページは全部で45分' });
  return document;
}
async function d5Snapshot(page) {
  return page.evaluate(async rootPath => {
    const state = globalThis.__d5ReadState();
    const { getWeeklyPlanningStableV5RuntimeSession } = await import(`/@fs${rootPath}/src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession.ts`);
    const conversationId = state.intakeState?.c5SelectionLedger?.conversationId ?? state.messages.find(m => m.conversationId)?.conversationId;
    return { state, openSubmissions: globalThis.__d5OpenSubmissions ?? 0, events: globalThis.__d5DebugEvents ?? [], devRegistry: globalThis.__d5DevRegistry ?? null, graph: conversationId ? getWeeklyPlanningStableV5RuntimeSession(conversationId)?.graph : null };
  }, root);
}
async function allocationOracle(page, graph) {
  return page.evaluate(async ({ rootPath, graph }) => {
    const at = path => `/@fs${rootPath}/src/features/weeklyPlanning/semantic/${path}.ts`;
    const { createWeeklyPlanningActiveSchedulerGraphViewV5 } = await import(at('weeklyPlanningActiveSchedulerGraphViewV5'));
    const { compileGenericSchedulerInput } = await import(at('weeklyPlanningGenericSchedulerInput'));
    const { createWeeklyPlanningPlacementGraphViewV5 } = await import(at('weeklyPlanningPlacementGraphViewV5'));
    const { scheduleWeeklyPlanningStableV5Preview } = await import(at('weeklyPlanningStableV5PreviewScheduler'));
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
    const compiled = compileGenericSchedulerInput({ graph: active, context: { ownerId: 'planner-recovery-owner', currentDate: '2026-08-19',
      planningStartDate: '2026-08-20', planningEndDate: '2026-08-26', timeZone: 'Asia/Tokyo' } });
    if (compiled.status !== 'ready') throw new Error(`Fresh-graph oracle not ready: ${JSON.stringify(compiled.issues)}`);
    const preview = scheduleWeeklyPlanningStableV5Preview({ input: compiled.input, graph: createWeeklyPlanningPlacementGraphViewV5(active),
      plans: [], scheduleTemplates: [], notBefore: { date: '2026-08-19', time: '10:00' } });
    if (preview.status !== 'ready') throw new Error('Fresh-graph oracle placement failed');
    const sum = title => preview.candidates.filter(c => c.title.includes(title)).reduce((total, c) => total + c.durationMinutes, 0);
    return { math: sum('数学'), english: sum('英語') };
  }, { rootPath: root, graph });
}
const eventMinutes = event => {
  const minutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  return minutes(event.endTime) - minutes(event.startTime);
};
async function boot(page, mode) {
  const audit = { blockedExternal: [], proxy: [], replacedModules: [] };
  await page.addInitScript(() => sessionStorage.setItem('studyplanner.ai.runtime.v1', JSON.stringify({ provider: 'openai', apiKey: '' })));
  await page.route('**/*', async route => {
    const url = new globalThis.URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4174') {
      audit.blockedExternal.push(url.origin); return route.abort();
    }
    return route.continue();
  });
  // Restore production execution only in this test's Page; never edit Vite's alias.
  await page.route('**/weeklyPlanningTurnRuntimeGateway.stub.js*', async route => {
    audit.replacedModules.push('gateway');
    return route.fulfill({ contentType: 'application/javascript',
      body: `export { weeklyPlanningTurnRuntimeGateway } from ${JSON.stringify(`/@fs${root}/src/features/weeklyPlanning/application/weeklyPlanningTurnRuntimeGateway.ts`)};` });
  });
  for (const [file, marker, injected] of [
    ['aiConfig.ts', 'function getCloudflareAiProxyUrl() {', `return ${JSON.stringify(PROXY)};`],
    ['firebaseClient.ts', 'function getFirebaseAuth() {', 'return { currentUser: { uid: "planner-recovery-owner", getIdToken: async () => "local-fixture-session" } };'],
  ]) {
    await page.route(`**/src/lib/${file}*`, async route => {
      const response = await route.fetch(); const code = await response.text();
      expect(code.split(marker)).toHaveLength(2); // Fail closed on a changed seam.
      audit.replacedModules.push(file);
      return route.fulfill({ response, body: code.replace(marker, `${marker}\n${injected}`) });
    });
  }
  if (mode.startsWith('d5')) {
    await page.route('**/src/features/weeklyPlanning/application/weeklyPlanningTurnApplication.ts*', async route => {
      const response = await route.fetch(); const code = await response.text();
      const marker = 'candidateDomains: weeklyPlanningRegisteredCandidateDomains,';
      expect(code.split(marker)).toHaveLength(2);
      const submissionMarker = 'return semanticObservation ? submission.then(';
      expect(code.split(submissionMarker)).toHaveLength(2);
      const observed = code.replace(submissionMarker, `globalThis.__d5OpenSubmissions = (globalThis.__d5OpenSubmissions ?? 0) + 1; submission.finally(() => { globalThis.__d5OpenSubmissions--; }).catch(() => {}); ${submissionMarker}`);
      return route.fulfill({ response, body: `import { devD5Domains } from "/d5-top1-dev.js";\n${observed.replace(marker, 'candidateDomains: devD5Domains,')}` });
    });
    await page.route('**/src/features/weeklyPlanning/useWeeklyPlanningState.ts*', async route => {
      const response = await route.fetch(); const code = await response.text();
      const marker = 'const getPlanningState = useCallback(() => planningStateRef.current, []);';
      expect(code.split(marker)).toHaveLength(2);
      return route.fulfill({ response, body: code.replace(marker, `${marker} globalThis.__d5ReadState = getPlanningState;`) });
    });
    await page.route('**/src/features/weeklyPlanning/trace/weeklyPlanningStableV5DebugTrace.ts*', async route => {
      const response = await route.fetch(); const code = await response.text();
      const marker = 'function recordWeeklyPlanningStableV5DebugTrace(params) {';
      expect(code.split(marker)).toHaveLength(2);
      return route.fulfill({ response, body: code.replace(marker, `${marker} (globalThis.__d5DebugEvents ??= []).push(params);`) });
    });
    await page.route('**/src/features/weeklyPlanning/weeklyPlanningTurnController.ts*', async route => {
      const response = await route.fetch(); const code = await response.text();
      const marker = 'const snapshot = params.getState();';
      expect(code.split(marker)).toHaveLength(2);
      return route.fulfill({ response, body: code.replace(marker, `${marker} globalThis.__d5ReadState = params.getState;`) });
    });
  }
  let failedD5 = false;
  await page.route(PROXY, async route => {
    const body = route.request().postDataJSON();
    const schema = body.response_format?.json_schema?.name;
    const record = { schema, body }; audit.proxy.push(record);
    expect(body).not.toHaveProperty('model');
    if (mode.startsWith('d5')) {
      if (body.decisionContext?.purpose === 'candidate_choice' && audit.holdNextCandidate) {
        audit.holdNextCandidate = false;
        await new Promise(resolve => { audit.releaseCandidate = resolve; });
      }
      if (liveBridge) {
        const response = await fetch(liveBridge.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${liveBridge.token}` }, body: JSON.stringify(body) });
        const text = await response.text();
        record.response = { status: response.status, body: JSON.parse(text) };
        return route.fulfill({ status: response.status, body: text, headers: { 'Content-Type': 'application/json', 'X-StudyPlanner-AI-Provider': response.headers.get('X-StudyPlanner-AI-Provider') ?? 'unknown' } });
      }
      if (body.decisionContext?.purpose === 'candidate_choice') {
        if (mode === 'd5 retry' && !failedD5) { failedD5 = true; return route.fulfill({ status: 502, json: { error: 'Synthetic candidate outage' } }); }
        const r = body.decisionContext.request;
        const selected = r.menu.options.find(o => o.kind === 'leaf' && o.candidate.tuple.minutes === 15);
        expect(selected).toBeTruthy();
        const reply = { status: 'evaluated', catalogVersion: 'complete-candidate-choice-2026-10-13-v2', requestId: r.requestId, selectionEpoch: r.selectionEpoch,
          candidateSetHash: r.candidateSetHash, nodeId: r.menu.nodeId, optionId: selected.id,
          probabilities: r.menu.options.map(o => ({ optionId: o.id, probability: o.id === selected.id ? .51 : .49 / (r.menu.options.length - 1) })),
          conditionChange: .1, independentMeaning: .1 };
        record.response = reply;
        return route.fulfill({ json: reply });
      }
      let content;
      if (schema === 'weekly_planning_stable_v5_dialogue_response') {
        content = groundedRendererReply(structuredUserPrompt(body, schema === 'weekly_planning_stable_v5_dialogue_response' ? 'applicationDecision' : schema === 'weekly_planning_focused_authorization_v5' ? 'currentUserText' : 'userText'));
        if ((audit.failRendererAttempts ?? 0) > 0) { audit.failRendererAttempts--; content.text = '数学は全部で999分です。'; content.groundingAcknowledgement = null; }
      }
      else if (schema === 'weekly_planning_focused_authorization_v5') content = { decision: structuredUserPrompt(body, schema === 'weekly_planning_stable_v5_dialogue_response' ? 'applicationDecision' : schema === 'weekly_planning_focused_authorization_v5' ? 'currentUserText' : 'userText').currentUserText === AUTHORIZATION ? 'create_plan' : 'fallback' };
      else if (schema === 'weekly_planning_focused_contextual_answer_v5') content = { decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null };
      else if (schema === 'weekly_planning_semantic_document_v5') {
        const input = structuredUserPrompt(body, schema === 'weekly_planning_stable_v5_dialogue_response' ? 'applicationDecision' : schema === 'weekly_planning_focused_authorization_v5' ? 'currentUserText' : 'userText');
        if (input.userText === D5_SETUP) content = d5InitialConditions();
        else if (input.userText === D5_CORRECTION || input.userText === '15') {
          if (input.userText === '15' && mode === 'd5 retry') return route.fulfill({ status: 502, json: { error: 'Synthetic Luna outage' } });
          const state = input.publicStateSummary;
          const task = state.tasks.find(t => t.title === '数学');
          const workload = state.workloads.find(w => w.taskPublicId === task.publicId && w.quantityRole === 'target');
          const old = state.effortEstimates.find(e => e.taskPublicId === task.publicId);
          content = delta('update_plan');
          content.tasks = [{ ...d5InitialConditions().tasks[0], localId: 'corrected-task', existingPublicId: task.publicId,
            workloads: [], effortEstimates: [{ localId: 'corrected-effort', targetLocalId: workload.publicId, kind: 'total_duration', minutes: 60, unitCode: null, precision: 'exact', sourceText: input.userText }], sourceText: input.userText }];
          if (input.userText === '15') {
            const measurement = state.pendingQuestion?.effortMeasurement ?? 'duration_per_unit';
            content.tasks[0].workloads = [{ ...d5InitialConditions().tasks[0].workloads[0], localId: workload.publicId, sourceText: '15' }];
            Object.assign(content.tasks[0].effortEstimates[0], { minutes: 15, kind: measurement, unitCode: measurement === 'duration_per_unit' ? workload.unitCode : null });
          }
          content.corrections = old ? [{ localId: 'fix', target: { kind: 'effort_estimate', publicId: old.publicId, localId: null, mention: '数学の時間' }, operation: 'modify', replacementLocalId: 'corrected-effort', sourceText: input.userText }] : [];
        } else content = delta('create_plan');
      } else throw new Error(`Unexpected D5 schema: ${schema}`);
      record.content = content;
      return route.fulfill({ json: { content: JSON.stringify(content) }, headers: { 'X-StudyPlanner-AI-Provider': 'openai' } });
    }
    let content;
    if (schema === 'weekly_planning_focused_authorization_v5') {
      expect(body.decisionContext).toMatchObject({ purpose: 'focused_authorization', previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false });
      if (mode === 'dual failure') return route.fulfill({ status: 502, json: { error: 'Mock Jev and focused Luna unavailable.' } });
      content = { decision: mode === 'generic escape' ? 'fallback' : 'create_plan' };
    } else if (schema === 'weekly_planning_semantic_document_v5') {
      expect(body).not.toHaveProperty('decisionContext');
      const input = structuredUserPrompt(body, schema === 'weekly_planning_stable_v5_dialogue_response' ? 'applicationDecision' : schema === 'weekly_planning_focused_authorization_v5' ? 'currentUserText' : 'userText');
      if (mode === 'dual failure' && input.userText !== SETUP) return route.fulfill({ status: 502, json: { error: 'Mock generic Luna unavailable.' } });
      if (input.userText === SETUP) content = initialConditions();
      else if (input.userText === CORRECTION) {
        content = delta('update_plan');
        content.planningWindow = { localId: 'corrected-window', kind: 'absolute', value: '2026-08-21/2026-08-27',
          start: '2026-08-21', end: '2026-08-27', sourceText: '8月21日から27日' };
      } else {
        expect([AUTHORIZATION, REGENERATE]).toContain(input.userText); content = delta();
      }
    } else if (schema === 'weekly_planning_stable_v5_dialogue_response') {
      const prompt = structuredUserPrompt(body, schema === 'weekly_planning_stable_v5_dialogue_response' ? 'applicationDecision' : schema === 'weekly_planning_focused_authorization_v5' ? 'currentUserText' : 'userText');
      content = groundedRendererReply(prompt);
    } else throw new Error(`Unexpected mock proxy schema: ${schema}`);
    const jevReply = schema === 'weekly_planning_focused_authorization_v5'
      && ['jev accepted', 'generic escape'].includes(mode);
    await route.fulfill({ json: { content: JSON.stringify(content),
      ...(jevReply ? { decisionContext: { requestId: body.decisionContext.requestId, inputRevision: body.decisionContext.inputRevision } } : {}) },
      headers: { 'X-StudyPlanner-AI-Provider': jevReply ? 'openrouter' : 'openai' } });
  });
  await page.goto(URL);
  await expect(page.getByRole('navigation', { name: '主要ナビゲーション' })).toBeVisible();
  await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
  return audit;
}

async function submit(page, audit, text) {
  const before = audit.proxy.length;
  await composer(page).fill(text); await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => audit.proxy.length).toBeGreaterThan(before);
  await expect(page.getByRole('button', { name: '処理をキャンセル', exact: true })).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
}
async function openPreview(page) {
  await previewButton(page).click();
  const dialog = page.getByRole('dialog', { name: '計画プレビュー' });
  await expect(dialog).toBeVisible(); return dialog;
}
async function reloadOwned(page) {
  // Existing fixture's documented one-shot preserve flag; otherwise it reseeds.
  await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
  await page.reload();
  if (!(await composer(page).isVisible())) {
    await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
  }
  await expect(composer(page)).toBeEnabled();
}

test.describe.configure({ retries: 0 });
for (const mode of modes) {
  test(`tier A/B ${mode}: preview needs explicit save; corrected candidates survive reload`, async ({ page }) => {
    const audit = await boot(page, mode);
    await submit(page, audit, SETUP);
    await expect(previewButton(page)).toHaveCount(0); expect(await saved(page)).toEqual([]);
    const beforeAuthorization = audit.proxy.length;
    await submit(page, audit, AUTHORIZATION);
    const semanticRoutes = audit.proxy.slice(beforeAuthorization).filter(item => item.body.purpose === 'weekly_planning_semantic_normalizer');
    expect(semanticRoutes[0].schema).toBe('weekly_planning_focused_authorization_v5');
    expect(semanticRoutes.map(item => item.schema)).toEqual(mode === 'generic escape' || mode === 'dual failure'
      ? ['weekly_planning_focused_authorization_v5', 'weekly_planning_semantic_document_v5'] : ['weekly_planning_focused_authorization_v5']);
    expect(await saved(page)).toEqual([]);
    if (mode === 'dual failure') {
      await expect(previewButton(page)).toHaveCount(0);
      await reloadOwned(page); await expect(previewButton(page)).toHaveCount(0);
      await expect(page.locator('.ai-planning-conversation').getByText(SETUP, { exact: true })).toHaveCount(1);
      expect(await saved(page)).toEqual([]);
    } else {
      let dialog = await openPreview(page);
      await expect(dialog.locator('.ai-planning-draft-block')).toHaveCount(1);
      await expect(dialog).toContainText('数学');
      expect(await saved(page)).toEqual([]);
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
      await submit(page, audit, CORRECTION); await submit(page, audit, REGENERATE);
      // Recompute is observable: the only block must move into the corrected period.
      dialog = await openPreview(page);
      await expect(dialog.locator('.ai-planning-draft-block')).toHaveCount(1);
      await expect(dialog).toContainText('8/21');
      expect(await saved(page)).toEqual([]);
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
      const beforeReload = audit.proxy.length;
      await reloadOwned(page); expect(audit.proxy).toHaveLength(beforeReload);
      dialog = await openPreview(page);
      await dialog.getByRole('button', { name: 'この内容で仮予定にする' }).click();
      const approve = dialog.getByRole('button', { name: 'この内容で保存' });
      await expect(approve).toBeEnabled(); expect(await saved(page)).toEqual([]);
      const writesBefore = await page.evaluate(() => window.__plannerRecoveryStorageWrites.filter(write => write.key === 'studyplanner.scheduleEvents.v1').length);
      await approve.evaluate(button => { button.click(); button.click(); });
      await expect.poll(async () => (await saved(page)).length).toBe(1);
      await expect(dialog).toHaveCount(0);
      const committed = await saved(page);
      expect(committed[0]).toMatchObject({ date: '2026-08-21' });
      expect(await page.evaluate(() => window.__plannerRecoveryStorageWrites.filter(write => write.key === 'studyplanner.scheduleEvents.v1').length)).toBe(writesBefore + 1);
      await reloadOwned(page); expect(await saved(page)).toEqual(committed);
      await expect.poll(() => page.evaluate(() => window.__plannerRecoveryHook.snapshot().plans.map(plan => ({ date: plan.date, title: plan.title })))).toEqual([{ date: committed[0].date, title: committed[0].title }]);
      await expect(previewButton(page)).toHaveCount(0);
    }
    expect(audit.replacedModules).toEqual(expect.arrayContaining(['gateway', 'aiConfig.ts', 'firebaseClient.ts']));
    expect(audit.blockedExternal).toEqual([]); // Unexpected external attempts fail even though aborted.
  });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`D5 connected ${process.env.JEV_D5_LIVE === '1' ? 'live providers' : 'mock providers'} ${viewport.width}: bare answer, grounded ACK, correction, save and reload`, async ({ page }, testInfo) => {
    test.setTimeout(liveBridge ? 300_000 : 60_000);
    await page.setViewportSize(viewport);
    const audit = await boot(page, 'd5');
    await submit(page, audit, D5_SETUP);
    const presented = await d5Snapshot(page);
    await testInfo.attach('d5-capture-state.json', { body: Buffer.from(JSON.stringify({ presented, renderer: audit.proxy.filter(c => c.schema === 'weekly_planning_stable_v5_dialogue_response').at(-1) }, null, 2)), contentType: 'application/json' });
    expect(presented.state.intakeState.lastQuestionContext.controlledCandidate?.domainId).toBe('d5_numeric');
    expect(presented.state.intakeState.lastQuestionContext.actionId).toContain('candidate-question:d5_numeric:');
    const beforeAnswer = audit.proxy.length;
    await submit(page, audit, '15');
    const answerCalls = audit.proxy.slice(beforeAnswer);
    const selected = answerCalls.filter(c => c.body.decisionContext?.purpose === 'candidate_choice');
    expect(selected).toHaveLength(1);
    expect(selected[0].body.decisionContext.request.context.scope.domainPolicyVersion).toBe(D5_POLICY);
    expect(selected[0].body.decisionContext.request.menu.options.some(o => o.kind === 'leaf' && o.candidate.tuple.minutes === 15)).toBe(true);
    expect(answerCalls.filter(c => c.body.purpose === 'weekly_planning_semantic_normalizer')).toEqual(selected);
    expect(answerCalls.every(c => c.body.decisionContext?.purpose === 'candidate_choice' || c.body.purpose === 'weekly_planning_renderer')).toBe(true);
    let snapshot = await d5Snapshot(page);
    expect(snapshot.state.intakeState.c5SelectionLedger.consumed).toHaveLength(1);
    const mathTask = snapshot.graph.tasks.find(t => t.title === '数学');
    const active = graph => new Set(graph.factLifecycles.filter(f => f.status === 'active').map(f => f.factId));
    expect(snapshot.graph.effortEstimates.filter(e => active(snapshot.graph).has(e.id) && e.taskId === mathTask.id)).toMatchObject([{ minutes: 15 }]);
    expect(snapshot.state.messages.at(-1).content).toMatch(/数学.*15分/);
    expect(snapshot.state.messages.at(-1).content).not.toContain('保存しました');
    await page.screenshot({ path: testInfo.outputPath('d5-grounded-ack.png'), fullPage: true });
    const oldAllocation = await allocationOracle(page, snapshot.graph);
    const englishBefore = snapshot.graph.effortEstimates.filter(e => active(snapshot.graph).has(e.id) && e.taskId !== mathTask.id);
    expect(englishBefore).toMatchObject([{ kind: 'total_duration', minutes: 45 }]);
    await submit(page, audit, D5_CORRECTION);
    snapshot = await d5Snapshot(page);
    await testInfo.attach('d5-correction-state.json', { body: Buffer.from(JSON.stringify({ snapshot, proxy: audit.proxy }, null, 2)), contentType: 'application/json' });
    expect(snapshot.graph.effortEstimates.filter(e => active(snapshot.graph).has(e.id) && e.taskId === mathTask.id)).toMatchObject([{ kind: 'total_duration', minutes: 60 }]);
    expect(snapshot.state.messages.at(-1).content).toMatch(/数学.*全部で60分/);
    expect(snapshot.graph.effortEstimates.filter(e => active(snapshot.graph).has(e.id) && e.taskId !== mathTask.id)).toEqual(englishBefore);
    const correctedAllocation = await allocationOracle(page, snapshot.graph);
    expect(correctedAllocation.math).not.toBe(oldAllocation.math);
    expect(correctedAllocation.english).toBe(oldAllocation.english);
    await submit(page, audit, AUTHORIZATION);
    const dialog = await openPreview(page);
    await page.screenshot({ path: testInfo.outputPath('d5-corrected-preview.png'), fullPage: true });
    expect(await saved(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'この内容で仮予定にする' }).click();
    const writeCountBefore = await page.evaluate(() => window.__plannerRecoveryStorageWrites.filter(w => w.key === 'studyplanner.scheduleEvents.v1').length);
    await dialog.getByRole('button', { name: 'この内容で保存' }).evaluate(button => { button.click(); button.click(); });
    await expect.poll(async () => (await saved(page)).length).toBeGreaterThan(0);
    const committed = await saved(page);
    expect(await page.evaluate(() => window.__plannerRecoveryStorageWrites.filter(w => w.key === 'studyplanner.scheduleEvents.v1').length)).toBe(writeCountBefore + 1);
    await testInfo.attach('d5-saved-readback.json', { body: Buffer.from(JSON.stringify({ correctedAllocation, committed })), contentType: 'application/json' });
    const mathPlans = committed.filter(p => p.title.includes('数学'));
    expect(mathPlans.reduce((sum, plan) => sum + eventMinutes(plan), 0)).toBe(correctedAllocation.math);
    expect(committed.filter(p => p.title.includes('英語')).reduce((sum, plan) => sum + eventMinutes(plan), 0)).toBe(oldAllocation.english);
    expect(new Set(committed.map(p => p.id)).size).toBe(committed.length);
    const beforeReload = audit.proxy.length;
    await reloadOwned(page);
    expect(await saved(page)).toEqual(committed);
    expect(audit.proxy).toHaveLength(beforeReload);
    expect(audit.blockedExternal).toEqual([]);
  });
}

test('D5 mock cancelled late choice cannot restore stale effort', async ({ page }, testInfo) => {
  test.skip(Boolean(liveBridge), 'Mock fault injection; parent live core has separate real-provider evidence');
  test.setTimeout(90_000);
  const audit = await boot(page, 'd5');
  await submit(page, audit, D5_SETUP);
  audit.holdNextCandidate = true;
  await composer(page).fill('15'); await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect.poll(() => Boolean(audit.releaseCandidate)).toBe(true);
  const pending = await d5Snapshot(page);
  expect(pending.state.pendingTurn).toBeTruthy();
  await page.getByRole('button', { name: '処理をキャンセル', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
  await submit(page, audit, D5_CORRECTION);
  const corrected = await d5Snapshot(page);
  audit.releaseCandidate();
  await expect.poll(async () => (await d5Snapshot(page)).state.pendingTurn).toBeFalsy();
  // Observe settlement of the actual old application promise, not just the network reply.
  await expect.poll(async () => (await d5Snapshot(page)).openSubmissions).toBe(0);
  const after = await d5Snapshot(page);
  const active = new Set(after.graph.factLifecycles.filter(f => f.status === 'active').map(f => f.factId));
  const math = after.graph.tasks.find(t => t.title === '数学');
  expect(after.graph.effortEstimates.filter(e => active.has(e.id) && e.taskId === math.id)).toMatchObject([{ kind: 'total_duration', minutes: 60 }]);
  expect(after.graph).toEqual(corrected.graph);
  expect(after.state.intakeState.c5SelectionLedger.consumed).toEqual([]);
  await testInfo.attach('cancelled-late-readback.json', { body: Buffer.from(JSON.stringify(after)), contentType: 'application/json' });
});

test('D5 mock renderer error then retry keeps effort atomic without duplicates', async ({ page }, testInfo) => {
  test.skip(Boolean(liveBridge), 'Mock renderer outage, no live fault sends'); test.setTimeout(90_000);
  const audit = await boot(page, 'd5'); await submit(page, audit, D5_SETUP);
  const before = await d5Snapshot(page);
  audit.failRendererAttempts = 2;
  await submit(page, audit, '15');
  const failed = await d5Snapshot(page);
  expect(failed.graph).toEqual(before.graph);
  expect(failed.state.intakeState.c5SelectionLedger.consumed).toEqual([]);
  expect(failed.state.messages.at(-1).content).toContain('今回の内容は計画へ反映していません');
  await submit(page, audit, '15');
  const retried = await d5Snapshot(page);
  const ids = new Set(retried.graph.factLifecycles.filter(f => f.status === 'active').map(f => f.factId));
  const math = retried.graph.tasks.find(t => t.title === '数学');
  expect(retried.graph.effortEstimates.filter(e => ids.has(e.id) && e.taskId === math.id)).toMatchObject([{ minutes: 15 }]);
  expect(await saved(page)).toEqual([]);
  const callsBeforeReload = audit.proxy.length; await reloadOwned(page);
  expect(audit.proxy).toHaveLength(callsBeforeReload);
  const reloaded = await d5Snapshot(page);
  expect(reloaded.graph).toEqual(retried.graph);
  await testInfo.attach('retry-reload-readback.json', { body: Buffer.from(JSON.stringify(reloaded)), contentType: 'application/json' });
});
