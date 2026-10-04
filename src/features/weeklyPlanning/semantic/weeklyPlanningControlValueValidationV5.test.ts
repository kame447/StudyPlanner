import { createGraphCheckpointAssertions } from '../testUtils/__tests__/weeklyPlanningGraphCheckpointAssertions';
import { orderGenericSchedulerWorkItemsByRelationsV5 } from './weeklyPlanningSchedulerRelationOrderingV5';
import { GENERIC_WORK_ITEM_VERSION, type GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import { resolveWeeklyPlanningAvailability } from './weeklyPlanningAvailabilityResolver';
import { resolveWeeklyPlanningDateExpressionsV5 } from './weeklyPlanningResolvedDateExpressionsV5';
import { createWeeklyPlanningAvailabilityResolverGraphV5 } from './weeklyPlanningSchedulerAvailabilityProjectionV5';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5, WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';

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
let checkpoint: ReturnType<typeof createGraphCheckpointAssertions>;
beforeEach(() => { checkpoint = createGraphCheckpointAssertions({ ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION }); });
afterEach(() => checkpoint.restore());
const kinds = ['before', 'after', 'depends_on', 'priority_over', 'sequence'] as const;
it.each(kinds.flatMap(kind => SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5.flatMap(sourceKind => (['use', 'stop_using'] as const).map(action => ({ kind, sourceKind, action })))))('preserves writer control payload %j', ({ kind, sourceKind, action }) => {
  const input = document(); input.relations[0].kind = kind;
  Object.assign(input.constraintSourceRequests[0], { kind: sourceKind, requestedAction: action }); checkpoint.roundTrip(canonical(input));
});
it.each((['kind', 'selector', 'requestedAction', 'relationKind'] as const).flatMap(field => [undefined, null, 42, 'unknown', ''].map(value => ({ field, value }))))('rejects malformed control %j at every recovery gate', ({ field, value }) => {
  const input = document(); const graph = canonical(input); checkpoint.roundTrip(graph);
  const relation = field === 'relationKind'; const bucket = relation ? 'relations' : 'constraintSourceRequests';
  const change = { [relation ? 'kind' : field]: value };
  Object.assign(input[bucket][0], change); Object.assign(graph[bucket][0], change);
  expect(validateWeeklyPlanningSemanticValueV5(input).document).toBeNull();
  checkpoint.reject(graph);
});
it('rejects an invalid graph-only source resolution marker', () => {
  const graph = canonical(); Object.assign(graph.constraintSourceRequests[0], { resolutionStatus: 'ready' });
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain('graph.constraintSourceRequests[0].resolutionStatus');
});
it.each(['relations', 'constraintSourceRequests'] as const)('checks removed historical %s values without applying them', bucket => {
  const graph = canonical(); graph.revision = 2; const fact = graph[bucket][0];
  Object.assign(graph.factLifecycles.find(entry => entry.factId === fact.id)!, { status: 'removed', terminalRevision: 2 });
  checkpoint.roundTrip(graph); Object.assign(fact, { kind: 'unknown' });
  expect(validateWeeklyPlanningFactGraphValueV5(graph).graph).toBeNull();
});

function item(taskId: string): GenericPlanningWorkItem {
  return { version: GENERIC_WORK_ITEM_VERSION, id: `item:${taskId}`, taskId, componentId: null, workloadFactId: `work:${taskId}`,
    label: taskId, quantityRole: 'target', actionability: 'actionable', quantity: { amount: 1, unitCode: 'page', unitLabel: 'page', ordinalRange: null, actualRange: null },
    estimatedMinutes: 30, estimateBasis: null, estimateSourceFactIds: [], estimateSourceWorkloadFactIds: [], splitPolicy: 'atomic', periodExpression: null, sourceFactRefs: [taskId] };
}
it.each(kinds)('preserves %s ordering after checkpoint restore', kind => {
  const input = document(); input.relations[0].kind = kind; checkpoint.roundTrip(canonical(input));
  const graph = checkpoint.load()!.graph; const [a, b] = graph.tasks.map(task => task.id);
  const reverse = kind === 'after' || kind === 'depends_on';
  const items = reverse ? [item(a), item(b)] : [item(b), item(a)];
  expect(orderGenericSchedulerWorkItemsByRelationsV5({ items, relations: graph.relations }).map(work => work.taskId)).toEqual(reverse ? [b, a] : [a, b]);
});
it.each(['use', 'stop_using'] as const)('preserves %s source meaning after checkpoint restore', requestedAction => {
  const input = document(); input.constraintSourceRequests[0].requestedAction = requestedAction; checkpoint.roundTrip(canonical(input));
  const graph = createWeeklyPlanningAvailabilityResolverGraphV5(checkpoint.load()!.graph);
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
