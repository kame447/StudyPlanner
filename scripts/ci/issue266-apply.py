from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


mutation_module = r'''import {
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
'''
Path('src/domain/recurringPlanMutation.ts').write_text(mutation_module)

replace_once(
    'src/repositories/repositoryContracts.ts',
    "} from '../types/domain';\n",
    "} from '../types/domain';\nimport type { RecurringPlanMutation } from '../domain/recurringPlanMutation';\n",
)
replace_once(
    'src/repositories/repositoryContracts.ts',
    "  getTimetablePeriods(userId: string): Promise<TimetablePeriod[]>;\n  upsertPlan(plan: Plan): Promise<Plan>;",
    "  getTimetablePeriods(userId: string): Promise<TimetablePeriod[]>;\n  applyRecurringPlanMutation(\n    userId: string,\n    mutation: RecurringPlanMutation,\n  ): Promise<void>;\n  upsertPlan(plan: Plan): Promise<Plan>;",
)

planner_path = Path('src/repositories/plannerRepository.ts')
planner_text = planner_path.read_text()
planner_text = planner_text.replace(
    "import type {\n  PlannerRepository,\n  PlannerStorageGateway,\n} from './repositoryContracts';",
    "import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';\nimport type { Actual, Plan } from '../types/domain';\nimport type {\n  PlannerRepository,\n  PlannerStorageGateway,\n} from './repositoryContracts';",
    1,
)
planner_helpers = r'''
function assertMutationOwner(userId: string, mutation: RecurringPlanMutation): void {
  const records = [
    ...mutation.planUpserts,
    ...mutation.planDeletes,
    ...mutation.actualUpserts,
    ...mutation.actualDeletes,
  ];

  if (records.some((record) => record.userId !== userId)) {
    throw new Error('Recurring plan mutation contains records owned by another user.');
  }
}

function applyPlanMutation(
  current: Plan[],
  mutation: RecurringPlanMutation,
): Plan[] {
  const deleteIds = new Set(mutation.planDeletes.map((plan) => plan.id));
  return mutation.planUpserts.reduce(
    (records, plan) => replaceById(records, plan),
    current.filter((plan) => !deleteIds.has(plan.id)),
  );
}

function applyActualMutation(
  current: Actual[],
  mutation: RecurringPlanMutation,
): Actual[] {
  const planDeleteIds = new Set(mutation.planDeletes.map((plan) => plan.id));
  const actualDeleteIds = new Set(mutation.actualDeletes.map((actual) => actual.id));
  const reboundIds = new Set(mutation.actualUpserts.map((actual) => actual.id));
  const remaining = current.filter(
    (actual) =>
      reboundIds.has(actual.id) ||
      (!actualDeleteIds.has(actual.id) &&
        (!actual.planId || !planDeleteIds.has(actual.planId))),
  );
  return mutation.actualUpserts.reduce(
    (records, actual) => upsertActualRecord(records, actual),
    remaining,
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

'''
factory_anchor = 'export function createPlannerRepository(\n'
if planner_text.count(factory_anchor) != 1:
    raise SystemExit('planner repository factory anchor mismatch')
planner_text = planner_text.replace(factory_anchor, planner_helpers + factory_anchor, 1)
planner_method = r'''    async applyRecurringPlanMutation(userId, mutation) {
      assertMutationOwner(userId, mutation);
      const hasPlanChanges =
        mutation.planUpserts.length > 0 || mutation.planDeletes.length > 0;
      const hasActualChanges =
        mutation.actualUpserts.length > 0 ||
        mutation.actualDeletes.length > 0 ||
        mutation.planDeletes.length > 0;

      if (!hasPlanChanges && !hasActualChanges) {
        return;
      }

      const previousPlans = await storageGateway.readPlans();
      const previousActuals = await storageGateway.readActuals();
      const nextPlans = applyPlanMutation(previousPlans, mutation);
      const nextActuals = applyActualMutation(previousActuals, mutation);
      let plansWritten = false;

      try {
        if (hasPlanChanges) {
          await storageGateway.writePlans(nextPlans);
          plansWritten = true;
        }
        if (hasActualChanges) {
          await storageGateway.writeActuals(nextActuals);
        }
      } catch (error) {
        if (plansWritten && hasActualChanges) {
          try {
            await storageGateway.writePlans(previousPlans);
          } catch (rollbackError) {
            throw new Error(
              `Recurring plan mutation failed (${errorText(error)}) and local rollback failed (${errorText(rollbackError)}).`,
            );
          }
        }
        throw error;
      }
    },
'''
upsert_anchor = '    async upsertPlan(plan) {\n'
if planner_text.count(upsert_anchor) != 1:
    raise SystemExit('planner upsert anchor mismatch')
