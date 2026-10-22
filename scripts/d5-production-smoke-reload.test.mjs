import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningPlacementGraphViewV5';
import { compileGenericSchedulerInput } from '../src/features/weeklyPlanning/semantic/weeklyPlanningGenericSchedulerInput';
import { scheduleWeeklyPlanningStableV5Preview } from '../src/features/weeklyPlanning/semantic/weeklyPlanningStableV5PreviewScheduler';
import { allocateWeeklyPlanningEffort } from '../src/features/weeklyPlanning/semantic/weeklyPlanningEffortAllocation';
import { observeRecomputedD5Preview, observeD5SmokeReload, createD5RequestAccounting, observedD5RequestRoute,
  recordD5VisibleUsage, d5SendRequestCount } from '../tests/e2e/support/d5-production-smoke-reload.mjs';
import { redactedSmokeEvidence } from '../tests/e2e/support/d5-production-readonly.mjs';

function fixture(englishTarget = 'workload') {
  const conversationId = 'PRIVATE_CONVERSATION';
  const source = { conversationId, turnId: 'PRIVATE_TURN', semanticLocalId: 'PRIVATE_SOURCE', sourceText: 'PRIVATE_TEXT', origin: 'user' };
  const graph = { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2,
    tasks: ['math', 'english'].map(id => ({ id, category: 'study', title: 'PRIVATE_TITLE', source, createdRevision: 1 })),
    workloads: [['math', 20, 'problem'], ['english', 15, 'page']].map(([id, amount, unitCode]) => ({ id: `${id}-work`, taskId: id,
      componentId: null, quantityRole: 'target', amount, unitCode, unitLabel: unitCode, rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null, source, createdRevision: 1 })),
    effortEstimates: [['math', 15, 'duration_per_unit', 'problem'], ['english', 45, 'total_duration', null]].map(([id, minutes, kind, unitCode]) => ({
      id: `${id}-effort`, taskId: id, targetFactId: `${id}-work`, minutes, kind, unitCode, precision: 'exact', source, createdRevision: id === 'math' ? 2 : 1 })),
  };
  if (englishTarget === 'task') graph.effortEstimates[1].targetFactId = 'english';
  graph.factLifecycles = [...graph.tasks, ...graph.workloads, ...graph.effortEstimates].map(fact => ({ factId: fact.id, status: 'active', createdRevision: fact.createdRevision, terminalRevision: null, supersededByFactId: null }));
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const compiled = compileGenericSchedulerInput({ graph: active, context: { ownerId: 'PRIVATE_OWNER', currentDate: '2026-10-25',
    planningStartDate: '2026-10-26', planningEndDate: '2026-11-01', timeZone: 'Asia/Tokyo' } });
  expect(compiled.status).toBe('ready');
  const preview = scheduleWeeklyPlanningStableV5Preview({ input: compiled.input, graph: createWeeklyPlanningPlacementGraphViewV5(active) });
  expect(preview.status).toBe('ready');
  const after = { ownerId: 'PRIVATE_OWNER', conversationId, weekStartDate: '2026-10-26', savedAt: '2026-10-22T00:00:00Z',
    version: 'studyplanner-weekly-planning-stable-v5-session-v1', requiredCapabilities: ['PRIVATE_CAPABILITY'], graph,
    planningState: { revision: 4, messages: [{ id: 'old', role: 'assistant', content: 'PRIVATE_SETUP' },
      { id: 'reply', role: 'assistant', content: 'PRIVATE_ACK' }], previewCandidates: preview.candidates,
      intakeState: { c5SelectionLedger: { consumed: [{ requestKey: 'PRIVATE_RECEIPT' }] } } } };
  const before = structuredClone(after);
  before.graph.revision = 1; before.planningState.revision = 2;
  before.graph.effortEstimates = before.graph.effortEstimates.filter(fact => fact.taskId !== 'math');
  before.graph.factLifecycles = before.graph.factLifecycles.filter(fact => fact.factId !== 'math-effort');
  before.planningState.previewCandidates = []; before.planningState.messages.pop(); before.planningState.intakeState.c5SelectionLedger.consumed = [];
  return { before, after, targets: { mathTaskId: 'math', mathWorkloadId: 'math-work', englishTaskId: 'english', englishWorkloadId: 'english-work' } };
}

