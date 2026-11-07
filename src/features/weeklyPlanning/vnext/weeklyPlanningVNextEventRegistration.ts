import { projectWeeklyPlanningFixedEventRegistration, type SemanticConversationActV5 } from './weeklyPlanningVNextV5Boundary';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { VNextEventRegistrationAct } from './weeklyPlanningVNextInterpretationContract';
import type { VNextTurnDelta, VNextTurnError, WeeklyPlanningVNextState } from './weeklyPlanningVNextTypes';
import { createVNextLineageResolver, withCurrentVNextReferences } from './weeklyPlanningVNextWorkIdentity';
import { filterActiveWeeklyPlanningFactsV5 } from '../semantic/weeklyPlanningFactLifecycleV5';

export interface VNextEventRegistrationContext {
  acts: readonly VNextEventRegistrationAct[];
  /** The current-state compilation from the same application compiler as the preview. */
  compilation: GenericSchedulerInputCompilationResult | null;
}

/** One formal binding rule for native dry-run and final acceptance. Resolve against the staged
 * transaction, never prose or constructed ids. Unknown/removed/wrong-kind targets reject the
 * reading rather than widening an explicit request to all current-turn tasks. EventRegistration
 * integration guards selective local/existing refs, atomic rejection and the V5 projection oracle.
 */
export function resolveVNextEventRegistrationActs(params: {
  state: WeeklyPlanningVNextState;
  delta: VNextTurnDelta;
  acts: readonly VNextEventRegistrationAct[] | undefined;
  currentTurnId: string;
}): { status: 'resolved'; acts: SemanticConversationActV5[] } | { status: 'rejected'; errors: VNextTurnError[] } {
  const { graph } = params.state;
  const resolver = createVNextLineageResolver(graph);
  const targets = [...graph.tasks, ...graph.components];
  const errors: VNextTurnError[] = [];
  const acts = (params.acts ?? []).map((act, index): SemanticConversationActV5 => {
    if (act.targetRef === null) return { kind: act.kind, targetPublicId: null };
    const ref = act.targetRef;
    const referenced = 'factId' in ref ? ref.factId : targets.find(fact =>
      fact.source.turnId === params.currentTurnId && fact.source.semanticLocalId === ref.localId
      && params.delta.add.some(added => added.localId === ref.localId && (added.kind === 'task' || added.kind === 'component')))?.id;
    const id = referenced ? resolver.leafOf(referenced) : null;
    if (!id || !targets.some(fact => fact.id === id)) errors.push({ code: 'unknown_ref',
      path: `conversationActs[${index}].targetRef`, localId: null, factId: 'factId' in ref ? ref.factId : null });
    return { kind: act.kind, targetPublicId: id ?? null };
  });
  return errors.length ? { status: 'rejected', errors } : { status: 'resolved', acts };
}

/** Retain only formally requested, still-timeless task registrations. Null keeps V5's current-turn
 * scope, never all historical tasks. Once retained, the request survives other questions until
 * the session captures its preview; EventRegistration integration guards reload and consumption.
 */
export function retainVNextPendingEventRegistrationTargets(
  state: WeeklyPlanningVNextState, acts: readonly SemanticConversationActV5[], currentTurnId: string,
): string[] {
  const { graph } = state;
  const { leafOf } = createVNextLineageResolver(graph);
  const tasks = filterActiveWeeklyPlanningFactsV5(graph, graph.tasks);
  const taskIds = new Set(tasks.map(task => task.id));
  const currentTaskIds = new Set([
    ...tasks.filter(task => task.source.turnId === currentTurnId).map(task => task.id),
    ...filterActiveWeeklyPlanningFactsV5(graph, [...graph.studyContexts, ...graph.components, ...graph.workloads, ...graph.effortEstimates,
      ...graph.temporalConstraints, ...graph.taskDateRules, ...graph.recurrences]).filter(fact => fact.source.turnId === currentTurnId)
      .map(fact => leafOf(fact.taskId) ?? fact.taskId),
  ]);
  const fixedTaskIds = new Set(filterActiveWeeklyPlanningFactsV5(graph, graph.temporalConstraints)
    .filter(bound => bound.kind === 'fixed_interval' && bound.constraintLevel === 'hard')
    .map(bound => leafOf(bound.taskId) ?? bound.taskId));
  // A broad registration must not turn separately stated movable work into a fixed event.
  // An explicit task target can still request its clocks even when its workload is known.
  const definedWorkTaskIds = new Set([
    ...filterActiveWeeklyPlanningFactsV5(graph, graph.workloads).map(workload => leafOf(workload.taskId) ?? workload.taskId),
    ...filterActiveWeeklyPlanningFactsV5(graph, graph.effortEstimates)
      .filter(effort => effort.kind === 'total_duration' && leafOf(effort.targetFactId) === leafOf(effort.taskId))
      .map(effort => leafOf(effort.taskId) ?? effort.taskId),
  ]);
  const requested = acts.filter(act => act.kind === 'request_event_registration').flatMap(act =>
    act.targetPublicId === null ? [...currentTaskIds].filter(id => !definedWorkTaskIds.has(id)) : [act.targetPublicId]);
  return [...new Set([
    ...(state.pendingEventRegistrationTargetIds ?? []).map(leafOf).filter((id): id is string => id !== null && taskIds.has(id)),
    ...requested.filter(id => taskIds.has(id) && !fixedTaskIds.has(id)),
  ])];
}

/** V5 supplies the registration candidate keys; the one transaction compares them with study
 * keys and the shown set. Keep this read-only: facts, memo and reply text never supply identity.
 */
export function vnextRegistrationCandidateKeys(state: WeeklyPlanningVNextState, context: VNextEventRegistrationContext,
  acts: SemanticConversationActV5[], currentTurnId: string): string[] {
  if (!acts.length || !context.compilation) return [];
  const resolver = createVNextLineageResolver(state.graph);
  const graph = withCurrentVNextReferences(state.graph, id => resolver.leafOf(id) ?? id);
  return projectWeeklyPlanningFixedEventRegistration({ graph, compilation: context.compilation,
    currentTurnId, registrationActs: acts }).candidates.map(c => c.stableKey);
}