planner_text = planner_text.replace(upsert_anchor, planner_method + upsert_anchor, 1)
planner_path.write_text(planner_text)

firebase_path = Path('src/repositories/firebasePlannerRepository.ts')
firebase_text = firebase_path.read_text()
firebase_text = firebase_text.replace(
    "import type { PlannerRepository } from './repositoryContracts';",
    "import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';\nimport type { PlannerRepository } from './repositoryContracts';",
    1,
)
firebase_helpers = r'''
function assertMutationOwner(userId: string, mutation: RecurringPlanMutation): void {
  const records = [
    ...mutation.planUpserts,
    ...mutation.planDeletes,
    ...mutation.actualUpserts,
    ...mutation.actualDeletes,
  ];

  if (records.some((record) => record.userId !== userId)) {
    throw new Error('Recurring plan mutation contains records owned by another user.');
  }
}

'''
factory_anchor = 'export function createFirebasePlannerRepository(\n'
if firebase_text.count(factory_anchor) != 1:
    raise SystemExit('firebase factory anchor mismatch')
firebase_text = firebase_text.replace(factory_anchor, firebase_helpers + factory_anchor, 1)
firebase_method = r'''    async applyRecurringPlanMutation(userId, mutation) {
      try {
        assertMutationOwner(userId, mutation);
        const reboundIds = new Set(
          mutation.actualUpserts.map((actual) => actual.id),
        );
        const linkedActuals = (
          await Promise.all(
            mutation.planDeletes.map((plan) =>
              listActualsByPlanId(firestoreDb, userId, plan.id),
            ),
          )
        ).flat();
        const actualDeletesById = new Map(
          [...mutation.actualDeletes, ...linkedActuals]
            .filter((actual) => !reboundIds.has(actual.id))
            .map((actual) => [actual.id, actual]),
        );
        const operationCount =
          mutation.planUpserts.length +
          mutation.planDeletes.length +
          mutation.actualUpserts.length +
          actualDeletesById.size;

        if (operationCount > 500) {
          throw new Error('Recurring plan mutation exceeds the Firestore batch limit.');
        }
        if (operationCount === 0) {
          return;
        }

        const batch = writeBatch(firestoreDb);
        mutation.planUpserts.forEach((plan) => {
          batch.set(
            doc(firestoreDb, 'plans', plan.id),
            stripUndefinedDeep(plan),
            { merge: true },
          );
        });
        mutation.planDeletes.forEach((plan) => {
          batch.delete(doc(firestoreDb, 'plans', plan.id));
        });
        mutation.actualUpserts.forEach((actual) => {
          batch.set(
            doc(firestoreDb, 'actuals', actual.id),
            stripUndefinedDeep(actual),
            { merge: true },
          );
        });
        actualDeletesById.forEach((actual) => {
          batch.delete(doc(firestoreDb, 'actuals', actual.id));
        });
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '繰り返し予定を保存できませんでした。',
            error as FirebaseLikeError,
          ),
        );
      }
    },
'''
upsert_anchor = '    async upsertPlan(plan) {\n'
if firebase_text.count(upsert_anchor) != 1:
    raise SystemExit('firebase upsert anchor mismatch')
