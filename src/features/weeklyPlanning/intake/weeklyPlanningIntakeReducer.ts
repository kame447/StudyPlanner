import { addDays, startOfWeek } from '../../../lib/date';
import {
  assessWeeklyPlanningRequest,
  looksLikeWeeklyPlanningRequest,
  mergeWeeklyPlanningRevision,
} from '../weeklyPlanningTransforms';
import type {
  ExamPrepScope,
  PlanningIntakeMissing,
  PlanningIntakeState,
  StudyScopeUnit,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';
import {
  parseCompletedSingleYearRevision,
  parseCompletedYearDirection,
  parseProgressHint,
} from './weeklyPlanningCompletionParsing';
import { toLifeConstraintFromAddUnavailableCommand } from './weeklyPlanningCommandAdapter';
import { mergeLifeConstraints } from './weeklyPlanningConstraintIdentity';
import { hasConfirmedFixedEvent, hasExplicitNoFixedEvents, hasLifeConstraint, parseConstraints } from './weeklyPlanningConstraintParsing';
import { parseAddUnavailableCommands } from './weeklyPlanningUnavailableParsing';
import { addMissing, finalizeState, removeMissing } from './weeklyPlanningMissingStatus';
import { parsePriorityPolicy } from './weeklyPlanningPriorityParsing';
import { normalizeIntakeText, parseSmallInteger, uniqueList } from './weeklyPlanningTextParsing';
import { parseUnitRate } from './weeklyPlanningUnitRateParsing';

const DEFAULT_PRIORITY_POLICY = { kind: 'unknown' } as const;


function mapWeeklyAmountUnit(unit: string): StudyScopeUnit {
  switch (unit) {
    case "minutes":
    case "words":
    case "pages":
    case "problems":
      return unit;
    case "passages":
      return "lessons";
    case "chapter":
      return "chapters";
    case "items":
    case "material":
    case "years":
    default:
      return "unknown";
  }
}


export function createInitialPlanningIntakeState(): PlanningIntakeState {
  return {
    status: 'idle',
    intent: 'unknown',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: DEFAULT_PRIORITY_POLICY,
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    sourceTurns: [],
  };
}

function formatDateTime(date: string, time: string): string {
  return `${date}T${time}:00`;
}

function parseWeekendRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
): PlanningIntakeState['range'] | undefined {
  const normalizedText = normalizeIntakeText(text);
  const startMatch = normalizedText.match(/今日(?:の)?\s*(\d{1,2})\s*時/);

  if (!startMatch || !/土日.*(?:終わり|最後)|日曜.*(?:終わり|最後)/.test(normalizedText)) {
    return undefined;
  }

  const weekStart = startOfWeek(context.selectedDate);
  const sunday = addDays(weekStart, 6);
  const startHour = Number(startMatch[1]);
  const startTime = `${String(startHour).padStart(2, '0')}:00`;

  return {
    startDateTime: formatDateTime(context.selectedDate, startTime),
    endDateTime: formatDateTime(sunday, '24:00'),
    sourceText: text,
    confidence: 'explicit',
  };
}

function extractExamFields(text: string): string[] {
  return normalizeIntakeText(text)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .map((line) => line.match(/第\s*\d+\s*部\s+(.+)$/)?.[1]?.trim())
    .filter((field): field is string => Boolean(field));
}

function parseTotalYears(text: string): number | undefined {
  const match = normalizeIntakeText(text).match(/([0-9]+|[一二三四五六七八九十]+)\s*年分/);
  return match ? parseSmallInteger(match[1]) : undefined;
}

function parseTotalFields(text: string): number | undefined {
  const match = normalizeIntakeText(text).match(/([0-9]+|[一二三四五六七八九十]+)\s*分野/);
  return match ? parseSmallInteger(match[1]) : undefined;
}




function parseYearRange(text: string): ExamPrepScope['yearRange'] | undefined {
  const match = normalizeIntakeText(text).match(/(20\d{2})\s*[〜~-]\s*(20\d{2})/);

  if (!match) {
    return undefined;
  }

  return {
    startYear: Number(match[1]),
    endYear: Number(match[2]),
    sourceText: match[0],
  };
}



