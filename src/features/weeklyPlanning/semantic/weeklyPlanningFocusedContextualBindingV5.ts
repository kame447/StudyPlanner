import type { BoundFocusedContextualDecisionContext } from '../../../../shared/focusedContextualDecision';
import { isFocusedContextualDecisionContext } from '../../../../shared/focusedContextualDecision';
import { FOCUSED_CONTEXTUAL_BINDING_LIMITS, snapshotFocusedContextualTargetBinding, type FocusedContextualTargetBinding } from '../../../../shared/focusedContextualTargetBinding';
import { focusedContextualTargetV5 } from './weeklyPlanningFocusedContextualAnswerV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';

export interface FocusedContextualBindingSnapshotV5 {
  context: BoundFocusedContextualDecisionContext;
  /** Canonical IDs/presentation stay local and never enter provider/trace payloads. */
  localBinding: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function unique(values: unknown, id: string): Record<string, unknown> | null {
  if (!Array.isArray(values)) return null;
  const matches = values.filter(value => record(value) && value.publicId === id);
  return matches.length === 1 ? matches[0] : null;
}

/** Uses validated typed references, never renderer text or lexical target inference. */
export function createFocusedContextualBindingSnapshotV5(
  input: WeeklyPlanningSemanticNormalizerInputV5,
): FocusedContextualBindingSnapshotV5 | null {
  const target = focusedContextualTargetV5(input);
  const summary = input.publicStateSummary;
  if (!target || !summary || !record(summary.pendingQuestion)
    || summary.graphRevision !== target.graphRevision) return null;
  const workload = unique(summary.workloads, target.publicId);
  const task = unique(summary.tasks, target.taskPublicId);
  if (!workload || !task) return null;
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let id = target.component?.publicId ?? null;
  while (id !== null) {
    if (seen.has(id) || chain.length >= FOCUSED_CONTEXTUAL_BINDING_LIMITS.maximumComponents) return null;
    seen.add(id);
    const component = unique(summary.components, id);
    if (!component || component.taskPublicId !== target.taskPublicId
      || !(component.parentComponentPublicId === null || typeof component.parentComponentPublicId === 'string')) return null;
    chain.unshift(component);
    id = component.parentComponentPublicId;
  }
  if (input.committedGraph) {
    const graph = input.committedGraph;
    if (graph.revision !== target.graphRevision) return null;
    const isActive = (factId: string) => {
      const matches = graph.factLifecycles.filter(entry => entry.factId === factId);
      return matches.length === 1 && matches[0].status === 'active';
    };
    const boundWorkloads = graph.workloads.filter(fact => fact.id === target.publicId);
    const boundTasks = graph.tasks.filter(fact => fact.id === target.taskPublicId);
    if (boundWorkloads.length !== 1 || boundTasks.length !== 1 || !isActive(target.publicId)
      || !isActive(target.taskPublicId)) return null;
    const fact = boundWorkloads[0];
    if (fact.taskId !== target.taskPublicId || fact.componentId !== (target.component?.publicId ?? null)
      || boundTasks[0].title !== target.taskTitle || boundTasks[0].category !== target.taskCategory
      || ['quantityRole', 'amount', 'unitCode', 'unitLabel', 'rangeStart', 'rangeEnd', 'perOccurrence', 'periodExpression']
        .some(key => fact[key as keyof typeof fact] !== workload[key])) return null;
    for (const component of chain) {
      const matches = graph.components.filter(fact => fact.id === component.publicId);
      if (matches.length !== 1 || typeof component.publicId !== 'string' || !isActive(component.publicId)) return null;
      const fact = matches[0];
      if (fact.taskId !== target.taskPublicId || fact.parentComponentId !== component.parentComponentPublicId
        || fact.role !== component.role || fact.label !== component.label) return null;
    }
  }
  const binding: FocusedContextualTargetBinding = {
    sourceRevision: target.graphRevision,
    // One known slot in this request. Formal graph identity stays in localBinding.
    targetToken: 'question-target',
    questionCode: target.questionCode,
    task: { category: target.taskCategory, title: target.taskTitle },
    componentChain: chain.map(component => ({
      role: component.role as FocusedContextualTargetBinding['componentChain'][number]['role'],
      label: component.label as string,
    })),
    workload: {
      quantityRole: target.quantityRole, amount: target.amount, unitCode: target.unitCode,
      unitLabel: target.unitLabel, rangeStart: target.rangeStart, rangeEnd: target.rangeEnd,
      perOccurrence: target.perOccurrence, periodExpression: target.periodExpression,
    },
  };
  const context = {
    purpose: 'focused_contextual_answer_v2' as const,
    requestId: input.traceRequestId,
    inputRevision: target.graphRevision,
    targetToken: binding.targetToken,
    questionCode: target.questionCode,
    state: {
      currentUserText: input.userText,
      pendingQuestion: {
        targetQuantityRole: target.quantityRole, questionBasis: target.questionBasis,
        hasEstimateTarget: target.estimateForWorkload !== null, target: binding,
      },
    },
  };
  if (!isFocusedContextualDecisionContext(context) || context.purpose !== 'focused_contextual_answer_v2') return null;
  return {
    context: Object.freeze({ ...context, state: Object.freeze({
      ...context.state, pendingQuestion: Object.freeze({
        ...context.state.pendingQuestion, target: snapshotFocusedContextualTargetBinding(binding),
      }),
    }) }),
    localBinding: JSON.stringify({
      workloadId: target.publicId, taskId: target.taskPublicId,
      componentIds: chain.map(component => component.publicId), pending: summary.pendingQuestion,
      inputRevision: target.graphRevision, requestId: input.traceRequestId, binding,
    }),
  };
}

export function isFocusedContextualBindingCurrentV5(
  snapshot: FocusedContextualBindingSnapshotV5,
  input: WeeklyPlanningSemanticNormalizerInputV5,
): boolean {
  return createFocusedContextualBindingSnapshotV5(input)?.localBinding === snapshot.localBinding;
}
