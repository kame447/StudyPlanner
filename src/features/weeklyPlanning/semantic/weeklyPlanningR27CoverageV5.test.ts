import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply, type ScriptedConversation } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { conditionDocument, conditionSetupDocument } from '../testUtils/weeklyPlanningConditionPropagationFixture';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { beginWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { WeeklyPlanningSemanticNormalizerRunV5, SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES } from './weeklyPlanningSemanticNormalizerRunV5';
import { tryWeeklyPlanningDenseTurnCompletenessRetryV5 } from './weeklyPlanningSemanticDenseTurnCompletenessV5';
import { createWeeklyPlanningTurnDispatchBudget, withWeeklyPlanningTurnDispatchBudget } from '../application/weeklyPlanningTurnDispatchBudget';

const TEXT = '1回60分で2つに分けたい。両方とも夜の時間がいいです';
const GENERIC = 'weekly_planning_semantic_document_v5';
const AUDIT = 'weekly_planning_dense_turn_completeness_audit_v5';
function fixture() {
  const setup = JSON.parse(JSON.stringify(conditionSetupDocument())
    .split('アルゴリズムイントロダクション').join('合成演習集').split('卒業研究ノート').join('合成研究ノート')) as WeeklyPlanningSemanticDocumentV5;
  setup.tasks[0].effortEstimates = [{ localId: 'accepted-rate', targetLocalId: setup.tasks[0].workloads[0].localId,
    kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'exact', sourceText: '1ページ3分' }];
  const accepted = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(), document: setup,
    context: { conversationId: 'white-r27', turnId: 'setup', expectedRevision: 0 } });
  expect(accepted.status).toBe('applied');
  const graph = accepted.graph;
  const shells = conditionDocument({ planningIntent: 'update_plan', tasks: graph.tasks.map((task, index) => ({
    localId: `shell-${index}`, existingPublicId: task.id, decompositionStatus: 'atomic', category: 'study', title: task.title,
    study: { purpose: 'unknown', activityKind: 'unknown', contextLabel: null, components: [] }, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: TEXT,
  })) }) as WeeklyPlanningSemanticDocumentV5;
  const effort = structuredClone(shells);
  effort.tasks.forEach((task, index) => { task.effortEstimates = [{ localId: `session-${index}`, targetLocalId: task.localId,
    kind: 'session_duration', minutes: 60, unitCode: null, precision: 'approximate', sourceText: TEXT }]; });
  return { setup, graph, shells, effort, publicStateSummary: { tasks: graph.tasks.map(task => ({ publicId: task.id, category: task.category, title: task.title })) } };
}

describe('WhiteMendeleev R27 synthetic whole-reply effort coverage', () => {
  it.each([false, true])('audits a full-utterance effort quote, including after the empty-shell re-read (startsEmpty=%s)', async startsEmpty => {
    const f = fixture(); const requestId = `white-r27-${startsEmpty}`;
    const input = { userText: TEXT, committedGraph: f.graph, publicStateSummary: f.publicStateSummary,
      conversationArchitecture: 'interaction_v1' as const, traceRequestId: requestId };
    for (const document of [f.shells, f.effort]) {
      const v = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { ...input, currentUserText: TEXT });
      expect(v.errors).toEqual([]); expect(v.document).not.toBeNull();
    }
    const calls: string[] = []; let generic = 0;
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
      const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name);
      if (name === AUDIT) return JSON.stringify({ decision: 'complete', missingFacts: [] });
      expect(name).toBe(GENERIC);
      return JSON.stringify(startsEmpty && generic++ === 0 ? f.shells : f.effort);
    } }).normalize(input);
    const trace = takeWeeklyPlanningStableV5DebugTrace(requestId);
    expect(result.status).toBe('accepted'); expect(result.diagnostics.repairAttempted).toBe(false);
    expect(result.document!.tasks.map(task => task.effortEstimates.map(estimate => estimate.minutes))).toEqual([[60], [60]]);
    expect(calls).toEqual([GENERIC, ...(startsEmpty ? [GENERIC] : []), AUDIT]);
    expect(trace.some(event => event.stage === 'semantic_evidence_coverage_eligibility' && (event.data as { eligible?: boolean }).eligible === true)).toBe(true);
  });
});


