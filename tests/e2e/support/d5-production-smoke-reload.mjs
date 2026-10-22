import { allocateWeeklyPlanningEffort } from '../../../src/features/weeklyPlanning/semantic/weeklyPlanningEffortAllocation.ts';

const boundedNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? value : null;
const boundedCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 100_000 ? value : null;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const close = (a, b) => boundedNumber(a) !== null && boundedNumber(b) !== null && Math.abs(a - b) < 1e-6;
const activeIds = graph => new Set(graph?.factLifecycles?.filter(row => row.status === 'active').map(row => row.factId));

/** Inspect actual persisted preview slices; never create a new preview and call it a production rebuild. */
export function observeRecomputedD5Preview(before, after, { mathTaskId, mathWorkloadId, englishTaskId, englishWorkloadId, expectation = 'EXPECT_JEV' }) {
  const result = { status: 'invalid_state', mathBaseMinutes: null, mathAllocatedMinutes: null, mathExpectedAllocatedMinutes: null,
    englishBaseMinutes: null, englishAllocatedMinutes: null, englishExpectedAllocatedMinutes: null, englishUnchanged: null, fresh: null, provenance: null };
  if (!before?.graph || !after?.graph || !before.planningState || !after.planningState
    || before.ownerId !== after.ownerId || before.conversationId !== after.conversationId || before.weekStartDate !== after.weekStartDate
    || ![before, after].every(snapshot => [snapshot.ownerId, snapshot.conversationId, snapshot.weekStartDate].every(value => typeof value === 'string' && value.length > 0)
      && Number.isSafeInteger(snapshot.graph.revision) && Number.isSafeInteger(snapshot.planningState.revision)
      && ['factLifecycles', 'effortEstimates', 'workloads'].every(key => Array.isArray(snapshot.graph[key])))
    || ![mathTaskId, mathWorkloadId, englishTaskId, englishWorkloadId].every(value => typeof value === 'string' && value.length > 0)) return result;
  const graph = after.graph, active = activeIds(graph), beforeActive = activeIds(before.graph);
  const english = value => value.graph.effortEstimates.filter(fact => activeIds(value.graph).has(fact.id) && fact.taskId === englishTaskId);
  const mathEfforts = graph.effortEstimates.filter(fact => active.has(fact.id) && fact.taskId === mathTaskId);
  const englishEfforts = english(after);
  result.englishUnchanged = equal(english(before), englishEfforts);
  const math = mathEfforts.length === 1 ? mathEfforts[0] : null;
  const en = englishEfforts.length === 1 ? englishEfforts[0] : null;
  const workload = graph.workloads.find(fact => active.has(fact.id) && fact.id === mathWorkloadId && fact.taskId === mathTaskId);
  const enWorkload = graph.workloads.find(fact => active.has(fact.id) && fact.id === englishWorkloadId && fact.taskId === englishTaskId);
  if (math?.targetFactId !== mathWorkloadId || math.kind !== 'duration_per_unit' || math.minutes !== 15
    || math.unitCode !== 'problem' || !(math.precision === 'exact' || expectation === 'EXPECT_FALLBACK' && math.precision === 'unspecified')
    || workload?.amount !== 20 || workload.unitCode !== 'problem' || workload.quantityRole !== 'target'
    || !en || ![englishWorkloadId, englishTaskId].includes(en.targetFactId) || en.kind !== 'total_duration' || en.minutes !== 45 || en.precision === 'approximate'
    || enWorkload?.amount !== 15 || enWorkload.unitCode !== 'page' || enWorkload.quantityRole !== 'target'
    || graph.workloads.filter(fact => active.has(fact.id) && fact.taskId === englishTaskId && fact.quantityRole === 'target').length !== 1
    || !result.englishUnchanged || !beforeActive.has(en.id)) {
    result.status = 'estimate_mismatch'; return result;
  }
  const candidates = after.planningState.previewCandidates;
  if (!Array.isArray(candidates) || candidates.length === 0) { result.status = 'missing_preview'; return result; }
  result.fresh = graph.revision > before.graph.revision && after.planningState.revision > before.planningState.revision
    && !equal(candidates, before.planningState.previewCandidates);
  const groups = [[mathTaskId, mathWorkloadId, math.id, 'math', 300], [englishTaskId, englishWorkloadId, en.id, 'english', 45]];
  result.provenance = new Set(candidates.map(candidate => candidate.stableKey)).size === candidates.length
    && candidates.every(candidate => typeof candidate.stableKey === 'string' && candidate.stableKey.length > 0 && candidate.stableV5Metadata?.runtime === 'stable_v5'
    && candidate.stableV5Metadata.conversationId === after.conversationId && candidate.stableV5Metadata.graphRevision === graph.revision
    && [mathTaskId, englishTaskId].includes(candidate.stableV5Metadata.taskId));
  if (!result.fresh || !result.provenance) { result.status = 'stale_preview'; return result; }
  for (const [taskId, workloadId, estimateId, label, base] of groups) {
    const slices = candidates.filter(candidate => candidate.stableV5Metadata.taskId === taskId);
    if (!slices.length || slices.some(candidate => !Array.isArray(candidate.stableV5Metadata.sourceFactRefs)
      || ![workloadId, estimateId].every(id => candidate.stableV5Metadata.sourceFactRefs.includes(id))
      || !candidate.allocationBreakdown || !['estimatedMinutes', 'calibratedMinutes', 'bufferedMinutes', 'allocatedMinutes', 'marginMinutes']
        .every(key => boundedNumber(candidate.allocationBreakdown[key]) !== null)
      || ['estimatedMinutes', 'calibratedMinutes', 'bufferedMinutes'].some(key => candidate.allocationBreakdown[key] <= 0)
      || candidate.durationMinutes <= 0 || !close(candidate.durationMinutes, candidate.allocationBreakdown.allocatedMinutes)
      || !close(candidate.allocationBreakdown.marginMinutes, Math.max(0, candidate.durationMinutes - candidate.allocationBreakdown.estimatedMinutes)))) {
      result.provenance = false; result.status = 'invalid_preview'; return result;
    }
    const sum = key => slices.reduce((total, candidate) => total + candidate.allocationBreakdown[key], 0);
    result[`${label}BaseMinutes`] = boundedNumber(sum('estimatedMinutes'));
    result[`${label}AllocatedMinutes`] = boundedNumber(slices.reduce((total, candidate) => total + candidate.durationMinutes, 0));
    // Use the same allocation function as the app, with the preview's actual calibration evidence.
    const allocation = allocateWeeklyPlanningEffort({ baseEstimateMinutes: base, calibrationMultiplier: sum('calibratedMinutes') / base });
    result[`${label}ExpectedAllocatedMinutes`] = boundedNumber(allocation.allocationMinutes);
    if (!close(result[`${label}BaseMinutes`], base)) { result.status = 'base_mismatch'; return result; }
    if (!close(sum('calibratedMinutes'), allocation.calibratedEstimateMinutes) || !close(sum('bufferedMinutes'), allocation.bufferedEstimateMinutes)
      || !close(result[`${label}AllocatedMinutes`], allocation.allocationMinutes)) { result.status = 'allocation_mismatch'; return result; }
  }
  result.status = 'verified'; return result;
}

