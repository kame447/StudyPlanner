import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5, validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { getWeeklyPlanningStableV5SessionStorageKeyForTest, loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { prepareWeeklyPlanningStableV5Checkpoint } from '../application/weeklyPlanningStableV5SessionCodec';
import { reconcileWeeklyPlanningGroundingRecordsV5 } from './weeklyPlanningGroundingV5';
import { parseWeeklyPlanningSemanticDocumentWithAvailabilityCorrectionsV5 } from './weeklyPlanningAvailabilityCorrectionCompatibilityV5';

const OWNER = 'intent-owner'; const WEEK = '2026-08-24'; const CONVERSATION = 'intent-conversation';
function document(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss',
    planningWindow: { localId: 'window', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: 'next week' },
    tasks: ['a', 'b'].map(localId => ({ localId, category: 'non_study', title: localId, study: null,
      workloads: [], effortEstimates: [], recurrence: [], temporalConstraints: [], sourceText: localId })),
    relations: [], constraintSourceRequests: [], availabilityDeclarations: [],
    uncertainties: [{ localId: 'uncertain', targetLocalId: 'window', field: 'work_breakdown', reason: 'uncertain scope', sourceText: 'not sure' }],
    corrections: [{ localId: 'correction', target: { kind: 'task', publicId: null, localId: 'a', mention: null }, operation: 'remove', replacementLocalId: null, sourceText: 'remove a' }],
    decisions: [{ localId: 'decision', target: { kind: 'planning_window', publicId: null, localId: 'window', mention: null }, decision: 'reject', sourceText: 'reject next week' }] };
}
function canonical(input = document()) {
  expect(parseWeeklyPlanningSemanticDocumentWithAvailabilityCorrectionsV5(JSON.stringify(input)).errors).toEqual([]);
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(), document: input,
    context: { conversationId: CONVERSATION, turnId: 'turn', expectedRevision: 0 } });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result.graph;
}
const parameters = (graph: WeeklyPlanningFactGraphV5) => ({ ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION,
  graph, planningState: createInitialPlanningState(WEEK) });
const load = () => loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
let storage: ReturnType<typeof createMemoryStorageHarness>; let restore: () => void;
beforeEach(() => { storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage); });
afterEach(() => restore());
function roundTrip(graph: WeeklyPlanningFactGraphV5) {
  expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).graph).toEqual(graph);
  expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(true); expect(load()?.graph).toEqual(graph);
}
function grounding(graph: WeeklyPlanningFactGraphV5) {
  return reconcileWeeklyPlanningGroundingRecordsV5({ previousRecords: [], previousGraph: createEmptyWeeklyPlanningFactGraphV5(), nextGraph: graph,
    resolvedHorizon: { startDate: '2026-08-31', endDate: '2026-09-06' }, currentTurnId: 'next', continuationAccepted: false }).map(record => record.status);
}
const targets = [
  ['uncertainties', 'uncertainties', 'field'], ['uncertainties', 'uncertainties', 'reason'],
  ['corrections', 'correctionIntents', 'operation'], ['corrections', 'correctionIntents', 'target.kind'],
  ['decisions', 'decisionIntents', 'decision'], ['decisions', 'decisionIntents', 'target.kind'],
] as const;
const malformed = targets.flatMap(([wire, bucket, field]) =>
  (field === 'field' || field === 'reason' ? [undefined, null, 42, '', '  '] : [undefined, null, 42, '', 'unsupported']).map(value => ({ wire, bucket, field, value })));
