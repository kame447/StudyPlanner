import { createEmptyWeeklyPlanningFactGraphV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningFactGraphV5';
import type { SemanticComponentRoleV5, SemanticQuantityRoleV5, SemanticWorkloadUnitCodeV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticTypesV5';
import { validateWeeklyPlanningFactGraphValueV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningFactGraphValidatorV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPublicStateV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerContractsV5';

interface ContextualPairedCase {
  id: string; userText: string; taskTitle: string; questionCode: string;
  targetAmount: number; unitCode: SemanticWorkloadUnitCodeV5; unitLabel: string;
  progressBasis?: boolean; targetQuantityRole?: SemanticQuantityRoleV5;
  componentChain?: Array<{ role: SemanticComponentRoleV5; label: string }>;
  rangeStart?: string | null; rangeEnd?: string | null;
  perOccurrence?: boolean; periodExpression?: string | null;
}

/** Materialize declared corpus values only; absent/invalid target remains Luna-owned. */
export function createContextualPairedInput(item: ContextualPairedCase, arm: string): WeeklyPlanningSemanticNormalizerInputV5 {
  const base = { userText: item.userText, traceRequestId: 'ctx-paired-' + item.id + '-' + arm };
  const graph = createEmptyWeeklyPlanningFactGraphV5(); graph.revision = 31;
  const source = { conversationId: 'contextual-synthetic-evaluation', turnId: item.id,
    semanticLocalId: 'declared-target', sourceText: item.userText, origin: 'user' as const };
  graph.tasks.push({ id: 'task-synthetic', category: 'study', title: item.taskTitle, source, createdRevision: 31 });
  const chain = item.componentChain ?? [];
  for (const [index, component] of chain.entries()) graph.components.push({
    id: 'component-' + index, taskId: 'task-synthetic', parentComponentId: index === 0 ? null : 'component-' + (index - 1),
    role: component.role, label: component.label, source, createdRevision: 31,
  });
  const progress = item.progressBasis === true;
  graph.workloads.push({ id: 'workload-question', taskId: 'task-synthetic',
    componentId: chain.length ? 'component-' + (chain.length - 1) : null,
    quantityRole: item.targetQuantityRole ?? (progress ? 'completed' : 'unknown'),
    amount: item.targetAmount, unitCode: item.unitCode, unitLabel: item.unitLabel,
    rangeStart: item.rangeStart ?? null, rangeEnd: item.rangeEnd ?? null,
    perOccurrence: item.perOccurrence ?? false, periodExpression: item.periodExpression ?? null,
    source, createdRevision: 31 });
  if (progress) graph.workloads.push({ ...graph.workloads[0], id: 'workload-estimate', quantityRole: 'remaining',
    amount: 5, rangeStart: null, rangeEnd: null });
  graph.factLifecycles = [...graph.tasks, ...graph.components, ...graph.workloads].map(fact => ({
    factId: fact.id, status: 'active', createdRevision: 31, terminalRevision: null, supersededByFactId: null,
  }));
  const validated = validateWeeklyPlanningFactGraphValueV5(graph);
  if (!validated.graph) return base;
  const publicStateSummary = createWeeklyPlanningSemanticPublicStateSummaryV5({ pendingQuestion: {
    actionId: null, questionCode: item.questionCode, targetFactId: 'workload-question', graphRevision: 31,
    effortMeasurement: item.questionCode === 'missing_effort_estimate' ? 'total_duration' : null,
    estimateForWorkloadFactId: progress ? 'workload-estimate' : null,
    questionBasis: progress ? 'completed_workload_total' : null,
  } }, validated.graph);
  return { ...base, committedGraph: validated.graph, publicStateSummary };
}