const checkpointBasis = snapshot => {
  if (!snapshot || typeof snapshot.ownerId !== 'string' || typeof snapshot.conversationId !== 'string'
    || typeof snapshot.weekStartDate !== 'string' || !snapshot.graph || !snapshot.planningState
    || !Array.isArray(snapshot.planningState.messages) || !Array.isArray(snapshot.graph.effortEstimates)
    || !snapshot.planningState.messages.every(message => message && typeof message.id === 'string' && typeof message.role === 'string' && typeof message.content === 'string')
    || !Number.isSafeInteger(snapshot.planningState.revision)) return null;
  const { savedAt: _metadataTimestamp, ...basis } = snapshot;
  return basis;
};
/** Comparison only; IDs and message text stay invocation-local and never enter evidence. */
export function observeD5SmokeReload(beforeChat, beforeOwned, afterChat, afterOwned, assistantId) {
  const bases = [beforeChat, beforeOwned, afterChat, afterOwned].map(checkpointBasis);
  if (bases.some(value => value === null)) return { chatUnchanged: null, ownedUnchanged: null, storesAgree: null,
    sameAssistant: null, revisionSame: null, receiptSame: null, previewSame: null, estimateSame: null,
    pendingTurnPresent: null, pendingApprovalPresent: null, approvalRecoveryPresent: null };
  const state = afterChat.planningState;
  const assistant = beforeChat.planningState.messages.find(message => message.id === assistantId && message.role === 'assistant');
  return { chatUnchanged: equal(bases[0], bases[2]), ownedUnchanged: equal(bases[1], bases[3]), storesAgree: equal(bases[2], bases[3]),
    sameAssistant: Boolean(assistant && state.messages.some(message => message.id === assistantId && equal(message, assistant))),
    revisionSame: state.revision === beforeChat.planningState.revision,
    receiptSame: equal(state.intakeState?.c5SelectionLedger, beforeChat.planningState.intakeState?.c5SelectionLedger),
    previewSame: equal(state.previewCandidates, beforeChat.planningState.previewCandidates),
    estimateSame: equal(afterChat.graph.effortEstimates, beforeChat.graph.effortEstimates),
    pendingTurnPresent: state.pendingTurn != null || afterOwned.planningState.pendingTurn != null,
    pendingApprovalPresent: state.pendingApproval != null || afterOwned.planningState.pendingApproval != null,
    approvalRecoveryPresent: state.approvalRecovery != null || afterOwned.planningState.approvalRecovery != null };
}

