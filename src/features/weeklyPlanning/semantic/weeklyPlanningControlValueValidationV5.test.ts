import { orderGenericSchedulerWorkItemsByRelationsV5 } from './weeklyPlanningSchedulerRelationOrderingV5';
import { GENERIC_WORK_ITEM_VERSION, type GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import { resolveWeeklyPlanningAvailability } from './weeklyPlanningAvailabilityResolver';
import { resolveWeeklyPlanningDateExpressionsV5 } from './weeklyPlanningResolvedDateExpressionsV5';
import { createWeeklyPlanningAvailabilityResolverGraphV5 } from './weeklyPlanningSchedulerAvailabilityProjectionV5';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5, validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5, WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { getWeeklyPlanningStableV5SessionStorageKeyForTest, loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { prepareWeeklyPlanningStableV5Checkpoint } from '../application/weeklyPlanningStableV5SessionCodec';

const OWNER = 'control-owner'; const WEEK = '2026-08-24'; const CONVERSATION = 'control-conversation';
function document(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss', planningWindow: null,
    tasks: ['a', 'b'].map(localId => ({ localId, category: 'non_study', title: localId, study: null,
      workloads: [], effortEstimates: [], recurrence: [], temporalConstraints: [], sourceText: localId })),
    relations: [{ localId: 'order', kind: 'before', fromLocalId: 'a', toLocalId: 'b', sourceText: 'a before b' }],
    constraintSourceRequests: [{ localId: 'source', kind: 'timetable', selector: 'active', requestedAction: 'stop_using', sourceText: 'Do not use timetable' }],
    availabilityDeclarations: [], uncertainties: [], corrections: [], decisions: [] };
}
function canonical(input = document()) {
  expect(validateWeeklyPlanningSemanticValueV5(input).errors).toEqual([]);
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
const kinds = ['before', 'after', 'depends_on', 'priority_over', 'sequence'] as const;
it.each(kinds.flatMap(kind => SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5.flatMap(sourceKind => (['use', 'stop_using'] as const).map(action => ({ kind, sourceKind, action })))))('preserves writer control payload %j', ({ kind, sourceKind, action }) => {
  const input = document(); input.relations[0].kind = kind;
  Object.assign(input.constraintSourceRequests[0], { kind: sourceKind, requestedAction: action }); roundTrip(canonical(input));
});
it.each((['kind', 'selector', 'requestedAction', 'relationKind'] as const).flatMap(field => [undefined, null, 42, 'unknown', ''].map(value => ({ field, value }))))('rejects malformed control %j at every recovery gate', ({ field, value }) => {
  const input = document(); const graph = canonical(input); roundTrip(graph);
  const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK); const original = storage.storage.getItem(key)!;
  const relation = field === 'relationKind'; const bucket = relation ? 'relations' : 'constraintSourceRequests';
  const change = { [relation ? 'kind' : field]: value };
  Object.assign(input[bucket][0], change); Object.assign(graph[bucket][0], change);
  expect(validateWeeklyPlanningSemanticValueV5(input).document).toBeNull();
  expect(validateWeeklyPlanningFactGraphValueV5(graph).graph).toBeNull();
  expect(parseWeeklyPlanningFactGraphV5(JSON.stringify(graph)).graph).toBeNull();
  expect(() => serializeWeeklyPlanningFactGraphV5(graph)).toThrow('Invalid WeeklyPlanningFactGraphV5');
  expect(prepareWeeklyPlanningStableV5Checkpoint(parameters(graph)).status).not.toBe('ready');
  expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(false);
  expect(storage.storage.getItem(key)).toBe(original);
  const corrupted = JSON.parse(original); corrupted.graph = graph; storage.storage.setItem(key, JSON.stringify(corrupted));
  expect(load()).toBeNull();
});
it('rejects an invalid graph-only source resolution marker', () => {
  const graph = canonical(); Object.assign(graph.constraintSourceRequests[0], { resolutionStatus: 'ready' });
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain('graph.constraintSourceRequests[0].resolutionStatus');
});
it.each(['relations', 'constraintSourceRequests'] as const)('checks removed historical %s values without applying them', bucket => {
  const graph = canonical(); graph.revision = 2; const fact = graph[bucket][0];
  Object.assign(graph.factLifecycles.find(entry => entry.factId === fact.id)!, { status: 'removed', terminalRevision: 2 });
  roundTrip(graph); Object.assign(fact, { kind: 'unknown' });
  expect(validateWeeklyPlanningFactGraphValueV5(graph).graph).toBeNull();
});

function item(taskId: string): GenericPlanningWorkItem {
  return { version: GENERIC_WORK_ITEM_VERSION, id: `item:${taskId}`, taskId, componentId: null, workloadFactId: `work:${taskId}`,
    label: taskId, quantityRole: 'target', actionability: 'actionable', quantity: { amount: 1, unitCode: 'page', unitLabel: 'page', ordinalRange: null, actualRange: null },
    estimatedMinutes: 30, estimateBasis: null, estimateSourceFactIds: [], estimateSourceWorkloadFactIds: [], splitPolicy: 'atomic', periodExpression: null, sourceFactRefs: [taskId] };
}
it.each(kinds)('preserves %s ordering after checkpoint restore', kind => {
  const input = document(); input.relations[0].kind = kind; roundTrip(canonical(input));
  const graph = load()!.graph; const [a, b] = graph.tasks.map(task => task.id);
  const reverse = kind === 'after' || kind === 'depends_on';
  const items = reverse ? [item(a), item(b)] : [item(b), item(a)];
  expect(orderGenericSchedulerWorkItemsByRelationsV5({ items, relations: graph.relations }).map(work => work.taskId)).toEqual(reverse ? [b, a] : [a, b]);
});
it.each(['use', 'stop_using'] as const)('preserves %s source meaning after checkpoint restore', requestedAction => {
  const input = document(); input.constraintSourceRequests[0].requestedAction = requestedAction; roundTrip(canonical(input));
  const graph = createWeeklyPlanningAvailabilityResolverGraphV5(load()!.graph);
  const result = resolveWeeklyPlanningAvailability({ graph,
    context: { ownerId: OWNER, currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-08-30', timeZone: 'Asia/Tokyo' },
    resolvedDateExpressions: resolveWeeklyPlanningDateExpressionsV5({ graph, currentDate: WEEK }),
    externalSources: [{ kind: 'timetable', status: 'success', ownerId: OWNER, activeSourceId: 'timetable', attemptCount: 1,
      events: [{ eventId: 'class', ownerId: OWNER, start: { date: '2026-08-26', time: '09:00' }, end: { date: '2026-08-26', time: '10:30' }, timeZone: 'Asia/Tokyo', constraintLevel: 'hard' }] }],
  });
  expect(result.readiness).toBe('ready'); expect(result.issues).toEqual([]);
  expect(result.sourceSelections.map(selection => selection.status)).toEqual([requestedAction === 'use' ? 'selected' : 'deselected']);
  expect(result.windows).toHaveLength(requestedAction === 'use' ? 1 : 0);
});
