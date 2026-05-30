import { minutesBetween, sortByDateTime } from './date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDateRange,
  getActualOccurrenceKey,
} from './planRecurrence';
import {
  resolveTimelineSubjectDisplay,
  type TimelineSubjectDisplay,
} from './timelineSubject';
import type {
  Actual,
  Plan,
  PlanSourceType,
  PlanType,
  StudyMaterial,
  StudySubject,
} from '../types/domain';

export type StudyRecordLinkKind = 'planned' | 'standalone' | 'orphaned';

export interface NormalizedStudyRecordForDisplay {
  id: string;
  actualId: string;
  planId: string | null;
  occurrenceKey: string;
  linkKind: StudyRecordLinkKind;
  isLinkedToPlan: boolean;
  actual: Actual;
  plan?: Plan;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  title: string;
  label: string;
  subject: string;
  subjectLabel: string;
  materialId: string | null;
  materialName: string;
  materialLabel: string;
  type: PlanType;
  sourceType?: PlanSourceType;
  subjectDisplay: TimelineSubjectDisplay;
}

export interface NormalizeStudyRecordsInput {
  actuals: Actual[];
  plans: Plan[];
  subjects?: StudySubject[];
  materials?: StudyMaterial[];
  startDate?: string;
  endDate?: string;
}

function compareActualRecency(left: Actual, right: Actual): number {
  const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);

  return updatedAtComparison !== 0
    ? updatedAtComparison
    : left.id.localeCompare(right.id);
}

export function dedupeLinkedStudyActuals(actuals: Actual[]): Actual[] {
  const dedupedActuals: Actual[] = [];
  const linkedActualIndexByKey = new Map<string, number>();

  actuals.forEach((actual) => {
    if (!actual.planId) {
      dedupedActuals.push(actual);
      return;
    }

    const key = getActualOccurrenceKey(actual);
    const existingIndex = linkedActualIndexByKey.get(key);

    if (existingIndex === undefined) {
      linkedActualIndexByKey.set(key, dedupedActuals.length);
      dedupedActuals.push(actual);
      return;
    }

    if (compareActualRecency(actual, dedupedActuals[existingIndex]) < 0) {
      dedupedActuals[existingIndex] = actual;
    }
  });

  return dedupedActuals;
}

function resolveDateRange(actuals: Actual[], startDate?: string, endDate?: string) {
  if (startDate && endDate) {
    return { startDate, endDate };
  }

  if (actuals.length === 0) {
    return null;
  }

  const actualDates = actuals.map((actual) => actual.occurrenceDate);

  return {
    startDate:
      startDate ??
      actualDates.reduce((min, date) => (date < min ? date : min), actualDates[0]),
    endDate:
      endDate ??
      actualDates.reduce((max, date) => (date > max ? date : max), actualDates[0]),
  };
}

function isDateInRange(date: string, startDate?: string, endDate?: string): boolean {
  return (
    (!startDate || date.localeCompare(startDate) >= 0) &&
    (!endDate || date.localeCompare(endDate) <= 0)
  );
}

function getExpandedPlansForActuals({
  plans,
  actuals,
  startDate,
  endDate,
}: {
  plans: Plan[];
  actuals: Actual[];
  startDate?: string;
  endDate?: string;
}): Plan[] {
  const range = resolveDateRange(actuals, startDate, endDate);

  if (!range) {
    return [];
  }

  return expandPlansForDateRange(plans, range.startDate, range.endDate);
}

function resolveActualPlan(
  actual: Actual,
  expandedPlanByOccurrenceKey: Map<string, Plan>,
  planById: Map<string, Plan>,
): Plan | undefined {
  if (!actual.planId) {
    return undefined;
  }

  return (
    expandedPlanByOccurrenceKey.get(getActualOccurrenceKey(actual)) ??
    planById.get(actual.planId)
  );
}

function resolveRecordTitle(actual: Actual, plan?: Plan): string {
  return (
    actual.title?.trim() ||
    plan?.title.trim() ||
    actual.materialName?.trim() ||
    plan?.materialName?.trim() ||
    '記録'
  );
}