it.each([
  ['ascii7', '60abcdefg', false], ['ascii8', '60abcdefgh', true],
  ['width7', '６０abcdefg', false], ['width8', '６０abcdefgh', true],
  ['unicode7', '60😀😀😀😀😀😀😀', false], ['unicode8', '60😀😀😀😀😀😀😀😀', true],
] as const)('R27 literal boundary %s counts code points and both digit widths', async (_name, userText, shouldAudit) => {
  const f = fixture(); const document = structuredClone(f.effort);
  document.tasks.forEach(task => { task.sourceText = userText; task.effortEstimates[0].sourceText = userText; });
  const input = { userText, committedGraph: f.graph, publicStateSummary: f.publicStateSummary, conversationArchitecture: 'interaction_v1' as const };
  expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { ...input, currentUserText: userText }).errors).toEqual([]);
  const calls: string[] = [];
  const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
    const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name);
    return name === AUDIT ? JSON.stringify({ decision: 'complete', missingFacts: [] }) : JSON.stringify(document);
  } }).normalize(input);
  expect(result.status).toBe('accepted'); expect(result.diagnostics.repairAttempted).toBe(false);
  expect(calls).toEqual([GENERIC, ...(shouldAudit ? [AUDIT] : [])]);
});

it.each(['legacy', 'empty', 'covered_by_temporal'] as const)('R27 scope control %s keeps its existing call path', async scenario => {
  const f = fixture(); const document = scenario === 'empty' ? conditionDocument() as WeeklyPlanningSemanticDocumentV5 : structuredClone(f.effort);
  if (scenario === 'covered_by_temporal') document.tasks[0].temporalConstraints = [{ localId: 'typed-night', targetLocalId: document.tasks[0].localId,
    kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null,
    precision: 'approximate', sourceText: TEXT }];
  const input = { userText: TEXT, committedGraph: f.graph, publicStateSummary: f.publicStateSummary,
    conversationArchitecture: scenario === 'legacy' ? 'legacy_v5' as const : 'interaction_v1' as const };
  const wire = { ...document }; if (scenario === 'legacy') delete wire.conversationActs;
  expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(wire), { ...input, currentUserText: TEXT }).errors).toEqual([]);
  const calls: string[] = [];
  const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
    const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name); expect(name).toBe(GENERIC); return JSON.stringify(wire);
  } }).normalize(input);
  expect(result.status).toBe('accepted'); expect(calls).toEqual([GENERIC]);
});

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider> | undefined;
afterEach(() => { provider?.restore(); provider = undefined; resetScriptedConversationRuntime(); });
it('R27 real controller empty→whole-effort→audit preserves the split and applies both night preferences', async () => {
  const f = fixture(); const setupText = '来週、合成演習集を20ページ読む。1ページ3分。合成研究ノートを2時間進めたい';
  let conversation: ScriptedConversation; let reads = 0;
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, '候補を確認してください。');
    if (call.schemaName === AUDIT) return JSON.stringify({ decision: 'incomplete', missingFacts: ['preferred timing for both accepted tasks'] });
    expect(call.schemaName).toBe(GENERIC);
    if (call.payload?.userText === setupText) return JSON.stringify(f.setup);
    const read = reads++; const document = structuredClone(read === 0 ? f.shells : f.effort);
    document.tasks.forEach((task, i) => {
      task.existingPublicId = conversation.graph()!.tasks[i].id;
      if (read >= 2) task.temporalConstraints = [{ localId: `night-${i}`, targetLocalId: task.localId, kind: 'preferred_window', constraintLevel: 'soft',
        dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'approximate', sourceText: '両方とも夜の時間がいいです' }];
    });
    return JSON.stringify(document);
  }, { completenessAudit: 'scripted' });
  conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', ownerId: 'white-r27-synthetic-owner' });
  const setup = await conversation.submit(setupText); expect(setup.result?.failure).toBeUndefined();
  const original = structuredClone(conversation.graph()!);
  const turn = await conversation.submit(TEXT);
  expect(turn.result?.failure).toBeUndefined();
  expect(turn.calls.map(call => call.schemaName)).toEqual([GENERIC, GENERIC, AUDIT, GENERIC, 'weekly_planning_stable_v5_dialogue_response']);
  expect(turn.debugTrace.filter(event => event.stage === 'semantic_repair_prepared')).toHaveLength(0);
  expect(conversation.graph()!.workloads).toEqual(original.workloads);
  expect(conversation.graph()!.effortEstimates.filter(fact => fact.kind === 'session_duration').map(fact => fact.minutes)).toEqual([60, 60]);
  expect(conversation.graph()!.temporalConstraints.filter(fact => fact.kind === 'preferred_window' && fact.namedTimePeriod === 'night')).toHaveLength(2);
  const previews = conversation.getState().previewCandidates ?? [];
  expect(previews.length).toBeGreaterThan(0);
  expect(previews.every(candidate => candidate.startTime >= '21:00' && candidate.durationMinutes <= 60)).toBe(true);
});