function mergeExamPrepScope(
  previousScope: ExamPrepScope | undefined,
  text: string,
): ExamPrepScope | undefined {
  const normalizedText = normalizeIntakeText(text);
  const fields = uniqueList([...(previousScope?.fields ?? []), ...extractExamFields(text)]);
  const totalFields = parseTotalFields(text) ?? previousScope?.totalFields;
  const totalYears = parseTotalYears(text) ?? previousScope?.totalYears;
  const yearRange = parseYearRange(text) ?? previousScope?.yearRange;
  const examType = /院試/.test(normalizedText) ? '院試' : previousScope?.examType;
  const strategyHint =
    /分野ごと/.test(normalizedText) ? 'field_first' : previousScope?.strategyHint;
  const unitModel =
    examType || fields.length > 0 || totalYears
      ? 'year_field_chunk'
      : previousScope?.unitModel;

  if (!examType && fields.length === 0 && !totalFields && !totalYears && !previousScope) {
    return undefined;
  }

  return {
    examType,
    fields,
    totalFields,
    totalYears,
    yearRange,
    strategyHint,
    unitModel,
    unitCountHint: totalFields && totalYears ? totalFields * totalYears : previousScope?.unitCountHint,
    rawText: [...(previousScope?.rawText ?? []), text],
  };
}


