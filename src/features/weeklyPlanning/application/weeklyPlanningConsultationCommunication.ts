import type { WeeklyPlanningConsultationAlternativeEvidence } from './weeklyPlanningConsultationAlternativeEvaluation';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { executeWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewExecution';

/** Read-only answer evidence. Neither advice nor a hypothetical preference becomes a fact. */
export interface WeeklyPlanningConsultationCommunication {
  mode: 'advisory_only';
  /** Separates accepted-plan results from an explicitly tested, unadopted day alternative. */
  assessmentScope: 'accepted_plan_only' | 'proposed_days';
  alternative?: WeeklyPlanningConsultationAlternativeEvidence['alternative'];
  feasibility:
    | WeeklyPlanningConsultationAlternativeEvidence['feasibility']
    | { status: 'fits' | 'does_not_fit'; basis: 'current_turn_scheduler' }
    | {
        status: 'not_evaluated';
        reason: 'planning_details_missing' | 'preview_required' | 'existing_preview_not_rechecked' | 'no_schedulable_work';
      };
  missingQuestionCodes: string[];
  workEstimates: Array<{ taskId: string; minutes: number | null }>;
  /** Upper limits, not measured free time. Do not subtract work to invent available slots. */
  dailyLimits: Array<{ date: string; maxMinutes: number }>;
  nextAction: 'clarify_planning_details' | 'offer_preview' | 'offer_preference_change' | 'review_preview' | 'offer_alternative_adoption';
}

/** Projects existing deterministic results; does not run the scheduler or mutate its input. */
export function consultationCommunicationForPlanning(params: {
  compilation: GenericSchedulerInputCompilationResult;
  preview?: Pick<ReturnType<typeof executeWeeklyPlanningStableV5Preview>, 'status'> | null;
  preserveExistingPreview: boolean;
  alternativeEvidence?: WeeklyPlanningConsultationAlternativeEvidence | null;
}): WeeklyPlanningConsultationCommunication {
  const { compilation, preview } = params;
  const missingQuestionCodes = [...new Set(compilation.issues
    .filter((issue) => issue.blocking).map((issue) => issue.code))];
  const feasibility: WeeklyPlanningConsultationCommunication['feasibility'] =
    // A kept preview is not evidence about a hypothetical change or even a fresh placement run.
    params.alternativeEvidence?.feasibility ?? (params.preserveExistingPreview
      ? { status: 'not_evaluated', reason: 'existing_preview_not_rechecked' }
      : preview?.status === 'ready'
        ? { status: 'fits', basis: 'current_turn_scheduler' }
        : preview?.status === 'insufficient_capacity'
          ? { status: 'does_not_fit', basis: 'current_turn_scheduler' }
          : {
              status: 'not_evaluated',
              reason: compilation.status === 'needs_resolution'
                ? 'planning_details_missing'
                : compilation.status === 'empty' || preview?.status === 'empty'
                  ? 'no_schedulable_work'
                  : 'preview_required',
            });
  return {
    mode: 'advisory_only',
    assessmentScope: params.alternativeEvidence ? 'proposed_days' : 'accepted_plan_only',
    ...(params.alternativeEvidence?.alternative ? { alternative: params.alternativeEvidence.alternative } : {}),
    feasibility,
    missingQuestionCodes,
    workEstimates: (compilation.input?.movableWorkItems ?? []).map((item) => ({
      taskId: item.taskId, minutes: item.estimatedMinutes,
    })),
    dailyLimits: (compilation.input?.dailyCapacityLimits ?? []).map(({ date, maxMinutes }) => ({ date, maxMinutes })),
    nextAction: feasibility.status !== 'not_evaluated'
      ? feasibility.status === 'fits' ? params.alternativeEvidence ? 'offer_alternative_adoption' : 'review_preview' : 'offer_preference_change'
      : feasibility.reason === 'existing_preview_not_rechecked'
        ? 'offer_preference_change'
        : feasibility.reason === 'preview_required' ? 'offer_preview' : 'clarify_planning_details',
  };
}

/** Dates are evidence for presentation only when this turn actually tested the alternative. */
export function evaluatedWeeklyPlanningConsultationDates(
  consultation: WeeklyPlanningConsultationCommunication | null | undefined,
): readonly string[] {
  return consultation?.assessmentScope === 'proposed_days' && consultation.feasibility.status !== 'not_evaluated'
    && consultation.feasibility.basis === 'alternative_scheduler'
    ? consultation.alternative?.dates ?? [] : [];
}