it.each(['recurrence', 'workload', 'component_workload'] as const)('R27b numeric-only %s full quote makes the existing audit eligible', async kind => {
  const f = fixture(); const document = structuredClone(f.shells);
  const userText = kind === 'recurrence' ? TEXT : '合成章を20ページ進めたい。両方とも夜の時間がいいです';
  document.tasks.forEach(task => { task.sourceText = userText; });
  const task = document.tasks[0];
  const workload = { localId: 'numeric-work', quantityRole: 'target' as const, amount: 20, unitCode: 'page' as const,
    unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: userText };
  if (kind === 'recurrence') task.recurrence = [{ localId: 'two', targetLocalId: task.localId, kind: 'custom', count: 2, days: [], sourceText: userText }];
  if (kind === 'workload') task.workloads = [workload];
  if (kind === 'component_workload') task.study!.components = [{ localId: 'section', existingPublicId: null, parentLocalId: null,
    role: 'section', label: '合成章', sourceText: '合成章', workloads: [workload], durableContextSignals: [] }];
  const input = { userText, committedGraph: f.graph, publicStateSummary: f.publicStateSummary, conversationArchitecture: 'interaction_v1' as const };
  expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { ...input, currentUserText: userText }).errors).toEqual([]);
  const calls: string[] = [];
  const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
    const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name);
    return name === AUDIT ? JSON.stringify({ decision: 'complete', missingFacts: [] }) : JSON.stringify(document);
  } }).normalize(input);
  expect(result.status).toBe('accepted'); expect(result.diagnostics.repairAttempted).toBe(false);
  expect(calls).toEqual([GENERIC, AUDIT]);
});

it.each(['complete', 'invalid_then_repair', 'lossy_reread'] as const)('R27 post-no-op audit keeps exact diagnostics and the floor (%s)', async scenario => {
  const f = fixture(); const calls: string[] = []; let generic = 0;
  const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
    const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name);
    if (name === AUDIT) return JSON.stringify({ decision: scenario === 'complete' ? 'complete' : 'incomplete', missingFacts: scenario === 'complete' ? [] : ['preferred timing'] });
    expect(name).toBe(GENERIC);
    if (generic++ === 0) return JSON.stringify(f.shells);
    const document = structuredClone(f.effort);
    if (generic === 3 && scenario === 'invalid_then_repair') document.tasks[0].effortEstimates[0].minutes = -1;
    if (generic === 3 && scenario === 'lossy_reread') document.tasks.forEach(task => { task.effortEstimates = []; });
    return JSON.stringify(document);
  } }).normalize({ userText: TEXT, committedGraph: f.graph, publicStateSummary: f.publicStateSummary, conversationArchitecture: 'interaction_v1' });
  expect(result.status).toBe('accepted');
  expect(result.document!.tasks.map(task => task.effortEstimates.map(estimate => estimate.minutes))).toEqual([[60], [60]]);
  expect(calls).toEqual(scenario === 'complete' ? [GENERIC, GENERIC, AUDIT]
    : scenario === 'invalid_then_repair' ? [GENERIC, GENERIC, AUDIT, GENERIC, GENERIC] : [GENERIC, GENERIC, AUDIT, GENERIC]);
  expect(result.diagnostics.attemptCount).toBe(calls.length);
  expect(result.diagnostics.repairAttempted).toBe(scenario === 'invalid_then_repair');
  if (scenario === 'lossy_reread') expect(result.completenessAbstention?.reason).toBe('initial_facts_not_preserved');
});

