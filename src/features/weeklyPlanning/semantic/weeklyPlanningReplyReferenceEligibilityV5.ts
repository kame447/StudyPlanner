import type { WeeklyPlanningQuestionContext } from '../intake/weeklyPlanningIntakeTypes';
import { createWeeklyPlanningEffortQuestionPlanV5, isWeeklyPlanningEffortMeasurementV5 } from './weeklyPlanningEffortQuestionPolicyV5';
import type { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import type { GenericSchedulerInputIssue } from './weeklyPlanningGenericSchedulerInput';
import { listWeeklyPlanningStableBlockingQuestionsV5 } from './weeklyPlanningStableDialoguePolicyV5';

export interface ReplyReferenceCompilationV5 {
  readonly graphRevision: number;
  readonly issues: readonly GenericSchedulerInputIssue[];
}

type Graph = ReturnType<typeof createWeeklyPlanningActiveSchedulerGraphViewV5>;
export interface ReplyReferenceOpenSlotV5 {
  readonly workload: Graph['workloads'][number];
  readonly slot: 'quantity' | 'quantity_role' | 'duration_per_unit' | 'total_duration' | 'session_duration';
  readonly questionCode: string;
  readonly estimateForWorkloadFactId: string | null;
  readonly questionBasis: string | null;
}

/** Supported open destinations come from the compiler, never inferred from user prose. */
export function listReplyReferenceOpenSlotsV5(params: {
  graph: Graph;
  compilation: ReplyReferenceCompilationV5;
  pending: WeeklyPlanningQuestionContext | null;
}): ReplyReferenceOpenSlotV5[] {
  const questions = listWeeklyPlanningStableBlockingQuestionsV5({
    status: 'needs_resolution', input: null, issues: [...params.compilation.issues],
  });
  return questions.flatMap(question => {
    const workloads = params.graph.workloads.filter(workload => workload.id === question.factId);
    if (workloads.length !== 1) return [];
    const workload = workloads[0];
    if (workload.quantityRole === 'scope_total') return [];
    const estimateForWorkloadFactId = typeof question.details.estimateForWorkloadFactId === 'string'
      ? question.details.estimateForWorkloadFactId : null;
    if (estimateForWorkloadFactId !== null) {
      const estimateTargets = params.graph.workloads.filter(item => item.id === estimateForWorkloadFactId
        && item.taskId === workload.taskId && item.componentId === workload.componentId
        && item.unitCode === workload.unitCode);
      if (estimateTargets.length !== 1) return [];
    }
    const pendingMatches = params.pending?.targetSlot === 'stable_v5:' + question.code
      && params.pending.topicId === question.factId
      && (params.pending.estimateForWorkloadFactId ?? null) === estimateForWorkloadFactId
      && (params.pending.questionBasis ?? null) === (question.details.questionBasis ?? null);
    let slot: ReplyReferenceOpenSlotV5['slot'];
    switch (question.code) {
      case 'missing_effort_estimate':
      case 'ambiguous_effort_estimate': {
        // Same typed measurement policy used by the ordinary question renderer.
        // The actual presented measurement wins; ambiguity without one abstains.
        const measurement = pendingMatches ? params.pending?.intent : question.effortMeasurement;
        if (isWeeklyPlanningEffortMeasurementV5(measurement)) slot = measurement;
        else if (question.code === 'missing_effort_estimate') slot = createWeeklyPlanningEffortQuestionPlanV5(workload).kind;
        else return [];
        break;
      }
      case 'quantity_role_unresolved': slot = 'quantity_role'; break;
      case 'non_integral_discrete_amount': slot = 'quantity'; break;
      default: return []; // Unsupported question kinds keep the whole-turn Luna path.
    }
    return [{ workload, slot, questionCode: question.code, estimateForWorkloadFactId,
      questionBasis: typeof question.details.questionBasis === 'string' ? question.details.questionBasis : null }];
  });
}