firebase_text = firebase_text.replace(upsert_anchor, firebase_method + upsert_anchor, 1)
firebase_path.write_text(firebase_text)

observed_path = Path('src/repositories/observedPlannerRepository.ts')
observed_text = observed_path.read_text()
observed_method = r'''    async applyRecurringPlanMutation(userId, mutation) {
      await repository.applyRecurringPlanMutation(userId, mutation);
      mutation.planUpserts.forEach((plan) => {
        recordBestEffort(
          telemetry,
          isNewTimestampedRecord(plan) ? 'plan_created' : 'plan_updated',
        );
      });
      mutation.planDeletes.forEach(() => recordBestEffort(telemetry, 'plan_deleted'));
      mutation.actualUpserts.forEach(() => recordBestEffort(telemetry, 'actual_recorded'));
      mutation.actualDeletes.forEach(() => recordBestEffort(telemetry, 'actual_deleted'));
    },
'''
upsert_anchor = '    async upsertPlan(plan) {\n'
if observed_text.count(upsert_anchor) != 1:
    raise SystemExit('observed upsert anchor mismatch')
observed_text = observed_text.replace(upsert_anchor, observed_method + upsert_anchor, 1)
observed_path.write_text(observed_text)

hook_path = Path('src/hooks/usePlannerDataState.ts')
hook_text = hook_path.read_text()
old_import = """import {\n  applyRecurringPlanDeleteScope,\n  applyRecurringPlanEditScope,\n  applyRecurringPlanSeriesEdit,\n  supportsScopedRecurringPlanEdits,\n} from '../domain/recurringPlan';"""
new_import = """import { supportsScopedRecurringPlanEdits } from '../domain/recurringPlan';\nimport {\n  buildRecurringPlanDeleteMutation,\n  buildRecurringPlanEditMutation,\n} from '../domain/recurringPlanMutation';"""
if old_import not in hook_text:
    raise SystemExit('hook recurrence import anchor missing')
hook_text = hook_text.replace(old_import, new_import, 1)
summary_actual = """function summarizeActualForLog(actual: Actual) {\n  return {\n    id: actual.id,\n    userId: actual.userId,\n    planId: actual.planId,\n    occurrenceDate: actual.occurrenceDate,\n    title: actual.title,\n  };\n}\n\n"""
if summary_actual not in hook_text:
    raise SystemExit('hook Actual log helper anchor missing')
