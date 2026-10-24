import { todayIsoDate } from '../lib/date';
import type { Actual, MonthEvent, Plan } from '../types/domain';
import type { PlannerRepository } from './repositoryContracts';
import { studyHistoryFingerprint, type StudyHistoryHint } from './studyStreakRepository';

type Metadata = { fromCache?: boolean; hasPendingWrites?: boolean } | undefined;
type Slice = 'plans' | 'actuals' | 'monthEvents';

// Evidence for reads that the planner already performs, never another data store.
// Only the full owner queries publish here, after their normal normalization.
export function createConfirmedStudyHistory(clock = todayIsoDate) {
  let owner: string | null = null;
  let generation = 0;
  let mutationEpoch = 0;
  let mutations = 0;
  let marker = false;
  let plans: Plan[] | null = null;
  let actuals: Actual[] | null = null;
  let monthEvents: MonthEvent[] | null = null;
  const sequence = { plans: 0, actuals: 0, monthEvents: 0 };
  const confirmedDay = { plans: '', actuals: '', monthEvents: '' };
  function invalidate(userId: string) {
    if (owner !== userId) marker = false;
    owner = userId;
    generation += 1;
    mutationEpoch += 1;
    plans = null;
    actuals = null;
    monthEvents = null;
  }
  function select(userId: string) {
    if (owner !== userId) { invalidate(userId); marker = false; }
  }
  return {
    get generation() { return generation; },
    get writing() { return mutations > 0; },
    beginMigration(userId: string) { select(userId); marker = false; generation += 1; },
    confirmMigration(userId: string) { select(userId); marker = true; },
    beginRead(userId: string, slice: Slice) {
      select(userId);
      const epoch = mutationEpoch;
      const current = ++sequence[slice];
      generation += 1;
      if (slice === 'plans') plans = null;
      else if (slice === 'actuals') actuals = null;
      else monthEvents = null;
      return (rows: Plan[] | Actual[] | MonthEvent[], metadata: Metadata) => {
        if (owner !== userId || epoch !== mutationEpoch || current !== sequence[slice] || mutations > 0
          || metadata?.fromCache !== false || metadata.hasPendingWrites !== false
          || rows.some(row => row.userId !== userId)) return;
        if (slice === 'plans') plans = rows as Plan[];
        else if (slice === 'actuals') actuals = rows as Actual[];
        else monthEvents = rows as MonthEvent[];
        confirmedDay[slice] = clock();
      };
    },
    read(userId: string, hint: StudyHistoryHint, today: string) {
      if (owner !== userId || mutations > 0 || !marker || !plans || !actuals || !monthEvents
        || confirmedDay.plans !== today || confirmedDay.actuals !== today || confirmedDay.monthEvents !== today) return null;
      const history = { userId, plans, actuals, monthEvents, historyComplete: true as const };
      return studyHistoryFingerprint(history) === studyHistoryFingerprint(hint) ? history : null;
    },
    async duringMutation<T>(userId: string, work: () => Promise<T>): Promise<T> {
      invalidate(userId);
      mutations += 1;
      try { return await work(); }
      finally { mutations -= 1; invalidate(userId); }
    },
  };
}

export type ConfirmedStudyHistory = ReturnType<typeof createConfirmedStudyHistory>;

// A read made before/during a write cannot authorize a later automatic spend,
// even when the app has not yet published its replacement arrays.
export function invalidateStudyHistoryOnWrites(repository: PlannerRepository, receipt: ConfirmedStudyHistory): PlannerRepository {
  const write = receipt.duringMutation;
  return {
    ...repository,
    upsertPlan: plan => write(plan.userId, () => repository.upsertPlan(plan)),
    deletePlan: (owner, id) => write(owner, () => repository.deletePlan(owner, id)),
    upsertActual: actual => write(actual.userId, () => repository.upsertActual(actual)),
    upsertMonthEvent: event => write(event.userId, () => repository.upsertMonthEvent(event)),
    deleteMonthEvent: (owner, id) => write(owner, () => repository.deleteMonthEvent(owner, id)),
    applyRecurringMonthEventMutation: (owner, events) => write(owner, () => repository.applyRecurringMonthEventMutation(owner, events)),
    deleteActual: (owner, id) => write(owner, () => repository.deleteActual(owner, id)),
    upsertActualWithMaterialProgress: mutation => write(mutation.actual.userId, () => repository.upsertActualWithMaterialProgress(mutation)),
    applyRecurringPlanMutation: (owner, mutation) => write(owner, () => repository.applyRecurringPlanMutation(owner, mutation)),
    deletePlanWithDependents: mutation => write(mutation.userId, () => repository.deletePlanWithDependents(mutation)),
    restorePlanWithDependents: mutation => write(mutation.plan.userId, () => repository.restorePlanWithDependents(mutation)),
    scheduleTodoPlan: mutation => write(mutation.plan.userId, () => repository.scheduleTodoPlan(mutation)),
  };
}
