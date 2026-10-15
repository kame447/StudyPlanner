import type { CandidateTuple } from '../application/candidateSelection';
import { focusedContextualTargetV5 } from './weeklyPlanningFocusedContextualAnswerV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';

export const NUMERIC_PENDING_SCOPE_LIMITS_V5 = { labelBytes: 512, unitLabelBytes: 128, maximumComponents: 8 } as const;
const bounded = (value: unknown, cap: number): value is string => typeof value === 'string'
  && value.trim().length > 0 && new TextEncoder().encode(value).length <= cap;

/** Full semantic scope from typed graph references; never reconstruct ancestry from presentation text. */
export function numericPendingCompleteScopeV5(input: WeeklyPlanningSemanticNormalizerInputV5): CandidateTuple | null {
  try {
    const target = focusedContextualTargetV5(input);
    const graph = input.committedGraph;
    if (!target || !graph || graph.revision !== target.graphRevision || !validateWeeklyPlanningFactGraphValueV5(graph).graph) return null;
    const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    const workload = graph.workloads.find(fact => fact.id === target.publicId);
    const task = graph.tasks.find(fact => fact.id === target.taskPublicId);
    if (!workload || !task || !active.has(workload.id) || !active.has(task.id)
      || workload.taskId !== task.id || workload.componentId !== (target.component?.publicId ?? null)
      || task.title !== target.taskTitle || task.category !== target.taskCategory
      || !bounded(task.title, NUMERIC_PENDING_SCOPE_LIMITS_V5.labelBytes)
      || !bounded(workload.unitLabel, NUMERIC_PENDING_SCOPE_LIMITS_V5.unitLabelBytes)) return null;
    const components = input.publicStateSummary?.components;
    const chain: CandidateTuple[] = []; const seen = new Set<string>();
    let id = workload.componentId;
    while (id !== null) {
      if (seen.has(id) || chain.length >= NUMERIC_PENDING_SCOPE_LIMITS_V5.maximumComponents || !Array.isArray(components)) return null;
      seen.add(id);
      const component = graph.components.find(fact => fact.id === id);
      const matches = components.filter(value => value && typeof value === 'object' && !Array.isArray(value) && value.publicId === id);
      if (!component || matches.length !== 1 || !active.has(component.id) || component.taskId !== task.id
        || !bounded(component.label, NUMERIC_PENDING_SCOPE_LIMITS_V5.labelBytes)) return null;
      const publicComponent = matches[0];
      if (publicComponent.taskPublicId !== component.taskId || publicComponent.parentComponentPublicId !== component.parentComponentId
        || publicComponent.role !== component.role || publicComponent.label !== component.label) return null;
      chain.unshift({ id: component.id, taskId: component.taskId, parentComponentId: component.parentComponentId,
        role: component.role, label: component.label });
      id = component.parentComponentId;
    }
    if (['amount', 'unitCode', 'unitLabel', 'quantityRole', 'rangeStart', 'rangeEnd', 'perOccurrence', 'periodExpression']
      .some(key => workload[key as keyof typeof workload] !== target[key as keyof typeof target])) return null;
    return { taskId: workload.taskId, componentId: workload.componentId, amount: workload.amount, unitCode: workload.unitCode,
      unitLabel: workload.unitLabel, quantityRole: workload.quantityRole, rangeStart: workload.rangeStart, rangeEnd: workload.rangeEnd,
      perOccurrence: workload.perOccurrence, periodExpression: workload.periodExpression,
      task: { category: task.category, title: task.title }, componentChain: chain,
      answerKind: 'one_explicit_exact_positive_integer_minute_value', convertedUnitsAllowed: false, approximateAllowed: false };
  } catch { return null; }
}
