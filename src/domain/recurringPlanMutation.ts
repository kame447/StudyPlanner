import {
  applyRecurringPlanDeleteScope,
  applyRecurringPlanEditScope,
  applyRecurringPlanSeriesEdit,
} from './recurringPlan';
import type {
  Actual,
  Plan,
  PlanDraft,
  RecurringPlanScope,
} from '../types/domain';

export interface RecurringPlanMutation {
  planUpserts: Plan[];
  planDeletes: Plan[];
  actualUpserts: Actual[];
  actualDeletes: Actual[];
}

function emptyMutation(): RecurringPlanMutation {
  return {
    planUpserts: [],
    planDeletes: [],
    actualUpserts: [],
    actualDeletes: [],
  };
}

function seriesIdOf(plan: Plan): string {
  return plan.seriesId || plan.id;
}

function ownedSeriesPlans(plans: Plan[], sourcePlan: Plan): Plan[] {
  const seriesId = seriesIdOf(sourcePlan);
  return plans.filter(
    (plan) =>
      plan.userId === sourcePlan.userId &&
      seriesIdOf(plan) === seriesId,
  );
}

function ownedLinkedActuals(
  actuals: Actual[],
  sourcePlan: Plan,
): Actual[] {
  return actuals.filter(
    (actual) =>
      actual.userId === sourcePlan.userId && actual.planId === sourcePlan.id,
  );
}

function assertDraftOwner(sourcePlan: Plan, draft: PlanDraft): void {
  if (sourcePlan.userId !== draft.userId) {
    throw new Error('Recurring plan edit owner does not match the source plan.');
  }
}

export function buildRecurringPlanEditMutation(
  plans: Plan[],
  actuals: Actual[],
  sourcePlan: Plan,
  occurrenceDate: string,
  draft: PlanDraft,
  scope: RecurringPlanScope,
): RecurringPlanMutation {
  assertDraftOwner(sourcePlan, draft);

  if (scope === 'all') {
    return {
      ...emptyMutation(),
      planUpserts: ownedSeriesPlans(plans, sourcePlan).map((plan) =>
        applyRecurringPlanSeriesEdit(plan, draft),
      ),
    };
  }

  const result = applyRecurringPlanEditScope(
    sourcePlan,
    occurrenceDate,
    draft,
    scope,
  );
  const mutation = emptyMutation();

  if (result.updatedPlan) {
    mutation.planUpserts.push(result.updatedPlan);
  } else {
    mutation.planDeletes.push(sourcePlan);
  }

  if (result.createdPlan) {
    mutation.planUpserts.push(result.createdPlan);
  }

  if (scope === 'future' && result.createdPlan) {
    mutation.actualUpserts = ownedLinkedActuals(actuals, sourcePlan)
      .filter(
        (actual) => actual.occurrenceDate.localeCompare(occurrenceDate) >= 0,
      )
      .map((actual) => ({
        ...actual,
        planId: result.createdPlan?.id ?? actual.planId,
      }));
  }

  return mutation;
}

export function buildRecurringPlanDeleteMutation(
  plans: Plan[],
  actuals: Actual[],
  sourcePlan: Plan,
  occurrenceDate: string,
  scope: RecurringPlanScope,
): RecurringPlanMutation {
  if (scope === 'all') {
    return {
      ...emptyMutation(),
      planDeletes: ownedSeriesPlans(plans, sourcePlan),
    };
  }

  const nextPlan = applyRecurringPlanDeleteScope(
    sourcePlan,
    occurrenceDate,
    scope,
  );
  const mutation = emptyMutation();

  if (!nextPlan) {
    mutation.planDeletes.push(sourcePlan);
    return mutation;
  }

  mutation.planUpserts.push(nextPlan);
  mutation.actualDeletes = ownedLinkedActuals(actuals, sourcePlan).filter(
    (actual) =>
      scope === 'single'
        ? actual.occurrenceDate === occurrenceDate
        : actual.occurrenceDate.localeCompare(occurrenceDate) >= 0,
  );
  return mutation;
}