it('R27 re-evaluates an accepted no-op re-read after a repair, without a second repair', async () => {
  const f = fixture(); const calls: string[] = []; let generic = 0;
  const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
    const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name);
    if (name === AUDIT) return JSON.stringify({ decision: 'incomplete', missingFacts: ['preferred timing'] });
    expect(name).toBe(GENERIC);
    const index = generic++;
    if (index === 0) return 'not-json';
    if (index === 1) return JSON.stringify(f.shells);
    const document = structuredClone(f.effort);
    if (index === 3) document.tasks[0].effortEstimates[0].minutes = -1;
    return JSON.stringify(document);
  } }).normalize({ userText: TEXT, committedGraph: f.graph, publicStateSummary: f.publicStateSummary, conversationArchitecture: 'interaction_v1' });
  expect(result.status).toBe('accepted');
  expect(result.document!.tasks.map(task => task.effortEstimates.map(estimate => estimate.minutes))).toEqual([[60], [60]]);
  expect(calls).toEqual([GENERIC, GENERIC, GENERIC, AUDIT, GENERIC]);
  expect(result.diagnostics.attemptCount).toBe(5);
  expect(result.diagnostics.repairAttempted).toBe(true);
  expect(result.completenessAbstention?.reason).toBe('repair_budget_consumed');
});

it('R27c allows at most one completeness audit on the same interaction run', async () => {
  const f = fixture(); const calls: string[] = [];
  const run = new WeeklyPlanningSemanticNormalizerRunV5({ async createChatCompletion(request) {
    const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name);
    return JSON.stringify({ decision: 'complete', missingFacts: [] });
  } }, { userText: TEXT, committedGraph: f.graph, conversationArchitecture: 'interaction_v1' });
  const params = { run, baseMessages: [], initialResponse: JSON.stringify(f.effort), initialDocument: f.effort };
  await tryWeeklyPlanningDenseTurnCompletenessRetryV5(params);
  await tryWeeklyPlanningDenseTurnCompletenessRetryV5(params);
  expect(calls).toEqual([AUDIT]);
});

it.each(['interaction_v1', 'legacy_v5'] as const)('R27c does not re-audit a size-gated %s turn after its no-op re-read', async architecture => {
  const f = fixture(); const calls: string[] = []; let generic = 0;
  const userText = TEXT + ' '.repeat(SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES);
  const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
    const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name);
    if (name === AUDIT) return JSON.stringify({ decision: 'complete', missingFacts: [] });
    expect(name).toBe(GENERIC);
    const document = structuredClone(generic++ === 0 ? f.shells : f.effort);
    if (architecture === 'legacy_v5') delete document.conversationActs;
    return JSON.stringify(document);
  } }).normalize({ userText, committedGraph: f.graph, publicStateSummary: { ...f.publicStateSummary, pendingQuestion: { questionCode: 'missing_effort_estimate' } }, conversationArchitecture: architecture });
  expect(result.status).toBe('accepted');
  expect(calls).toEqual([GENERIC, AUDIT, GENERIC]);
});

