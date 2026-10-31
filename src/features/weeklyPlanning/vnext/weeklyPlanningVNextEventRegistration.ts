import { projectWeeklyPlanningFixedEventRegistration, type SemanticConversationActV5 } from './weeklyPlanningVNextV5Boundary';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { VNextEventRegistrationAct } from './weeklyPlanningVNextInterpretationContract';
import type { VNextTurnDelta, VNextTurnError, WeeklyPlanningVNextState } from './weeklyPlanningVNextTypes';
import { createVNextLineageResolver, withCurrentVNextReferences } from './weeklyPlanningVNextWorkIdentity';

export interface VNextEventRegistrationContext {
  acts: readonly VNextEventRegistrationAct[];
  shownPreviewBlockIds: readonly string[];
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

/** Compare V5's own stable candidate keys at the current revision with the shown set. The
 * comparison runs only for an otherwise fact-noop transaction: no new facts/ids are invented.
 * Match the requested keys directly to shown blocks without parsing ids, memo or rendered text.
 * A request for an already shown event, including a subset, is a duplicate, not a removal.
 */
export function vnextRegistrationChangesPreview(state: WeeklyPlanningVNextState, context: VNextEventRegistrationContext,
  acts: SemanticConversationActV5[], currentTurnId: string): boolean {
  if (!acts.length) return false;
  if (!context.compilation) return false;
  const resolver = createVNextLineageResolver(state.graph);
  const graph = withCurrentVNextReferences(state.graph, id => resolver.leafOf(id) ?? id);
  const input = { graph, compilation: context.compilation, currentTurnId };
  const requested = projectWeeklyPlanningFixedEventRegistration({ ...input, registrationActs: acts }).candidates.map(c => c.stableKey).sort();
  if (!requested.length) return false;
  const shown = new Set(context.shownPreviewBlockIds);
  return requested.some(id => !shown.has(id));
}