const ROUTES = ['candidate_choice', 'chat_completions_non_candidate', 'durable_turn_post', 'durable_turn_get', 'unclassified_ai_post'];
export function observedD5RequestRoute({ url: raw, method, body }) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') return null;
  if (url.pathname.endsWith('/weekly-planning/turns')) return method === 'POST' ? 'durable_turn_post' : method === 'GET' ? 'durable_turn_get' : null;
  if (method !== 'POST' || !url.pathname.endsWith('/chat/completions')) return null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'unclassified_ai_post';
  return body.decisionContext?.purpose === 'candidate_choice' ? 'candidate_choice' : 'chat_completions_non_candidate';
}
export function createD5RequestAccounting() {
  const observedRequests = Object.fromEntries(ROUTES.map(route => [route, 0]));
  const visibleUsage = { reportedResponses: 0, invalidResponses: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  return { observedRequests, visibleUsage, providerCalls: null, durableUsage: 'not_exposed' };
}
export function recordD5VisibleUsage(accounting, usage) {
  if (usage === undefined) return;
  if (!usage || !['prompt_tokens', 'completion_tokens', 'total_tokens'].every(key => boundedCount(usage[key]) !== null)
    || usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens) { accounting.visibleUsage.invalidResponses++; return; }
  const values = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens };
  if (Object.keys(values).some(key => boundedNumber(accounting.visibleUsage[key] + values[key]) === null)) { accounting.visibleUsage.invalidResponses++; return; }
  accounting.visibleUsage.reportedResponses++;
  for (const key of Object.keys(values)) accounting.visibleUsage[key] += values[key];
}
export function d5SendRequestCount(accounting) {
  return ['candidate_choice', 'chat_completions_non_candidate', 'durable_turn_post', 'unclassified_ai_post']
    .reduce((total, route) => total + accounting.observedRequests[route], 0);
}

export function redactedD5ReloadEvidence(value) {
  const bool = value => typeof value === 'boolean' ? value : null;
  return Object.fromEntries(['attempted', 'chatUnchanged', 'ownedUnchanged', 'storesAgree', 'sameAssistant', 'revisionSame',
    'receiptSame', 'previewSame', 'estimateSame', 'pendingTurnPresent', 'pendingApprovalPresent', 'approvalRecoveryPresent', 'visibleAck', 'noNewSend']
    .map(key => [key, bool(value?.[key])]));
}
export function redactedD5RecomputeEvidence(value) {
  const statuses = ['verified', 'invalid_state', 'estimate_mismatch', 'missing_preview', 'stale_preview', 'invalid_preview', 'base_mismatch', 'allocation_mismatch'];
  return { status: statuses.includes(value?.status) ? value.status : 'unobserved',
    ...Object.fromEntries(['mathBaseMinutes', 'mathAllocatedMinutes', 'mathExpectedAllocatedMinutes', 'englishBaseMinutes', 'englishAllocatedMinutes', 'englishExpectedAllocatedMinutes'].map(key => [key, boundedNumber(value?.[key])])),
    ...Object.fromEntries(['englishUnchanged', 'fresh', 'provenance'].map(key => [key, typeof value?.[key] === 'boolean' ? value[key] : null])) };
}
export function redactedD5Accounting(value) {
  const reported = boundedCount(value?.visibleUsage?.reportedResponses);
  return { observedRequests: Object.fromEntries(ROUTES.map(route => [route, boundedCount(value?.observedRequests?.[route])])),
    providerCalls: null, durableUsage: 'not_exposed', usageCoverage: 'observed_direct_responses_only',
    visibleUsage: { reportedResponses: reported, invalidResponses: boundedCount(value?.visibleUsage?.invalidResponses),
      ...Object.fromEntries(['promptTokens', 'completionTokens', 'totalTokens'].map(key => [key, reported > 0 ? boundedNumber(value?.visibleUsage?.[key]) : null])) } };
}