describe('actual persisted preview recomputation evidence', () => {
  it('reads production-scheduler slices and distinguishes base from allocated totals', () => {
    const { before, after, targets } = fixture();
    const value = observeRecomputedD5Preview(before, after, targets);
    expect(value).toMatchObject({ status: 'verified', mathBaseMinutes: 300, englishBaseMinutes: 45, fresh: true, provenance: true, englishUnchanged: true });
    expect(value.mathAllocatedMinutes).toBe(allocateWeeklyPlanningEffort({ baseEstimateMinutes: 300 }).allocationMinutes);
    expect(value.englishAllocatedMinutes).toBe(allocateWeeklyPlanningEffort({ baseEstimateMinutes: 45 }).allocationMinutes);
    expect(JSON.stringify(redactedSmokeEvidence({ recompute: value }))).not.toContain('PRIVATE_');
  });
  it.each([
    ['missing preview', value => { value.planningState.previewCandidates = []; }],
    ['stale revision', value => { value.planningState.previewCandidates[0].stableV5Metadata.graphRevision--; }],
    ['wrong conversation', value => { value.planningState.previewCandidates[0].stableV5Metadata.conversationId = 'other'; }],
    ['unrelated task', value => { value.planningState.previewCandidates[0].stableV5Metadata.taskId = 'other'; }],
    ['missing estimate source', value => { value.planningState.previewCandidates[0].stableV5Metadata.sourceFactRefs = []; }],
    ['duplicate candidate', value => { value.planningState.previewCandidates.push(structuredClone(value.planningState.previewCandidates[0])); }],
    ['missing breakdown', value => { delete value.planningState.previewCandidates[0].allocationBreakdown; }],
    ['inconsistent duration', value => { value.planningState.previewCandidates[0].durationMinutes++; }],
    ['wrong base', value => { value.planningState.previewCandidates[0].allocationBreakdown.estimatedMinutes++; }],
    ['wrong buffer', value => { value.planningState.previewCandidates[0].allocationBreakdown.bufferedMinutes++; }],
    ['zero calibration', value => { value.planningState.previewCandidates[0].allocationBreakdown.calibratedMinutes = 0; }],
    ['wrong math fact', value => { value.graph.effortEstimates[0].minutes = 14; }],
    ['wrong quantity', value => { value.graph.workloads[0].amount = 19; }],
    ['English changed', value => { value.graph.effortEstimates[1].minutes++; }],
    ['non-finite evidence', value => { value.planningState.previewCandidates[0].allocationBreakdown.marginMinutes = NaN; }],
    ['wrong owner', value => { value.ownerId = 'other'; }],
  ])('refuses %s rather than constructing a fresh graph-only oracle', (_name, change) => {
    const { before, after, targets } = fixture(); change(after);
    expect(observeRecomputedD5Preview(before, after, targets).status).not.toBe('verified');
  });
  it('preserves the explicit OFF unspecified-precision allowance while Jev remains exact-only', () => {
    const { before, after, targets } = fixture(); after.graph.effortEstimates[0].precision = 'unspecified';
    expect(observeRecomputedD5Preview(before, after, targets).status).toBe('estimate_mismatch');
    expect(observeRecomputedD5Preview(before, after, { ...targets, expectation: 'EXPECT_FALLBACK' }).status).toBe('verified');
  });
  it('accepts the existing whole-task English45 binding only for its unique target workload', () => {
    const { before, after, targets } = fixture('task');
    expect(observeRecomputedD5Preview(before, after, targets).status).toBe('verified');
  });
});

describe('reload compares retained checkpoints without a send', () => {
  it('allows only metadata timestamp and object-key ordering to change', () => {
    const { after } = fixture(); const reloaded = structuredClone(after); reloaded.savedAt = '2026-10-22T00:01:00Z';
    const result = observeD5SmokeReload(after, after, reloaded, reloaded, 'reply');
    expect(result).toMatchObject({ chatUnchanged: true, ownedUnchanged: true, storesAgree: true, sameAssistant: true,
      revisionSame: true, receiptSame: true, previewSame: true, estimateSame: true,
      pendingTurnPresent: false, pendingApprovalPresent: false, approvalRecoveryPresent: false });
  });
  it.each([
    ['reply', value => { value.planningState.messages[1].content = 'changed'; }, 'sameAssistant'],
    ['revision', value => { value.planningState.revision++; }, 'revisionSame'],
    ['receipt', value => { value.planningState.intakeState.c5SelectionLedger.consumed = []; }, 'receiptSame'],
    ['preview', value => { value.planningState.previewCandidates = []; }, 'previewSame'],
    ['estimate', value => { value.graph.effortEstimates[0].minutes = 14; }, 'estimateSame'],
    ['capability', value => { value.requiredCapabilities = []; }, 'chatUnchanged'],
    ['owner', value => { value.ownerId = 'other'; }, 'chatUnchanged'],
    ['conversation', value => { value.conversationId = 'other'; }, 'chatUnchanged'],
  ])('detects changed %s', (_name, change, field) => {
    const { after } = fixture(); const reloaded = structuredClone(after); change(reloaded);
    expect(observeD5SmokeReload(after, after, reloaded, reloaded, 'reply')[field]).toBe(false);
  });
  it.each(['pendingTurn', 'pendingApproval', 'approvalRecovery'])('detects a resumed or forbidden %s', field => {
    const { after } = fixture(); const reloaded = structuredClone(after); reloaded.planningState[field] = {};
    const result = observeD5SmokeReload(after, after, reloaded, reloaded, 'reply');
    expect(result[`${field}Present`]).toBe(true); expect(result.chatUnchanged).toBe(false);
  });
  it('keeps unread reload state unknown and never exports checkpoint fields or identifiers', () => {
    const { after } = fixture(); const result = observeD5SmokeReload(after, after, null, after, 'reply');
    expect(result.chatUnchanged).toBeNull();
    expect(observeD5SmokeReload(after, after, { ...after, planningState: { revision: 4 } }, after, 'reply').chatUnchanged).toBeNull();
    const malformed = structuredClone(after); malformed.planningState.messages = [null];
    expect(observeD5SmokeReload(after, after, malformed, after, 'reply').chatUnchanged).toBeNull();
    expect(JSON.stringify(redactedSmokeEvidence({ reload: { ...result, secret: 'PRIVATE_' }, recompute: { status: 'PRIVATE_' } }))).not.toContain('PRIVATE_');
  });
});