hook_text = hook_text.replace(summary_actual, '', 1)
start = hook_text.index('  async function confirmRecurringPlanScope(scope: RecurringPlanScope) {')
end = hook_text.index('  async function movePlanOccurrence(', start)
replacement = r'''  async function confirmRecurringPlanScope(scope: RecurringPlanScope) {
    if (!userId || !pendingRecurringPlanAction) {
      return;
    }

    const occurrencePlan = pendingRecurringPlanAction.plan;
    const sourcePlan = resolveStoredPlan(occurrencePlan);
    const occurrenceDate = occurrencePlan.occurrenceDate ?? occurrencePlan.date;

    try {
      const mutation =
        pendingRecurringPlanAction.kind === 'edit'
          ? pendingRecurringPlanAction.draft
            ? buildRecurringPlanEditMutation(
                plans,
                actuals,
                sourcePlan,
                occurrenceDate,
                pendingRecurringPlanAction.draft,
                scope,
              )
            : null
          : buildRecurringPlanDeleteMutation(
              plans,
              actuals,
              sourcePlan,
              occurrenceDate,
              scope,
            );

      if (!mutation) {
        return;
      }

      await plannerRepository.applyRecurringPlanMutation(userId, mutation);
      const deletedPlanIds = new Set(
        mutation.planDeletes.map((plan) => plan.id),
      );
      const deletedActualIds = new Set(
        mutation.actualDeletes.map((actual) => actual.id),
      );
      setPlans((current) =>
        sortAndUpsertPlans(
          current.filter((plan) => !deletedPlanIds.has(plan.id)),
          mutation.planUpserts,
        ),
      );
      setActuals((current) =>
        upsertActualsById(
          current.filter(
            (actual) =>
              !deletedActualIds.has(actual.id) &&
              (!actual.planId || !deletedPlanIds.has(actual.planId)),
          ),
          mutation.actualUpserts,
        ),
      );

      if (pendingRecurringPlanAction.kind === 'edit') {
        setSelectedDate(occurrenceDate);
        setMonthDate(startOfMonth(occurrenceDate));
      }
      setPendingRecurringPlanAction(null);
      closePlanEditor();
      if (pendingRecurringPlanAction.kind === 'edit') {
        showNotice('繰り返し予定を更新しました。', 'success');
      } else {
        showNotice('繰り返し予定を削除しました。');
      }
    } catch (error) {
      console.error('[RecurringPlanScope] failed', {
        action: pendingRecurringPlanAction.kind,
        scope,
        source:
          editingPlanId && editingPlanId === sourcePlan.id
            ? 'plan-editor'
            : 'plan-card',
        userId,
        sourcePlan: summarizePlanForLog(sourcePlan),
        error: getErrorDiagnostics(error),
      });
      await loadPlannerData(userId);
      showNotice(
        resolveErrorMessage(
          error,
          pendingRecurringPlanAction.kind === 'edit'
            ? '繰り返し予定の更新に失敗しました。'
            : '繰り返し予定の削除に失敗しました。',
        ),
        'error',
      );
    }
  }

'''
hook_text = hook_text[:start] + replacement + hook_text[end:]
hook_path.write_text(hook_text)