function resolveRecordSubject(actual: Actual, plan?: Plan): string {
  return actual.subject.trim() || plan?.subject.trim() || '';
}

function resolveRecordMaterialName(actual: Actual, plan?: Plan): string {
  return actual.materialName?.trim() || plan?.materialName?.trim() || '';
}

function resolveRecordMaterialId(actual: Actual, plan?: Plan): string | null {
  return actual.materialId?.trim() || plan?.materialId?.trim() || null;
}

export function normalizeStudyRecordForDisplay({
  actual,
  plan,
  subjects = [],
  materials = [],
}: {
  actual: Actual;
  plan?: Plan;
  subjects?: StudySubject[];
  materials?: StudyMaterial[];
}): NormalizedStudyRecordForDisplay {
  const title = resolveRecordTitle(actual, plan);
  const subject = resolveRecordSubject(actual, plan);
  const materialId = resolveRecordMaterialId(actual, plan);
  const materialName = resolveRecordMaterialName(actual, plan);
  const type = plan?.type ?? 'study';
  const sourceType = plan?.sourceType;
  const materialsById = new Map(materials.map((material) => [material.id, material]));
  const subjectsById = new Map(subjects.map((subjectItem) => [subjectItem.id, subjectItem]));
  const subjectsByName = new Map(
    subjects.map((subjectItem) => [subjectItem.name.trim(), subjectItem]),
  );
  const subjectDisplay = resolveTimelineSubjectDisplay(
    {
      subject,
      type,
      sourceType,
      materialId,
      materialName,
      title,
    },
    { materialsById, subjectsById, subjectsByName },
  );
  const material = materialId ? materialsById.get(materialId) : undefined;
  const materialLabel = materialName || material?.name.trim() || '';
  const linkKind: StudyRecordLinkKind = actual.planId
    ? plan
      ? 'planned'
      : 'orphaned'
    : 'standalone';

  return {
    id: actual.id,
    actualId: actual.id,
    planId: actual.planId,
    occurrenceKey: getActualOccurrenceKey(actual),
    linkKind,
    isLinkedToPlan: linkKind === 'planned',
    actual,
    plan,
    date: actual.occurrenceDate,
    startTime: actual.actualStartTime,
    endTime: actual.actualEndTime,
    durationMinutes: minutesBetween(actual.actualStartTime, actual.actualEndTime),
    title,
    label: title,
    subject,
    subjectLabel: subjectDisplay.label,
    materialId,
    materialName,
    materialLabel,
    type,
    sourceType,
    subjectDisplay,
  };
}

export function normalizeStudyRecordsForDisplay({
  actuals,
  plans,
  subjects = [],
  materials = [],
  startDate,
  endDate,
}: NormalizeStudyRecordsInput): NormalizedStudyRecordForDisplay[] {
  const dedupedActuals = dedupeLinkedStudyActuals(actuals).filter((actual) =>
    isDateInRange(actual.occurrenceDate, startDate, endDate),
  );
  const expandedPlans = getExpandedPlansForActuals({
    plans,
    actuals: dedupedActuals,
    startDate,
    endDate,
  });
  const expandedPlanByOccurrenceKey = new Map(
    expandedPlans.map((plan) => [buildPlanOccurrenceKey(plan.id, plan.date), plan]),
  );
  const planById = new Map(plans.map((plan) => [plan.id, plan]));

  return sortByDateTime(
    dedupedActuals.map((actual) =>
      normalizeStudyRecordForDisplay({
        actual,
        plan: resolveActualPlan(actual, expandedPlanByOccurrenceKey, planById),
        subjects,
        materials,
      }),
    ),
  );
}

export function sumStudyRecordMinutes(
  records: Pick<NormalizedStudyRecordForDisplay, 'durationMinutes'>[],
): number {
  return records.reduce((sum, record) => sum + record.durationMinutes, 0);
}

export function isStudyRecordForDisplay(record: NormalizedStudyRecordForDisplay): boolean {
  return (
    record.linkKind !== 'planned' ||
    record.type === 'study' ||
    record.type === 'mock-exam' ||
    record.type === 'cram-school'
  );
}
