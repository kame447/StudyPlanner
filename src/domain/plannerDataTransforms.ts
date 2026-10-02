import type {
  Actual,
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