it.each(['audit_budget', 'retry_budget', 'audit_failure', 'retry_failure', 'malformed_audit'] as const)('R27 post-no-op %s retains the accepted numeric document within the existing pool', async scenario => {
  const f = fixture(); const calls: string[] = []; let generic = 0;
  const budget = createWeeklyPlanningTurnDispatchBudget();
  const preused = scenario === 'audit_budget' ? 5 : scenario === 'retry_budget' ? 4 : 0;
  for (let index = 0; index < preused; index++) budget.consume('semantic');
  const client = withWeeklyPlanningTurnDispatchBudget({ async createChatCompletion(request) {
    const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name);
    if (name === AUDIT) {
      if (scenario === 'audit_failure') throw new Error('synthetic audit outage');
      return scenario === 'malformed_audit' ? 'malformed' : JSON.stringify({ decision: 'incomplete', missingFacts: ['preferred timing'] });
    }
    expect(name).toBe(GENERIC);
    if (generic++ === 0) return JSON.stringify(f.shells);
    if (generic === 3 && scenario === 'retry_failure') throw new Error('synthetic reread outage');
    return JSON.stringify(f.effort);
  } }, budget, 'semantic');
  const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({ userText: TEXT, committedGraph: f.graph,
    publicStateSummary: f.publicStateSummary, conversationArchitecture: 'interaction_v1' });
  expect(result.status).toBe('accepted');
  expect(result.document!.tasks.map(task => task.effortEstimates.map(estimate => estimate.minutes))).toEqual([[60], [60]]);
  expect(result.diagnostics.providerError).toBeNull();
  expect(result.diagnostics.repairAttempted).toBe(false);
  expect(calls).toEqual([GENERIC, GENERIC, ...(scenario === 'audit_budget' ? [] : [AUDIT]), ...(scenario === 'retry_failure' ? [GENERIC] : [])]);
  expect(budget.usage()).toMatchObject({ limit: 8, total: preused + calls.length, renderer: 0, refused: preused ? 1 : 0 });
  expect(result.diagnostics.attemptCount).toBe(scenario === 'audit_budget' || scenario === 'audit_failure' ? 2 : 3);
});

it.each([[false, 'compact'], [false, 'pretty'], [true, 'compact'], [true, 'pretty']] as const)('R27d post-no-op replay keeps exact provider bytes, including projected targets (spent=%s, format=%s)', async (spent, format) => {
  const f = fixture(); const doc = structuredClone(f.effort);
  const target = f.graph.workloads.find(work => work.taskId === f.graph.tasks[0].id)!;
  doc.tasks[0].effortEstimates[0].targetLocalId = target.id;
  const raw = format === 'pretty' ? JSON.stringify(doc, null, 2) + '\n' : JSON.stringify(doc);
  const input = { userText: TEXT, committedGraph: f.graph, publicStateSummary: f.publicStateSummary, conversationArchitecture: 'interaction_v1' as const };
  const validation = validateWeeklyPlanningSemanticResponseV5(raw, { ...input, currentUserText: TEXT });
  expect(validation.errors).toEqual([]);
  expect(validation.providerDocument!.tasks[0].effortEstimates[0].targetLocalId).toBe(target.id);
  expect(validation.document!.tasks[0].effortEstimates[0].targetLocalId).toBe('shell-0');
  const calls: string[] = []; const replies = [...(spent ? ['not-json'] : []), JSON.stringify(f.shells), raw, raw];
  let replay = '';
  let replayBytes = 0; let canonicalReplayBytes = 0;
  const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
    const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name);
    if (name === AUDIT) {
      const candidate = JSON.parse(request.messages[1].content).candidateDocument;
      expect(candidate.tasks[0].effortEstimates[0].targetLocalId).toBe('shell-0');
      return JSON.stringify({ decision: 'incomplete', missingFacts: ['preferred timing'] });
    }
    if (calls.includes(AUDIT)) {
      const previous = request.messages.filter(message => message.role === 'assistant').slice(-1)[0];
      replay = previous.content;
      replayBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
      canonicalReplayBytes = new TextEncoder().encode(JSON.stringify({ ...request,
        messages: request.messages.map(message => message === previous ? { ...message, content: JSON.stringify(validation.document) } : message),
      })).byteLength;
    }
    return replies.shift()!;
  } }).normalize(input);
  expect(result.status).toBe('accepted'); expect(result.diagnostics.repairAttempted).toBe(spent);
  expect(calls).toEqual([...(spent ? [GENERIC] : []), GENERIC, GENERIC, AUDIT, GENERIC]);
  expect(replay).toBe(raw);
  expect(replay).not.toBe(JSON.stringify(validation.document));
  expect(result.diagnostics.requestBytes).toHaveLength(calls.length);
  expect(result.diagnostics.requestBytes.slice(-1)[0]).toBe(replayBytes);
  console.info('CORAL_R27D_RAW_REPLAY_SIZE', JSON.stringify({ spent, format,
    providerBytes: new TextEncoder().encode(raw).byteLength, canonicalBytes: new TextEncoder().encode(JSON.stringify(validation.document)).byteLength,
    replayRequestBytes: replayBytes, canonicalReplayRequestBytes: canonicalReplayBytes, requestDeltaBytes: replayBytes - canonicalReplayBytes }));
});

