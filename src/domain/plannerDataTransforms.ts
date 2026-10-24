import { upsertByKey } from '../lib/collections';
import { sortByDateTime } from '../lib/date';
import { getActualOccurrenceKey } from '../lib/planRecurrence';
import type { RecurringPlanMutation } from './recurringPlanMutation';
import type {
  Actual,
  Plan,
  ScheduleTemplate,
  StudyMaterial,
  TimetablePeriod,
  TimetableTerm,
} from '../types/domain';
import { applyMaterialProgressUpdates } from '../lib/materialPace';
import {
  mergeTimetablePeriodsByTermAndNumber,
  normalizeTimetableTermsByYearAndKind,
  remapTimetableTermId,
} from './timetableDataNormalization';

interface PlannerTimetableData {
  scheduleTemplates: ScheduleTemplate[];
  timetableTerms: TimetableTerm[];
  timetablePeriods: TimetablePeriod[];
}

export function normalizePlannerTimetableData(
  userId: string,
  data: PlannerTimetableData,
  now: string,
) {
  const {
    scheduleTemplates: nextScheduleTemplates,
    timetableTerms: nextTimetableTerms,
    timetablePeriods: nextTimetablePeriods,
  } = data;
  if ([...nextScheduleTemplates, ...nextTimetablePeriods].some((record) => record.userId !== userId)) {
    throw new Error('Timetable normalization cannot migrate another owner’s records.');
  }
  const {
    terms: resolvedTimetableTerms,
    termIdMap,
    obsoleteTermIds,
  } = normalizeTimetableTermsByYearAndKind(userId, nextTimetableTerms, now);
  const remappedScheduleTemplates = nextScheduleTemplates.map((template) => {
    const nextTermId = remapTimetableTermId(template.termId, termIdMap);

    return nextTermId === (template.termId || 'default')
      ? template
      : {
          ...template,
          termId: nextTermId,
          updatedAt: now,
        };
  });
  const {
    periods: resolvedTimetablePeriods,
    obsoletePeriodIds,
  } = mergeTimetablePeriodsByTermAndNumber(
    nextTimetablePeriods.map((period) => {
      const nextTermId = remapTimetableTermId(period.termId, termIdMap);

      return nextTermId === period.termId
        ? period
        : {
            ...period,
            termId: nextTermId,
            updatedAt: now,
          };
    }),
  );

  const termUpserts = resolvedTimetableTerms.filter((term) => {
    const previousTerm = nextTimetableTerms.find((item) => item.id === term.id);
    return !(
      previousTerm &&
      previousTerm.year === term.year &&
      previousTerm.kind === term.kind &&
      previousTerm.label === term.label &&
      previousTerm.startDate === term.startDate &&
      previousTerm.endDate === term.endDate &&
      previousTerm.usesAlternatingWeeks === term.usesAlternatingWeeks &&
      previousTerm.alternatingWeekAnchorDate === term.alternatingWeekAnchorDate &&
      previousTerm.isActive === term.isActive
    );
  });
  const templateUpserts = remappedScheduleTemplates.filter((template) => {
    const previousTemplate = nextScheduleTemplates.find((item) => item.id === template.id);
    return previousTemplate?.termId !== template.termId;
  });
  const periodUpserts = resolvedTimetablePeriods.filter((period) => {
    const previousPeriod = nextTimetablePeriods.find((item) => item.id === period.id);
    return previousPeriod?.termId !== period.termId;
  });
  const termDeletes = nextTimetableTerms.filter((term) => obsoleteTermIds.includes(term.id));
  const periodDeletes = nextTimetablePeriods.filter((period) =>
    obsoletePeriodIds.includes(period.id),
  );

  return {
    scheduleTemplates: remappedScheduleTemplates,
    timetableTerms: resolvedTimetableTerms,
    timetablePeriods: resolvedTimetablePeriods,
    mutation: {
      userId,
      termUpserts,
      termDeletes,
      templateUpserts,
      templateDeletes: [] as ScheduleTemplate[],
      periodUpserts,
      periodDeletes,
    },
  };
}

export function resolveActualMaterialProgress(
  studyMaterials: StudyMaterial[],
  actual: Pick<Actual, 'materialProgressUpdates'>,
  now: string,
): { nextMaterials: StudyMaterial[]; changedMaterials: StudyMaterial[] } {
  if (!actual.materialProgressUpdates?.length) {
    return { nextMaterials: studyMaterials, changedMaterials: [] };
  }
  const nextMaterials = applyMaterialProgressUpdates(
    studyMaterials,
    actual.materialProgressUpdates,
    now,
  );
  const changedMaterials = nextMaterials.filter((nextMaterial) => {
    const currentMaterial = studyMaterials.find(
      (material) => material.id === nextMaterial.id,
    );
    return Boolean(
      currentMaterial && currentMaterial.currentUnit !== nextMaterial.currentUnit,
    );
  });
  return { nextMaterials, changedMaterials };
}

// Pure compatibility-view transitions only. Persistence, admission and accepted-read
// freshness remain owned by the repository and application boundaries.
export function sortAndUpsertPlans(current: Plan[], nextPlans: Plan[]): Plan[] {
  return sortByDateTime(
    nextPlans.reduce(
      (records, nextPlan) => upsertByKey(records, nextPlan, (plan) => plan.id),
      current,
    ),
  );
}

export function upsertActualsById(current: Actual[], nextActuals: Actual[]): Actual[] {
  return nextActuals.reduce(
    (records, nextActual) => upsertByKey(records, nextActual, (actual) => actual.id),
    current,
  );
}

export function upsertActualByOccurrenceKey(
  current: Actual[],
  nextActual: Actual,
  removedActualIds: string[] = [],
): Actual[] {
  const removedIdSet = new Set(removedActualIds);

  return upsertByKey(
    current.filter((actual) => !removedIdSet.has(actual.id)),
    nextActual,
    (actual) => getActualOccurrenceKey(actual),
  );
}

export function applyRecurringPlanProjection(
  current: Plan[],
  mutation: RecurringPlanMutation,
): Plan[] {
  const deletedPlanIds = new Set(mutation.planDeletes.map((plan) => plan.id));
  return sortAndUpsertPlans(
    current.filter((plan) => !deletedPlanIds.has(plan.id)),
    mutation.planUpserts,
  );
}

export function applyRecurringActualProjection(
  current: Actual[],
  mutation: RecurringPlanMutation,
): Actual[] {
  const deletedPlanIds = new Set(mutation.planDeletes.map((plan) => plan.id));
  const deletedActualIds = new Set(mutation.actualDeletes.map((actual) => actual.id));
  return upsertActualsById(
    current.filter(
      (actual) =>
        !deletedActualIds.has(actual.id) &&
        (!actual.planId || !deletedPlanIds.has(actual.planId)),
    ),
    mutation.actualUpserts,
  );
}