domain_test = r'''import { describe, expect, it } from 'vitest';
import type { Actual, Plan, PlanDraft, RecurrenceRule } from '../types/domain';
import {
  buildRecurringPlanDeleteMutation,
  buildRecurringPlanEditMutation,
} from './recurringPlanMutation';

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    id: 'rule-1',
    kind: 'daily',
    startDate: '2026-09-01',
    until: '2026-09-05',
    dates: [],
    weekdays: [],
    dayType: null,
    startTime: '09:00',
    endTime: '10:00',
    isOverride: false,
    ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: 'Math',
    subject: 'Math',
    date: '2026-09-01',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [rule()],
    type: 'study',
    memo: '',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    userId: 'user-1',
    title: 'Updated Math',
    subject: 'Math',
    date: '2026-09-03',
    startTime: '10:00',
    endTime: '11:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [rule()],
    type: 'study',
    memo: '',
    ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1',
    userId: 'user-1',
    planId: 'plan-1',
    occurrenceDate: '2026-09-01',
    actualStartTime: '09:00',
    actualEndTime: '10:00',
    title: 'Math',
    subject: 'Math',
    note: '',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('recurring plan mutation ownership', () => {
  it('derives a future split and Actual rebind from the same boundary', () => {
    const source = plan();
    const mutation = buildRecurringPlanEditMutation(
      [source],
      [
        actual({ id: 'past', occurrenceDate: '2026-09-02' }),
        actual({ id: 'boundary', occurrenceDate: '2026-09-03' }),
        actual({ id: 'future', occurrenceDate: '2026-09-05' }),
        actual({ id: 'wrong-user', userId: 'user-2', occurrenceDate: '2026-09-04' }),
      ],
      source,
      '2026-09-03',
      draft(),
      'future',
    );

    const created = mutation.planUpserts.find((item) => item.id !== source.id);
    expect(created).toBeDefined();
    expect(mutation.actualUpserts.map((item) => item.id)).toEqual(['boundary', 'future']);
    expect(mutation.actualUpserts.every((item) => item.planId === created?.id)).toBe(true);
  });

  it('moves first-occurrence Actuals while deleting the replaced source Plan', () => {
    const source = plan();
    const mutation = buildRecurringPlanEditMutation(
      [source],
      [actual({ id: 'first', occurrenceDate: '2026-09-01' })],
      source,
      '2026-09-01',
      draft({ date: '2026-09-01' }),
      'future',
    );

    expect(mutation.planDeletes.map((item) => item.id)).toEqual(['plan-1']);
    expect(mutation.actualUpserts).toHaveLength(1);
    expect(mutation.actualUpserts[0]?.planId).not.toBe('plan-1');
  });

  it('limits all-series edits to the source owner', () => {
    const source = plan();
    const sibling = plan({ id: 'plan-2' });
    const wrongOwner = plan({ id: 'wrong-owner', userId: 'user-2' });
    const unrelated = plan({ id: 'unrelated', seriesId: 'series-2' });
    const mutation = buildRecurringPlanEditMutation(
      [source, sibling, wrongOwner, unrelated],
      [],
      source,
      '2026-09-03',
      draft(),
      'all',
    );

    expect(mutation.planUpserts.map((item) => item.id).sort()).toEqual(['plan-1', 'plan-2']);
  });

  it('selects only the target occurrence Actual for a single delete', () => {
    const source = plan();
    const mutation = buildRecurringPlanDeleteMutation(
      [source],
      [
        actual({ id: 'target', occurrenceDate: '2026-09-03' }),
        actual({ id: 'other', occurrenceDate: '2026-09-04' }),
      ],
      source,
      '2026-09-03',
      'single',
    );

    expect(mutation.planUpserts).toHaveLength(1);
    expect(mutation.actualDeletes.map((item) => item.id)).toEqual(['target']);
  });

  it('uses the same boundary for future Plan truncation and Actual deletion', () => {
    const source = plan();
    const mutation = buildRecurringPlanDeleteMutation(
      [source],
      [
        actual({ id: 'past', occurrenceDate: '2026-09-02' }),
        actual({ id: 'boundary', occurrenceDate: '2026-09-03' }),
        actual({ id: 'future', occurrenceDate: '2026-09-05' }),
      ],
      source,
      '2026-09-03',
      'future',
    );

    expect(mutation.planUpserts).toHaveLength(1);
    expect(mutation.actualDeletes.map((item) => item.id)).toEqual(['boundary', 'future']);
  });

  it('selects only owned Plans for all-series deletion', () => {
    const source = plan();
    const sibling = plan({ id: 'plan-2' });
    const wrongOwner = plan({ id: 'wrong-owner-plan', userId: 'user-2' });
    const unrelated = plan({ id: 'unrelated', seriesId: 'series-2' });
    const mutation = buildRecurringPlanDeleteMutation(
      [source, sibling, wrongOwner, unrelated],
      [],
      source,
      '2026-09-03',
      'all',
    );

    expect(mutation.planDeletes.map((item) => item.id).sort()).toEqual(['plan-1', 'plan-2']);
  });
});
'''
Path('src/domain/recurringPlanMutation.test.ts').write_text(domain_test)


