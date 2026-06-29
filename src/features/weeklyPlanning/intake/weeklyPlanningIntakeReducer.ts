import { addDays, startOfWeek } from '../../../lib/date';
import {
  assessWeeklyPlanningRequest,
  looksLikeWeeklyPlanningRequest,
  mergeWeeklyPlanningRevision,
} from '../weeklyPlanningTransforms';
import type {
  ExamPrepScope,
  LifeConstraint,
  PlanningIntakeMissing,
  PlanningIntakeState,
  PlanningIntakeStatus,
  PriorityPolicy,
  StudyScopeUnit,
  StudyProgress,
  UnitRateEstimate,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';

const DEFAULT_PRIORITY_POLICY = { kind: 'unknown' } as const;

function normalizeIntakeText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[〜～−―–—]/g, '〜')
    .replace(/[　]/g, ' ');
}

function splitIntakeSegments(text: string): string[] {
  return normalizeIntakeText(text)
    .split(/\r?\n|。|、|けど|ただ|あと|それと|でも/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parseSmallInteger(text: string): number | undefined {
  const normalizedText = normalizeIntakeText(text).trim();

  if (/^\d+$/.test(normalizedText)) {
    return Number(normalizedText);
  }

  const digitValues: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (normalizedText === '十') {
    return 10;
  }

  const tenIndex = normalizedText.indexOf('十');
  if (tenIndex >= 0) {
    const tensText = normalizedText.slice(0, tenIndex);
    const onesText = normalizedText.slice(tenIndex + 1);
    const tens = tensText ? digitValues[tensText] : 1;
    const ones = onesText ? digitValues[onesText] : 0;

    return tens && ones !== undefined ? tens * 10 + ones : undefined;
  }

  return digitValues[normalizedText];
}

function uniqueList<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

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

function addMissing(
  current: PlanningIntakeMissing[],
  additions: PlanningIntakeMissing[],
): PlanningIntakeMissing[] {
  return uniqueList([...current, ...additions]);
}

function removeMissing(
  current: PlanningIntakeMissing[],
  removals: PlanningIntakeMissing[],
): PlanningIntakeMissing[] {
  const removalSet = new Set(removals);
  return current.filter((item) => !removalSet.has(item));
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

function resolveFieldName(rawField: string | undefined, fields: string[]): string | undefined {
  if (!rawField) {
    return undefined;
  }

  const normalizedField = rawField.trim();
  return fields.find((field) => field.includes(normalizedField)) ?? normalizedField;
}

function resolveFieldByKeyword(keyword: string, fields: string[]): string | undefined {
  return fields.find((field) => field.includes(keyword));
}

function parsePriorityPolicy(text: string, fields: string[]): PriorityPolicy | undefined {
  const mathField = resolveFieldByKeyword("数学", fields);
  const softwareField = resolveFieldByKeyword("ソフトウェア", fields);

  for (const segment of splitIntakeSegments(text)) {
    const order: string[] = [];

    if (/数学.*終わったら.*ソフトウェア/.test(segment)) {
      if (mathField) order.push(mathField);
      if (softwareField) order.push(softwareField);
    }

    if (/数学.*より.*ソフトウェア.*優先|ソフトウェア.*優先.*数学.*より/.test(segment)) {
      if (softwareField) order.push(softwareField);
      if (mathField) order.push(mathField);
    }

    if (order.length > 0) {
      return {
        kind: "field_first",
        order: uniqueList(order),
      };
    }
  }

  return undefined;
}

function parseProgressHint(text: string, fields: string[]): StudyProgress | undefined {
  for (const segment of splitIntakeSegments(text)) {
    if (
      hasIncompleteExpression(segment) ||
      hasConditionalCompletionExpression(segment) ||
      hasPlannedExpression(segment)
    ) {
      continue;
    }

    const match = segment.match(/([^\s、。]+?)(?:の)?\s*(20\d{2})\s*まで.*(?:終わ|済|完了|やった)/);

    if (!match) {
      continue;
    }

    return {
      field: resolveFieldName(match[1], fields),
      completionBoundaryYear: Number(match[2]),
      ambiguity: 'completion_direction',
      rawText: match[0],
    };
  }

  return undefined;
}

interface YearRangeExpression {
  startText: string;
  endText: string;
  sourceText: string;
  index: number;
}

interface CompletedYearDirectionResult {
  completedYears: number[];
  field: string;
  rawText: string;
}

function parseYearRangeExpressions(text: string): YearRangeExpression[] {
  const normalizedText = normalizeIntakeText(text);
  const rangeExpressions = Array.from(
    normalizedText.matchAll(/((?:20)?\d{2})\s*[〜~-]\s*((?:20)?\d{2})/g),
    (match) => ({
      startText: match[1],
      endText: match[2],
      sourceText: match[0],
      index: match.index ?? 0,
    }),
  );
  const fromToExpressions = Array.from(
    normalizedText.matchAll(/((?:20)?\d{2})\s*から\s*((?:20)?\d{2})\s*まで/g),
    (match) => ({
      startText: match[1],
      endText: match[2],
      sourceText: match[0],
      index: match.index ?? 0,
    }),
  );

  return [...rangeExpressions, ...fromToExpressions].sort(
    (left, right) => left.index - right.index,
  );
}

function resolveFieldScopeForYearRange(
  segment: string,
  rangeExpression: YearRangeExpression,
  fields: string[],
): string | undefined {
  const beforeRange = segment.slice(0, rangeExpression.index);
  const fieldMatch = beforeRange.match(/([^\s、。]+?)(?:の|は)?\s*$/);
  return resolveFieldName(fieldMatch?.[1], fields);
}

function normalizeYearToken(
  token: string,
  yearRange: ExamPrepScope['yearRange'] | undefined,
): number | undefined {
  if (/^20\d{2}$/.test(token)) {
    return Number(token);
  }

  if (!/^\d{2}$/.test(token) || !yearRange) {
    return undefined;
  }

  const yearSuffix = Number(token);
  const minYear = Math.min(yearRange.startYear, yearRange.endYear);
  const maxYear = Math.max(yearRange.startYear, yearRange.endYear);
  const baseCentury = Math.floor(minYear / 100) * 100;
  const candidates = uniqueList([
    baseCentury + yearSuffix,
    baseCentury + 100 + yearSuffix,
    baseCentury - 100 + yearSuffix,
  ]);

  return candidates.find((candidate) => candidate >= minYear && candidate <= maxYear);
}

function expandYearRange(startYear: number, endYear: number): number[] {
  const step = startYear >= endYear ? -1 : 1;
  const years: number[] = [];

  for (let year = startYear; step > 0 ? year <= endYear : year >= endYear; year += step) {
    years.push(year);
  }

  return years;
}

function hasIncompleteExpression(text: string): boolean {
  return /残ってる|残る|残り|まだ|未完了|未着手|未了|終わって?ない|完了していない|完了してない|やってない|済んでない/.test(
    normalizeIntakeText(text),
  );
}

function hasConditionalCompletionExpression(text: string): boolean {
  return /終わったら|終われば|完了したら|済んだら|やったら/.test(normalizeIntakeText(text));
}

function hasPlannedExpression(text: string): boolean {
  return /やる予定|やりたい|やるつもり|予定/.test(normalizeIntakeText(text));
}

function hasCompletionExpression(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);

  if (
    hasIncompleteExpression(normalizedText) ||
    hasConditionalCompletionExpression(normalizedText) ||
    hasPlannedExpression(normalizedText)
  ) {
    return false;
  }

  return /終わった|終わってる|済んだ|済み|済ませた|完了|やった/.test(normalizedText);
}

function parseCompletedYearDirection(
  text: string,
  yearRange: ExamPrepScope['yearRange'] | undefined,
  fields: string[],
): CompletedYearDirectionResult | undefined {
  for (const segment of splitIntakeSegments(text)) {
    if (!hasCompletionExpression(segment)) {
      continue;
    }

    const rangeExpressions = parseYearRangeExpressions(segment);
    const rangeExpression = rangeExpressions[rangeExpressions.length - 1];

    if (!rangeExpression) {
      continue;
    }

    const field = resolveFieldScopeForYearRange(segment, rangeExpression, fields);

    if (!field) {
      continue;
    }

    const startYear = normalizeYearToken(rangeExpression.startText, yearRange);
    const endYear = normalizeYearToken(rangeExpression.endText, yearRange);

    if (!startYear || !endYear) {
      continue;
    }

    return {
      completedYears: expandYearRange(startYear, endYear),
      field,
      rawText: segment,
    };
  }

  return undefined;
}

function buildYearFieldUnitRate(
  match: RegExpMatchArray,
  segment: string,
): UnitRateEstimate | undefined {
  const hours = parseSmallInteger(match[1]);

  if (!hours) {
    return undefined;
  }

  return {
    unit: 'year_field_chunk',
    minutesPerUnit: hours * 60,
    source: 'user',
    uncertainty: /くらい|ぐらい|だいたい/.test(segment) ? 'medium' : 'low',
    rawText: match[0],
  };
}

function parseUnitRate(
  text: string,
  examPrepScope: ExamPrepScope | undefined,
): UnitRateEstimate | undefined {
  for (const segment of splitIntakeSegments(text)) {
    const explicitYearFieldMatch = segment.match(
      /(?:1|一)\s*分野(?:の)?\s*(?:1|一)\s*年分.*?([0-9]+|[一二三四五六七八九十]+)\s*時間/,
    );

    if (explicitYearFieldMatch) {
      return buildYearFieldUnitRate(explicitYearFieldMatch, segment);
    }

    if (examPrepScope?.unitModel !== 'year_field_chunk') {
      continue;
    }

    const contextualYearMatch = segment.match(
      /(?:1|一)?\s*年分(?:は|が|で|に)?\s*([0-9]+|[一二三四五六七八九十]+)\s*時間/,
    );

    if (contextualYearMatch) {
      return buildYearFieldUnitRate(contextualYearMatch, segment);
    }
  }

  return undefined;
}

function formatHourTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function parseConstraints(text: string, context: WeeklyPlanningIntakeContext): LifeConstraint[] {
  const constraints: LifeConstraint[] = [];

  for (const segment of splitIntakeSegments(text)) {
    const fixedStartMatch = segment.match(/(\d{1,2})\s*時(?:から)?/);
    const hasFixedEventKeyword = /授業|バイト|病院|ゼミ|外出|予定あり|予定がある/.test(segment);
    const isAmbiguousFixedEvent = /かも|かもしれ|たぶん|多分/.test(segment);

    if (hasFixedEventKeyword) {
      constraints.push({
        kind: 'fixed_event',
        date: context.selectedDate,
        start: fixedStartMatch ? formatHourTime(Number(fixedStartMatch[1])) : undefined,
        hardness: isAmbiguousFixedEvent ? 'soft' : 'hard',
        rawText: segment,
      });
      continue;
    }

    if (/今日は?\s*2\s*時.*寝/.test(segment)) {
      constraints.push({
        kind: 'sleep',
        date: context.selectedDate,
        end: '26:00',
        hardness: 'soft',
        rawText: segment,
      });
    }

    if (/お昼|昼|夜.*(?:読めない|使えない|あんま読めない)/.test(segment)) {
      constraints.push({
        kind: 'meal',
        hardness: 'soft',
        rawText: segment,
      });
    }

    if (/ご飯.*19\s*時.*済ま/.test(segment)) {
      constraints.push({
        kind: 'meal',
        date: context.selectedDate,
        end: '19:00',
        hardness: 'hard',
        rawText: segment,
      });
    }

    if (/風呂|お風呂/.test(segment)) {
      constraints.push({
        kind: 'bath',
        durationMinutes: 30,
        hardness: 'soft',
        rawText: segment,
      });
    }

    if (/寝る時間|寝る準備|就寝/.test(segment)) {
      constraints.push({
        kind: 'buffer',
        durationMinutes: 30,
        hardness: 'soft',
        rawText: segment,
      });
    }
  }

  return constraints;
}

function hasExplicitNoFixedEvents(text: string): boolean {
  return splitIntakeSegments(text).some((segment) =>
    /(?:他の)?固定予定.*ない|(?:他の)?予定.*ない|用事.*ない/.test(segment),
  );
}

function hasLifeConstraint(constraint: LifeConstraint): boolean {
  return constraint.kind !== 'fixed_event' && constraint.kind !== 'unavailable';
}

function hasConfirmedFixedEvent(constraint: LifeConstraint): boolean {
  return constraint.kind === 'fixed_event' && constraint.hardness === 'hard';
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

function resolveQuestions(state: PlanningIntakeState): string[] {
  const questions: string[] = [];

  if (state.missing.includes('tasks_or_goals')) {
    questions.push('計画したい学習内容や目標を教えてください。');
  }

  if (state.missing.includes('year_range')) {
    questions.push('7年分は何年から何年までですか？');
  }

  if (state.missing.includes('completion_direction')) {
    questions.push('2021まで完了は、新しい年度から2021までですか？古い年度から2021までですか？');
  }

  if (state.missing.includes('unit_duration_estimate')) {
    questions.push('1つの年度×分野にだいたい何分かかりますか？');
  }

  if (state.missing.includes('priority_policy')) {
    questions.push('週末で優先する分野や進める順番を教えてください。');
  }

  return questions;
}

function resolveStatus(state: PlanningIntakeState): PlanningIntakeStatus {
  if (state.missing.includes('tasks_or_goals')) {
    return 'needs_scope';
  }

  if (state.missing.includes('completion_direction')) {
    return 'needs_progress_clarification';
  }

  if (state.missing.includes('year_range')) {
    return 'needs_year_range';
  }

  if (state.missing.includes('unit_duration_estimate')) {
    return 'needs_unit_rate';
  }

  if (state.missing.includes('priority_policy') || state.missing.includes('next_field_after_math')) {
    return 'needs_priority_policy';
  }

  if (
    state.missing.includes('life_constraints') ||
    state.missing.includes('fixed_events') ||
    state.missing.includes('sleep_cycle') ||
    state.missing.includes('meal_bath_constraints')
  ) {
    return 'needs_life_constraints';
  }

  return state.tasks.length > 0 || state.examPrepScope ? 'draft_ready' : 'idle';
}

function finalizeState(state: PlanningIntakeState): PlanningIntakeState {
  const status = resolveStatus(state);
  const nextState = {
    ...state,
    status,
    missing: uniqueList(state.missing),
    assumptions: uniqueList(state.assumptions),
    uncertainties: uniqueList(state.uncertainties),
  };
  const shouldCreateDraft = status === 'draft_ready' && nextState.missing.length === 0;

  return {
    ...nextState,
    questions: resolveQuestions(nextState),
    shouldCreateDraft,
    shouldSavePlan: false,
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
  const priorityPolicy = parsePriorityPolicy(userText, fields);

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

  const constraints = parseConstraints(userText, context);
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
      constraints: [...nextState.constraints, ...constraints],
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
