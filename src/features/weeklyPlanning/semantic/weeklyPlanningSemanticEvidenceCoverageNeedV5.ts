import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { finalizeWeeklyPlanningSemanticCanonicalizationV5 } from './weeklyPlanningSemanticCommitV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { projectWeeklyPlanningStatedTimeBudgetGraphV5 } from './weeklyPlanningStatedTimeBudgetProjectionV5';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';

/**
 * Read-only question prediction using the existing canonical binding and
 * workload-cost owner. No graph is staged/committed, no dates are placed and
 * no text is interpreted. A formal-invalid candidate stays with its normal
 * failure owner instead of adding a semantic audit.
 */
export function hasWeeklyPlanningEvidenceCoverageMissingEffortV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  committedGraph?: WeeklyPlanningFactGraphV5;
}): boolean {
  const originalGraph = structuredClone(params.committedGraph ?? createEmptyWeeklyPlanningFactGraphV5());
  const base = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: originalGraph, document: params.document,
    context: { conversationId: 'coverage-question-prediction', turnId: 'projection', expectedRevision: originalGraph.revision },
  });
  if (base.status !== 'applied') return false;
  const result = finalizeWeeklyPlanningSemanticCanonicalizationV5({
    originalGraph, document: params.document, baseCanonicalization: base,
    contextualAnswer: false, questionCode: null, operationKeyPrefix: 'coverage-question-prediction:projection',
    conversationArchitecture: 'interaction_v1',
  }).canonicalization;
  if (result.status !== 'applied') return false;
  const graph = projectWeeklyPlanningStatedTimeBudgetGraphV5(createWeeklyPlanningActiveSchedulerGraphViewV5(result.graph));
  const compiled = compileGenericPlanningWorkItems(graph);
  const missingEffort = compiled.issues.some((issue) => issue.code === 'missing_effort_estimate'
    && compiled.items.some((item) => item.workloadFactId === issue.workloadFactId
      && (item.quantityRole === 'target' || item.quantityRole === 'remaining')));
  // Live C on 8c4ef790: the first document kept only the task, so the app would ask for the
  // work the user had just stated. A task created by this document with no schedulable item is
  // the same predicted re-ask as a missing effort.
  const existingTaskIds = new Set(createWeeklyPlanningActiveSchedulerGraphViewV5(originalGraph).tasks.map((task) => task.id));
  const missingWork = graph.tasks.some((task) => !existingTaskIds.has(task.id)
    && !compiled.items.some((item) => item.taskId === task.id));
  return missingEffort || missingWork;
}