repository_test = r'''import { describe, expect, it } from 'vitest';
import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
import type {
  Actual,
  DayNote,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  StudyMaterial,
  StudySubject,
  TimetablePeriod,
  TimetableTerm,
  TodoTask,
} from '../types/domain';
import { createPlannerRepository } from './plannerRepository';
import type { PlannerStorageGateway } from './repositoryContracts';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1', seriesId: 'series-1', userId: 'user-1', title: 'Math', subject: 'Math',
    date: '2026-09-01', startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1', userId: 'user-1', planId: 'plan-1', occurrenceDate: '2026-09-01',
    actualStartTime: '09:00', actualEndTime: '10:00', subject: 'Math', note: '',
    updatedAt: '2026-09-01T10:00:00.000Z', ...overrides,
  };
}

function mutation(overrides: Partial<RecurringPlanMutation> = {}): RecurringPlanMutation {
  return { planUpserts: [], planDeletes: [], actualUpserts: [], actualDeletes: [], ...overrides };
}

function createGateway(seed: { plans?: Plan[]; actuals?: Actual[]; failActualWrite?: boolean }) {
  const state = {
    plans: [...(seed.plans ?? [])], actuals: [...(seed.actuals ?? [])], dayNotes: [] as DayNote[],
    monthEvents: [] as MonthEvent[], todos: [] as TodoTask[], studySubjects: [] as StudySubject[],
    studyMaterials: [] as StudyMaterial[], scheduleTemplates: [] as ScheduleTemplate[],
    timetableTerms: [] as TimetableTerm[], timetablePeriods: [] as TimetablePeriod[],
  };
  let failActualWrite = seed.failActualWrite ?? false;
  const gateway: PlannerStorageGateway = {
    async readPlans() { return state.plans; },
    async writePlans(items) { state.plans = [...items]; },
    async readActuals() { return state.actuals; },
    async writeActuals(items) {
      if (failActualWrite) { failActualWrite = false; throw new Error('actual write failed'); }
      state.actuals = [...items];
    },
    async readDayNotes() { return state.dayNotes; }, async writeDayNotes(items) { state.dayNotes = [...items]; },
    async readMonthEvents() { return state.monthEvents; }, async writeMonthEvents(items) { state.monthEvents = [...items]; },
    async readTodos() { return state.todos; }, async writeTodos(items) { state.todos = [...await items]; },
    async readStudySubjects() { return state.studySubjects; }, async writeStudySubjects(items) { state.studySubjects = [...await items]; },
    async readStudyMaterials() { return state.studyMaterials; }, async writeStudyMaterials(items) { state.studyMaterials = [...await items]; },
    async readScheduleTemplates() { return state.scheduleTemplates; }, async writeScheduleTemplates(items) { state.scheduleTemplates = [...await items]; },
    async readTimetableTerms() { return state.timetableTerms; }, async writeTimetableTerms(items) { state.timetableTerms = [...await items]; },
    async readTimetablePeriods() { return state.timetablePeriods; }, async writeTimetablePeriods(items) { state.timetablePeriods = [...await items]; },
  };
  return { state, gateway };
}

describe('planner repository recurring mutation boundary', () => {
  it('applies Plan and Actual changes through one repository operation', async () => {
    const source = plan();
    const linked = actual();
    const { state, gateway } = createGateway({ plans: [source], actuals: [linked] });
    const repository = createPlannerRepository(gateway);
    await repository.applyRecurringPlanMutation('user-1', mutation({
      planUpserts: [plan({ title: 'Updated' })],
      actualUpserts: [actual({ planId: 'plan-2' })],
    }));
    expect(state.plans[0]?.title).toBe('Updated');
    expect(state.actuals[0]?.planId).toBe('plan-2');
  });

  it('rolls Plan storage back when the following Actual write fails', async () => {
    const source = plan();
    const linked = actual();
    const { state, gateway } = createGateway({ plans: [source], actuals: [linked], failActualWrite: true });
    const repository = createPlannerRepository(gateway);
    await expect(repository.applyRecurringPlanMutation('user-1', mutation({
      planUpserts: [plan({ title: 'Should rollback' })], actualDeletes: [linked],
    }))).rejects.toThrow('actual write failed');
    expect(state.plans).toEqual([source]);
    expect(state.actuals).toEqual([linked]);
  });

  it('cascades a Plan delete to every raw linked Actual, including duplicates', async () => {
    const source = plan();
    const duplicateA = actual({ id: 'a1' });
    const duplicateB = actual({ id: 'a2' });
    const unrelated = actual({ id: 'other', planId: 'other-plan' });
    const { state, gateway } = createGateway({ plans: [source], actuals: [duplicateA, duplicateB, unrelated] });
    const repository = createPlannerRepository(gateway);
    await repository.applyRecurringPlanMutation('user-1', mutation({ planDeletes: [source] }));
    expect(state.plans).toEqual([]);
    expect(state.actuals).toEqual([unrelated]);
  });

  it('preserves a rebound Actual when its old Plan is deleted in the same mutation', async () => {
    const source = plan();
    const linked = actual();
    const rebound = actual({ planId: 'replacement-plan' });
    const { state, gateway } = createGateway({ plans: [source], actuals: [linked] });
    const repository = createPlannerRepository(gateway);
    await repository.applyRecurringPlanMutation('user-1', mutation({
      planDeletes: [source], actualUpserts: [rebound],
    }));
    expect(state.actuals).toEqual([rebound]);
  });

  it('rejects any cross-owner mutation before writing', async () => {
    const source = plan();
    const linked = actual();
    const { state, gateway } = createGateway({ plans: [source], actuals: [linked] });
    const repository = createPlannerRepository(gateway);
    await expect(repository.applyRecurringPlanMutation('user-1', mutation({
      planDeletes: [plan({ id: 'foreign', userId: 'user-2' })],
    }))).rejects.toThrow('another user');
    expect(state.plans).toEqual([source]);
    expect(state.actuals).toEqual([linked]);
  });
});
'''
Path('src/repositories/recurringPlanMutationRepository.test.ts').write_text(repository_test)