it.each(malformed)('rejects malformed intent payload %j across storage gates', ({ wire, bucket, field, value }) => {
  const input = document(); const graph = canonical(input); roundTrip(graph);
  const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK); const original = storage.storage.getItem(key)!;
  if (field === 'target.kind') {
    if (wire === 'uncertainties' || bucket === 'uncertainties') throw new Error('Invalid test case');
    Object.assign(input[wire][0].target, { kind: value }); Object.assign(graph[bucket][0].target, { kind: value });
  } else { Object.assign(input[wire][0], { [field]: value }); Object.assign(graph[bucket][0], { [field]: value }); }
  expect(validateWeeklyPlanningSemanticValueV5(input).document).toBeNull();
  expect(validateWeeklyPlanningFactGraphValueV5(graph).graph).toBeNull();
  expect(parseWeeklyPlanningFactGraphV5(JSON.stringify(graph)).graph).toBeNull();
  expect(() => serializeWeeklyPlanningFactGraphV5(graph)).toThrow('Invalid WeeklyPlanningFactGraphV5');
  expect(prepareWeeklyPlanningStableV5Checkpoint(parameters(graph)).status).not.toBe('ready');
  expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(false);
  expect(storage.storage.getItem(key)).toBe(original);
  const corrupted = JSON.parse(original); corrupted.graph = graph; storage.storage.setItem(key, JSON.stringify(corrupted)); expect(load()).toBeNull();
});
it.each(['remove', 'replace', 'modify'] as const)('round trips %s correction and rejects contradictory replacement', operation => {
  const input = document(); Object.assign(input.corrections[0], { operation, replacementLocalId: operation === 'remove' ? null : 'b' });
  const graph = canonical(input); roundTrip(graph);
  Object.assign(input.corrections[0], { replacementLocalId: operation === 'remove' ? 'b' : null });
  Object.assign(graph.correctionIntents[0], { replacementFactId: operation === 'remove' ? graph.tasks[1].id : null });
  expect(validateWeeklyPlanningSemanticValueV5(input).document).toBeNull();
  expect(validateWeeklyPlanningFactGraphValueV5(graph).graph).toBeNull();
  expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(false);
});
it.each(['accept', 'reject', 'modify'] as const)('round trips %s decision', decision => {
  const input = document(); input.decisions[0].decision = decision; roundTrip(canonical(input));
});
it('preserves rejection meaning through actual checkpoint and grounding reconciliation', () => {
  roundTrip(canonical()); expect(grounding(load()!.graph)).toEqual(['rejected']);
});
it.each(['custom concern', 'a_new_field', '未確定の理由'])('keeps open nonempty uncertainty vocabulary %s', text => {
  const input = document(); Object.assign(input.uncertainties[0], { field: text, reason: text }); roundTrip(canonical(input));
});
it('preserves the full availability correction compatibility path', () => {
  const input = document(); input.availabilityDeclarations = [{ localId: 'availability', kind: 'unavailable', dateExpression: '2026-08-26', namedTimePeriod: null,
    startTime: '18:00', endTime: '19:00', recurrenceKind: null, days: [], constraintLevel: 'hard', sourceText: 'busy' }];
  Object.assign(input.corrections[0].target, { kind: 'availability_declaration', localId: 'availability' });
  const parsed = parseWeeklyPlanningSemanticDocumentWithAvailabilityCorrectionsV5(JSON.stringify(input));
  expect(parsed.document).not.toBeNull(); const graph = canonical(parsed.document!);
  expect(graph.correctionIntents[0].target.kind).toBe('availability_declaration'); roundTrip(graph);
});
it('keeps proposal decisions out of the persisted graph', () => {
  const input = document(); Object.assign(input.decisions[0].target, { kind: 'proposal', localId: null, publicId: 'proposal-1' });
  const graph = canonical(input); expect(graph.decisionIntents).toEqual([]); roundTrip(graph);
});
it('preserves document-scoped uncertainty', () => {
  const input = document(); input.uncertainties[0].targetLocalId = 'document'; const graph = canonical(input);
  expect(graph.uncertainties[0].targetFactId).toBeNull(); roundTrip(graph);
});
it.each(['publicId', 'mention'] as const)('preserves a %s-only reference', field => {
  const input = document(); Object.assign(input.corrections[0].target, { localId: null, [field]: 'that-task' });
  const graph = canonical(input); expect(graph.correctionIntents[0].target.factId).toBeNull(); roundTrip(graph);
});
it('still rejects a well-formed but missing replacement reference', () => {
  const input = document(); Object.assign(input.corrections[0], { operation: 'replace', replacementLocalId: 'b' });
  const graph = canonical(input); graph.correctionIntents[0].replacementFactId = 'missing-fact';
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain('graph.correctionIntents[0].replacementFactId');
});
it.each(['removed', 'superseded'] as const)('validates historical %s intent payloads', status => {
  const graph = canonical(); graph.revision = 2; const old = graph.decisionIntents[0];
  const replacement = { ...structuredClone(old), id: old.id + ':replacement', createdRevision: 2 };
  if (status === 'superseded') {
    graph.decisionIntents.push(replacement);
    graph.factLifecycles.push({ factId: replacement.id, status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null });
  }
  Object.assign(graph.factLifecycles.find(entry => entry.factId === old.id)!, { status, terminalRevision: 2, supersededByFactId: status === 'superseded' ? replacement.id : null });
  roundTrip(graph); Object.assign(old, { decision: null });
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain('graph.decisionIntents[0].decision');
});
