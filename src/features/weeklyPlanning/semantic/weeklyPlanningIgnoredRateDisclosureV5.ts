import type { WeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { unitMismatchedPerUnitEstimates } from './weeklyPlanningGenericWorkEstimation';
import { workloadUnitDisplayV5 } from './weeklyPlanningWorkloadQuantityLabelV5';

/**
 * Typed fact: while the app asks for the rate of workload W (`missing_effort_estimate`), an ACCEPTED per-unit rate aimed at
 * W (or its task/component) was not usable only because its unit differs from W's (the same predicate the estimation uses).
 * The application states it once beside the question, quoting the user's own grounded words, so a rate the user gave is never
 * silently dropped and re-asked (live round 5 X2). Not raised for an effort that is ignored without causing a question.
 */
export interface IgnoredRateV5 {
  /** The user's own words of the rate (the effort fact's grounded source text). */
  quote: string;
  /** The counted unit of the workload the rate did not fit, from its typed unit. */
  unit: string;
}

export function ignoredRateForMissingEffortQuestionV5(params: {
  /** The ACTIVE graph view (the application's planning view). */
  view: Pick<WeeklyPlanningActiveSchedulerGraphViewV5, 'workloads' | 'effortEstimates'>;
  workloadFactId: string | null | undefined;
}): IgnoredRateV5 | null {
  if (!params.workloadFactId) return null;
  const view = params.view;
  const workload = view.workloads.find((fact) => fact.id === params.workloadFactId);
  if (!workload) return null;
  const mismatched = unitMismatchedPerUnitEstimates(workload, view.effortEstimates);
  if (mismatched.length === 0) return null;
  const unit = workloadUnitDisplayV5(workload.unitCode, workload.unitLabel);
  const quote = mismatched[0].source.sourceText?.trim();
  if (!unit || !quote) return null;
  return { quote, unit };
}