firebase_test = r'''import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Actual, Plan } from '../types/domain';

const mocks = vi.hoisted(() => ({
  batchSet: vi.fn(),
  batchDelete: vi.fn(),
  batchCommit: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  deleteField: vi.fn(() => Symbol('deleteField')),
  deleteDoc: vi.fn(),
  doc: vi.fn((_db, collectionName, id) => ({ collectionName, id })),
  getDocs: mocks.getDocs,
  query: vi.fn((...parts) => ({ parts })),
  setDoc: vi.fn(),
  where: vi.fn((...parts) => ({ parts })),
  writeBatch: mocks.writeBatch,
}));

import { createFirebasePlannerRepository } from './firebasePlannerRepository';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1', seriesId: 'series-1', userId: 'user-1', title: 'Math', subject: 'Math',
    date: '2026-09-01', startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1', userId: 'user-1', planId: 'plan-1', occurrenceDate: '2026-09-01',
    actualStartTime: '09:00', actualEndTime: '10:00', subject: 'Math', note: '',
    updatedAt: '2026-09-01T10:00:00.000Z', ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDocs.mockResolvedValue({ docs: [] });
  mocks.writeBatch.mockReturnValue({
    set: mocks.batchSet,
    delete: mocks.batchDelete,
    commit: mocks.batchCommit,
  });
  mocks.batchCommit.mockResolvedValue(undefined);
});

describe('Firebase recurring mutation boundary', () => {
  it('queues Plan and Actual writes in one Firestore batch commit', async () => {
    const repository = createFirebasePlannerRepository({} as Firestore);
    await repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [plan({ id: 'replacement' })],
      planDeletes: [],
      actualUpserts: [actual({ planId: 'replacement' })],
      actualDeletes: [],
    });
    expect(mocks.writeBatch).toHaveBeenCalledTimes(1);
    expect(mocks.batchSet).toHaveBeenCalledTimes(2);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('keeps a rebound Actual out of the old Plan cascade delete', async () => {
    const linked = actual();
    mocks.getDocs.mockResolvedValue({
      docs: [{ id: linked.id, data: () => ({ ...linked }) }],
    });
    const repository = createFirebasePlannerRepository({} as Firestore);
    await repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [],
      planDeletes: [plan()],
      actualUpserts: [actual({ planId: 'replacement' })],
      actualDeletes: [],
    });
    expect(mocks.batchDelete).toHaveBeenCalledTimes(1);
    expect(mocks.batchSet).toHaveBeenCalledTimes(1);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-owner records before creating a batch', async () => {
    const repository = createFirebasePlannerRepository({} as Firestore);
    await expect(repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [],
      planDeletes: [plan({ userId: 'user-2' })],
      actualUpserts: [],
      actualDeletes: [],
    })).rejects.toThrow('another user');
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });
});
'''
Path('src/repositories/firebasePlannerRepository.recurringMutation.test.ts').write_text(firebase_test)