it.each([
  ['active_material', false, false], ['document_material', false, false], ['committed_title', false, false],
  ['current_title', false, true], ['other_task', false, true], ['section_label', false, true], ['retired_material', false, true],
  ['active_material', true, true], ['document_material', true, true], ['committed_title', true, true],
] as const)('R27d workload anchors stay literal and owner-scoped: %s (omittedPreference=%s)', async (anchor, omittedPreference, shouldAudit) => {
  const f = fixture(); const setup = structuredClone(f.setup);
  const component = { localId: 'anchor-material', existingPublicId: null, parentLocalId: null, role: 'material' as const,
    label: '青チャート', sourceText: '青チャート', workloads: [], durableContextSignals: [] };
  if (anchor === 'active_material' || anchor === 'retired_material') setup.tasks[0].study!.components = [component];
  if (anchor === 'other_task') setup.tasks[1].study!.components = [component];
  if (anchor === 'section_label') setup.tasks[0].study!.components = [{ ...component, role: 'section' }];
  if (anchor === 'committed_title') setup.tasks[0].title = '青チャートの例題';
  const graph = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(), document: setup,
    context: { conversationId: 'r27d-anchors', turnId: 'setup', expectedRevision: 0 } }).graph;
  if (anchor === 'retired_material') {
    const id = graph.components[0].id;
    const entry = graph.factLifecycles.find(entry => entry.factId === id)!;
    entry.status = 'superseded'; entry.terminalRevision = graph.revision;
  }
  const text = '青チャートの例題を30題' + (omittedPreference ? '。夜の時間がいいです' : '');
  const document = structuredClone(f.shells); const task = document.tasks[0];
  document.tasks = [task]; task.existingPublicId = graph.tasks[0].id; task.sourceText = text;
  if (anchor === 'current_title') task.title = '青チャートの例題';
  if (anchor === 'document_material') task.study!.components = [component];
  task.workloads = [{ localId: 'edit', quantityRole: 'target', amount: 30, unitCode: 'problem', unitLabel: '題',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: text }];
  const input = { userText: text, committedGraph: graph, conversationArchitecture: 'interaction_v1' as const,
    publicStateSummary: { tasks: graph.tasks.map(task => ({ publicId: task.id, category: task.category, title: task.title })) } };
  expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { ...input, currentUserText: text }).errors).toEqual([]);
  const calls: string[] = [];
  const result = await createWeeklyPlanningSemanticNormalizerV5({ async createChatCompletion(request) {
    const name = request.responseFormat?.json_schema.name ?? ''; calls.push(name);
    return name === AUDIT ? JSON.stringify({ decision: 'complete', missingFacts: [] }) : JSON.stringify(document);
  } }).normalize(input);
  expect(result.status).toBe('accepted'); expect(result.diagnostics.repairAttempted).toBe(false);
  expect(calls).toEqual([GENERIC, ...(shouldAudit ? [AUDIT] : [])]);
  expect(graph.tasks[0].title).toBe(setup.tasks[0].title);
});