describe('observed requests are a lower bound, never invented provider spend', () => {
  const request = (path, method, body) => observedD5RequestRoute({ url: `https://worker.fixture${path}`, method, body });
  it('counts retries/failed attempts as observed requests and GET polls separately', () => {
    const accounting = createD5RequestAccounting();
    for (const route of [request('/chat/completions', 'POST', { decisionContext: { purpose: 'candidate_choice' } }),
      request('/chat/completions', 'POST', { purpose: 'weekly_planning_renderer' }), request('/weekly-planning/turns', 'POST'),
      request('/weekly-planning/turns?requestId=PRIVATE', 'GET'), request('/weekly-planning/turns?requestId=PRIVATE', 'GET'),
      request('/chat/completions', 'POST', null)]) accounting.observedRequests[route]++;
    expect(accounting.observedRequests).toEqual({ candidate_choice: 1, chat_completions_non_candidate: 1, durable_turn_post: 1, durable_turn_get: 2, unclassified_ai_post: 1 });
    expect(d5SendRequestCount(accounting)).toBe(4);
    const beforeReload = d5SendRequestCount(accounting); accounting.observedRequests.durable_turn_get++;
    expect(d5SendRequestCount(accounting)).toBe(beforeReload);
    accounting.observedRequests.durable_turn_post++;
    expect(d5SendRequestCount(accounting)).not.toBe(beforeReload);
    const output = redactedSmokeEvidence({ accounting }).accounting;
    expect(output.providerCalls).toBeNull(); expect(output.durableUsage).toBe('not_exposed'); expect(output.visibleUsage.totalTokens).toBeNull();
    expect(output.usageCoverage).toBe('observed_direct_responses_only');
  });
  it('sums only explicit client-visible usage and keeps missing/malformed/overflow evidence separate', () => {
    const accounting = createD5RequestAccounting();
    recordD5VisibleUsage(accounting, undefined);
    recordD5VisibleUsage(accounting, { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, secret: 'PRIVATE_' });
    recordD5VisibleUsage(accounting, { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });
    recordD5VisibleUsage(accounting, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 100 });
    recordD5VisibleUsage(accounting, { prompt_tokens: Infinity, completion_tokens: 0, total_tokens: Infinity });
    const output = redactedSmokeEvidence({ accounting }).accounting;
    expect(output.visibleUsage).toEqual({ reportedResponses: 2, invalidResponses: 2, promptTokens: 13, completionTokens: 6, totalTokens: 19 });
    expect(output.providerCalls).toBeNull(); expect(JSON.stringify(output)).not.toContain('PRIVATE_');
  });
  it('ignores unrelated auth/read/trace requests', () => {
    for (const path of ['/accounts:signInWithPassword', '/weekly-planning-trace/append', '/observability/events', '/firestore:runQuery']) expect(request(path, 'POST', {})).toBeNull();
    expect(request('/weekly-planning/turns', 'DELETE')).toBeNull();
  });
  it('the actual smoke reloads without a send and retains final server/write checks after it', () => {
    const source = readFileSync(new URL('../tests/e2e/d5-production-readonly.smoke.mjs', import.meta.url), 'utf8');
    const reload = source.split("evidence.step = 'reload';")[1].split('dialogueVerified = true;')[0];
    expect(reload).toContain('await page.reload()'); expect(reload).not.toMatch(/await send\(|\.fill\(|approval\.click|approve\.click/u);
    expect(source.indexOf("evidence.step = 'server_snapshot_after';")).toBeGreaterThan(source.indexOf('await page.reload()'));
    expect(source).toContain("expect(evidence.scheduleWrites, 'No schedule/event/approval or other planner-data write attempts').toBe(0)");
  });
});
