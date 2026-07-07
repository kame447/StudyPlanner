import type { StudyScopeUnit } from './weeklyPlanningIntakeTypes';
import type { WeeklyPlanningDraftRequest } from './weeklyPlanningDraftRequestAdapter';

export type WorkItemSplitPolicy = 'atomic' | 'splittable';

export interface WeeklyPlanningRemainingWorkItem {
  field: string;
  year: number;
  estimatedMinutes: number;
  unit: StudyScopeUnit;
  splitPolicy: WorkItemSplitPolicy;
  source: 'exam_prep_request';
}

export function resolveWorkItemSplitPolicy(unit: StudyScopeUnit): WorkItemSplitPolicy {
  switch (unit) {
    case 'year_field_chunk':
    case 'topic':
      return 'atomic';
    case 'minutes':
    case 'hours':
    case 'pages':
    case 'problems':
    case 'words':
    case 'lessons':
    case 'chapters':
    case 'unknown':
      return 'splittable';
    default:
      return 'splittable';
  }
}

export type WeeklyPlanningRemainingWorkItemsAmbiguity =
  | 'completed_years_without_field_scope'
  | 'field_order_incomplete';

export interface WeeklyPlanningRemainingWorkItemsResult {
  items: WeeklyPlanningRemainingWorkItem[];
  ambiguities: WeeklyPlanningRemainingWorkItemsAmbiguity[];
}

function uniqueList<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function expandYearsForPlanning(startYear: number, endYear: number): number[] {
  const firstYear = Math.max(startYear, endYear);
  const lastYear = Math.min(startYear, endYear);
  const years: number[] = [];

  for (let year = firstYear; year >= lastYear; year -= 1) {
    years.push(year);
  }

  return years;
}

function resolveFieldOrder(request: WeeklyPlanningDraftRequest): {
  fields: string[];
  isIncomplete: boolean;
} {
  const orderedFields = request.priorityPolicy.order;
  const remainingFields = request.examPrepScope.fields.filter(
    (field) => !orderedFields.includes(field),
  );

  return {
    fields: uniqueList([...orderedFields, ...remainingFields]),
    isIncomplete: remainingFields.length > 0,
  };
}

export function createRemainingWorkItemsFromDraftRequest(
  request: WeeklyPlanningDraftRequest,
): WeeklyPlanningRemainingWorkItemsResult {
  const ambiguities: WeeklyPlanningRemainingWorkItemsAmbiguity[] = [];
  const completedYearsByField = new Map<string, Set<number>>();

  request.progress.forEach((progress) => {
    if (!progress.field) {
      ambiguities.push('completed_years_without_field_scope');
      return;
    }

    const completedYears = completedYearsByField.get(progress.field) ?? new Set<number>();
    progress.completedYears.forEach((year) => completedYears.add(year));
    completedYearsByField.set(progress.field, completedYears);
  });

  const fieldOrder = resolveFieldOrder(request);

  if (fieldOrder.isIncomplete) {
    ambiguities.push('field_order_incomplete');
  }

  const years = expandYearsForPlanning(
    request.examPrepScope.yearRange.startYear,
    request.examPrepScope.yearRange.endYear,
  );

  return {
    items: fieldOrder.fields.flatMap((field) => {
      const completedYears = completedYearsByField.get(field) ?? new Set<number>();

      return years
        .filter((year) => !completedYears.has(year))
        .map((year) => ({
          field,
          year,
          estimatedMinutes: request.unitRate.minutesPerUnit,
          unit: request.unitRate.unit,
          splitPolicy: resolveWorkItemSplitPolicy(request.unitRate.unit),
          source: 'exam_prep_request' as const,
        }));
    }),
    ambiguities: uniqueList(ambiguities),
  };
}