export function applyWeeklyPlanningUserTurn(
  previousState: PlanningIntakeState | undefined,
  userText: string,
  context: WeeklyPlanningIntakeContext,
): PlanningIntakeState {
  const baseState = previousState ?? createInitialPlanningIntakeState();
  let nextState: PlanningIntakeState = {
    ...baseState,
    tasks: baseState.tasks.map((task) => ({ ...task })),
    progress: baseState.progress.map((progress) => ({
      ...progress,
      completedYears: progress.completedYears ? [...progress.completedYears] : undefined,
      incomplete: progress.incomplete ? [...progress.incomplete] : undefined,
    })),
    unitRates: baseState.unitRates.map((unitRate) => ({ ...unitRate })),
    constraints: baseState.constraints.map((constraint) => ({ ...constraint })),
    missing: [...baseState.missing],
    assumptions: [...baseState.assumptions],
    uncertainties: [...baseState.uncertainties],
    questions: [],
    sourceTurns: [...baseState.sourceTurns, userText],
    shouldCreateDraft: false,
    shouldSavePlan: false,
  };

  const range = parseWeekendRange(userText, context);

  if (range) {
    nextState = {
      ...nextState,
      intent: 'weekly_study_planning',
      range,
      missing: addMissing(nextState.missing, [
        'tasks_or_goals',
        'fixed_events',
        'sleep_cycle',
        'meal_bath_constraints',
      ]),
    };
  }

  const scope = mergeExamPrepScope(nextState.examPrepScope, userText);

  if (scope) {
    nextState = {
      ...nextState,
      intent: scope.examType === '院試' ? 'exam_prep_planning' : nextState.intent,
      examPrepScope: scope,
      missing: removeMissing(nextState.missing, ['tasks_or_goals']),
    };

    if (scope.totalYears && !scope.yearRange) {
      nextState.missing = addMissing(nextState.missing, ['year_range']);
    }
    if (scope.yearRange) {
      nextState.missing = removeMissing(nextState.missing, ['year_range']);
    }

    if (scope.unitModel === 'year_field_chunk' && nextState.unitRates.length === 0) {
      nextState.missing = addMissing(nextState.missing, ['unit_duration_estimate']);
    }
  }

    const fields = nextState.examPrepScope?.fields ?? [];
  const currentPriorityOrder = nextState.priorityPolicy.kind === 'field_first'
    ? nextState.priorityPolicy.order
    : [];
  const priorityPolicy = parsePriorityPolicy(userText, fields, currentPriorityOrder);

  if (priorityPolicy) {
    nextState = {
      ...nextState,
      priorityPolicy,
      missing: removeMissing(nextState.missing, [
        "priority_policy",
        "next_field_after_math",
      ]),
    };
  }

  const progressHint = parseProgressHint(userText, fields);

  if (progressHint) {
    nextState = {
      ...nextState,
      progress: [...nextState.progress, progressHint],
      missing: addMissing(nextState.missing, ['completion_direction']),
    };
  }

  const completedYearDirection = parseCompletedYearDirection(
    userText,
    nextState.examPrepScope?.yearRange,
    fields,
  );

  if (completedYearDirection && nextState.progress.length > 0) {
    let progressIndex = -1;

    for (let index = nextState.progress.length - 1; index >= 0; index -= 1) {
      if (nextState.progress[index].field === completedYearDirection.field) {
        progressIndex = index;
        break;
      }
    }

    const targetIndex = progressIndex >= 0 ? progressIndex : nextState.progress.length - 1;
    const targetProgress = nextState.progress[targetIndex];
    const updatedProgress = {
      ...targetProgress,
      field: completedYearDirection.field,
      completedYears: completedYearDirection.completedYears,
      ambiguity: 'none' as const,
      rawText: completedYearDirection.rawText,
    };

    nextState = {
      ...nextState,
      progress: [
        ...nextState.progress.slice(0, targetIndex),
        updatedProgress,
        ...nextState.progress.slice(targetIndex + 1),
      ],
      missing: removeMissing(nextState.missing, ['completion_direction']),
    };
  }


  const completedSingleYearRevision = parseCompletedSingleYearRevision(
    userText,
    nextState.examPrepScope?.yearRange,
    fields,
  );

  if (completedSingleYearRevision) {
    const progressIndex = nextState.progress.findIndex(
      (progress) => progress.field === completedSingleYearRevision.field,
    );
    const existingProgress =
      progressIndex >= 0
        ? nextState.progress[progressIndex]
        : {
            field: completedSingleYearRevision.field,
            ambiguity: 'none' as const,
            rawText: completedSingleYearRevision.rawText,
          };
    const completedYears = uniqueList([
      ...(existingProgress.completedYears ?? []),
      completedSingleYearRevision.completedYear,
    ]);
    const updatedProgress = {
      ...existingProgress,
      field: completedSingleYearRevision.field,
      completedYears,
      ambiguity: 'none' as const,
      rawText: completedSingleYearRevision.rawText,
    };

    nextState = {
      ...nextState,
      progress:
        progressIndex >= 0
          ? [
              ...nextState.progress.slice(0, progressIndex),
              updatedProgress,
              ...nextState.progress.slice(progressIndex + 1),
            ]
          : [...nextState.progress, updatedProgress],
      missing: removeMissing(nextState.missing, ['completion_direction']),
    };
  }

  const unitRate = parseUnitRate(userText, nextState.examPrepScope);

  if (unitRate) {
    nextState = {
      ...nextState,
      unitRates: [
        ...nextState.unitRates.filter((rate) => rate.unit !== unitRate.unit),
        unitRate,
      ],
      missing: removeMissing(nextState.missing, ['unit_duration_estimate']),
    };
  }

  const addUnavailableCommands = parseAddUnavailableCommands(userText, context);
  const constraints = [
    ...addUnavailableCommands.map(toLifeConstraintFromAddUnavailableCommand),
    ...parseConstraints(userText, context),
  ];
  const missingToRemoveForConstraints: PlanningIntakeMissing[] = [];

  if (constraints.some(hasLifeConstraint)) {
    missingToRemoveForConstraints.push(
      'sleep_cycle',
      'meal_bath_constraints',
      'life_constraints',
    );
  }

  if (constraints.some(hasConfirmedFixedEvent) || hasExplicitNoFixedEvents(userText)) {
    missingToRemoveForConstraints.push('fixed_events');
  }

  if (constraints.length > 0 || missingToRemoveForConstraints.length > 0) {
    nextState = {
      ...nextState,
      constraints: mergeLifeConstraints(nextState.constraints, constraints),
      missing: removeMissing(nextState.missing, missingToRemoveForConstraints),
    };
  }

  if (/知らない分野.*時間かかる|細かく見る.*時間かかる/.test(normalizeIntakeText(userText))) {
    nextState = {
      ...nextState,
      uncertainties: uniqueList([
        ...nextState.uncertainties,
        'unknown_fields_may_take_longer',
      ]),
    };
  }

  if (
    nextState.intent === 'unknown' &&
    looksLikeWeeklyPlanningRequest(userText)
  ) {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: context.selectedDate,
      text: userText,
    });
    nextState = {
      ...nextState,
      intent: 'weekly_study_planning',
      tasks: assessment.tasks.map((task) => ({
        title: task.title,
        subject: task.title,
        unit: mapWeeklyAmountUnit(task.amount.unit),
        amount: task.amount.value,
        rawText: task.sourceText,
        requiresTimeEstimate: task.requiresTimeEstimate,
      })),
      missing: assessment.kind === 'ready' ? nextState.missing : addMissing(nextState.missing, ['life_constraints']),
    };
  } else if (previousState && nextState.intent === 'weekly_study_planning') {
    const revision = mergeWeeklyPlanningRevision({
      selectedDate: context.selectedDate,
      previousText: previousState.sourceTurns.join('、'),
      revisionText: userText,
    });

    if (revision.tasks.length > 0 && !nextState.examPrepScope) {
      nextState = {
        ...nextState,
        tasks: revision.tasks.map((task) => ({
          title: task.title,
          subject: task.title,
          unit: mapWeeklyAmountUnit(task.amount.unit),
          amount: task.amount.value,
          rawText: task.sourceText,
          requiresTimeEstimate: task.requiresTimeEstimate,
        })),
      };
    }
  }

  if (
    nextState.examPrepScope &&
    nextState.unitRates.length > 0 &&
    nextState.priorityPolicy.kind === 'unknown' &&
    !nextState.missing.includes('year_range') &&
    !nextState.missing.includes('completion_direction')
  ) {
    nextState.missing = addMissing(nextState.missing, [
      'priority_policy',
      'next_field_after_math',
    ]);
  }

  return finalizeState(nextState);
}
