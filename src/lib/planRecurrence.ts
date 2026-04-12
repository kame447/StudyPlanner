import { addDays } from './date';
import type {
  Actual,
  MonthEventRepeat,
  Plan,
  PlanType,
  RecurrenceDayType,
  RecurrenceRule,
  RecurrenceRuleKind,
  RecurrenceWeekday,
} from '../types/domain';

export const PLAN_REPEAT_OPTIONS: Array<{
  value: MonthEventRepeat;
  label: string;
}> = [
  { value: 'none', label: '繰り返しなし' },
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
  { value: 'yearly', label: '毎年' },
];

const RECURRENCE_WEEKDAY_BY_INDEX: RecurrenceWeekday[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];

const RECURRENCE_RULE_PRIORITY: Record<RecurrenceRuleKind, number> = {
  date: 4,
  weekday: 3,
  'day-type': 2,
  daily: 1,
};

type RecurrenceFallback = Partial<
  Pick<
    Plan,
    'date' | 'startTime' | 'endTime' | 'title' | 'subject' | 'type' | 'memo' | 'repeatUntil'
  >
>;

type LegacyRecurrenceSource = Pick<
  Plan,
  'date' | 'startTime' | 'endTime' | 'repeat' | 'repeatUntil' | 'title' | 'subject' | 'type' | 'memo'
>;

function toDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00`);
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimeString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);
}

function isValidPlanType(value: unknown): value is PlanType {
  return (
    value === 'study' ||
    value === 'mock-exam' ||
    value === 'school-event' ||
    value === 'cram-school' ||
    value === 'deadline' ||
    value === 'other'
  );
}

function isValidDayType(value: unknown): value is RecurrenceDayType {
  return value === 'weekday' || value === 'weekend';
}

export function isRecurrenceWeekday(value: unknown): value is RecurrenceWeekday {
  return (
    value === 'sun' ||
    value === 'mon' ||
    value === 'tue' ||
    value === 'wed' ||
    value === 'thu' ||
    value === 'fri' ||
    value === 'sat'
  );
}

function dedupeAndSortDates(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.filter(isValidDateString))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function dedupeWeekdays(values: unknown): RecurrenceWeekday[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter(isRecurrenceWeekday).filter((value, index, array) => {
    return array.indexOf(value) === index;
  });
}

function inferRuleKind(
  kind: unknown,
  dates: string[],
  weekdays: RecurrenceWeekday[],
  dayType: RecurrenceDayType | null,
): RecurrenceRuleKind {
  if (
    kind === 'daily' ||
    kind === 'day-type' ||
    kind === 'weekday' ||
    kind === 'date'
  ) {
    return kind;
  }

  if (dates.length > 0) {
    return 'date';
  }

  if (weekdays.length > 0) {
    return 'weekday';
  }

  if (dayType) {
    return 'day-type';
  }

  return 'daily';
}

export function getRecurrenceWeekday(dateString: string): RecurrenceWeekday {
  return RECURRENCE_WEEKDAY_BY_INDEX[toDate(dateString).getDay()] ?? 'sun';
}

function isWeekdayDate(dateString: string): boolean {
  const weekday = getRecurrenceWeekday(dateString);
  return weekday !== 'sun' && weekday !== 'sat';
}

function compareDateStringsDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

export function normalizeRecurrenceRule(
  rule: Partial<RecurrenceRule> | null | undefined,
  index: number,
  fallback: RecurrenceFallback = {},
): RecurrenceRule {
  const fallbackDate =
    (isValidDateString(rule?.startDate) && rule?.startDate) ||
    (isValidDateString(fallback.date) && fallback.date) ||
    '1970-01-01';
  const fallbackStartTime = isValidTimeString(fallback.startTime)
    ? fallback.startTime
    : '00:00';
  const fallbackEndTime = isValidTimeString(fallback.endTime)
    ? fallback.endTime
    : fallbackStartTime;
  const dates = dedupeAndSortDates(rule?.dates);
  const weekdays = dedupeWeekdays(rule?.weekdays);
  const dayType = isValidDayType(rule?.dayType) ? rule.dayType : null;
  const kind = inferRuleKind(rule?.kind, dates, weekdays, dayType);

  return {
    id:
      typeof rule?.id === 'string' && rule.id.trim().length > 0
        ? rule.id.trim()
        : `recurrence-rule-${index + 1}`,
    kind,
    startDate: fallbackDate,
    until: isValidDateString(rule?.until)
      ? rule.until
      : isValidDateString(fallback.repeatUntil)
        ? fallback.repeatUntil
        : null,
    dates:
      kind === 'date'
        ? dates.length > 0
          ? dates
          : [fallbackDate]
        : dates,
    weekdays: kind === 'weekday' ? weekdays : [],
    dayType: kind === 'day-type' ? dayType : null,
    startTime: isValidTimeString(rule?.startTime) ? rule.startTime : fallbackStartTime,
    endTime: isValidTimeString(rule?.endTime) ? rule.endTime : fallbackEndTime,
    title: typeof rule?.title === 'string' && rule.title.trim().length > 0 ? rule.title.trim() : undefined,
    subject:
      typeof rule?.subject === 'string' && rule.subject.trim().length > 0
        ? rule.subject.trim()
        : undefined,
    type: isValidPlanType(rule?.type) ? rule.type : undefined,
    memo: typeof rule?.memo === 'string' && rule.memo.trim().length > 0 ? rule.memo.trim() : undefined,
    isOverride: Boolean(rule?.isOverride),
  };
}

export function normalizeRecurrenceRules(
  rules: unknown,
  fallback: RecurrenceFallback = {},
): RecurrenceRule[] {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules.map((rule, index) =>
    normalizeRecurrenceRule(
      typeof rule === 'object' && rule ? (rule as Partial<RecurrenceRule>) : undefined,
      index,
      fallback,
    ),
  );
}

export function getRecurrenceRulePriority(rule: RecurrenceRule): number {
  return RECURRENCE_RULE_PRIORITY[rule.kind];
}

export function compareRecurrenceRules(left: RecurrenceRule, right: RecurrenceRule): number {
  const priorityDiff = getRecurrenceRulePriority(right) - getRecurrenceRulePriority(left);

  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  if (left.isOverride !== right.isOverride) {
    return left.isOverride ? -1 : 1;
  }

  const startDateDiff = compareDateStringsDesc(left.startDate, right.startDate);

  if (startDateDiff !== 0) {
    return startDateDiff;
  }

  return left.id.localeCompare(right.id);
}

export function doesRecurrenceRuleApplyToDate(
  rule: RecurrenceRule,
  targetDate: string,
): boolean {
  if (targetDate.localeCompare(rule.startDate) < 0) {
    return false;
  }

  if (rule.until && targetDate.localeCompare(rule.until) > 0) {
    return false;
  }

  if (rule.kind === 'date') {
    return rule.dates.includes(targetDate);
  }

  if (rule.kind === 'weekday') {
    return rule.weekdays.includes(getRecurrenceWeekday(targetDate));
  }

  if (rule.kind === 'day-type') {
    return rule.dayType === 'weekday'
      ? isWeekdayDate(targetDate)
      : !isWeekdayDate(targetDate);
  }

  return true;
}

export function selectApplicableRecurrenceRule(
  rules: RecurrenceRule[],
  targetDate: string,
): RecurrenceRule | null {
  const matches = rules.filter((rule) => doesRecurrenceRuleApplyToDate(rule, targetDate));

  if (matches.length === 0) {
    return null;
  }

  return [...matches].sort(compareRecurrenceRules)[0] ?? null;
}

export function summarizeLegacyRepeatFromRecurrenceRules(
  rules: RecurrenceRule[],
): MonthEventRepeat | null {
  if (rules.length === 0) {
    return null;
  }

  if (rules.every((rule) => rule.kind === 'date')) {
    return 'none';
  }

  const nonDateRules = rules.filter((rule) => rule.kind !== 'date');

  if (
    nonDateRules.length === 1 &&
    nonDateRules[0].kind === 'daily' &&
    !nonDateRules[0].isOverride
  ) {
    return 'daily';
  }

  return 'weekly';
}

export function summarizeLegacyRepeatUntilFromRecurrenceRules(
  rules: RecurrenceRule[],
  fallbackUntil: string | null = null,
): string | null {
  const untils = rules
    .map((rule) => rule.until)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left));

  return untils[0] ?? fallbackUntil;
}

export function buildRecurrenceRulesFromLegacySource(
  source: LegacyRecurrenceSource,
): RecurrenceRule[] {
  const baseRule = {
    id: 'recurrence-base',
    startDate: source.date,
    until: source.repeatUntil,
    dates: [],
    weekdays: [] as RecurrenceWeekday[],
    dayType: null as RecurrenceDayType | null,
    startTime: source.startTime,
    endTime: source.endTime,
    title: source.title,
    subject: source.subject,
    type: source.type,
    memo: source.memo,
    isOverride: false,
  };

  if (source.repeat === 'daily') {
    return normalizeRecurrenceRules([{ ...baseRule, kind: 'daily' }], source);
  }

  if (source.repeat === 'weekly') {
    return normalizeRecurrenceRules(
      [
        {
          ...baseRule,
          kind: 'weekday',
          weekdays: [getRecurrenceWeekday(source.date)],
        },
      ],
      source,
    );
  }

  return [];
}

function doesPlanOccurOnDateLegacy(plan: Plan, targetDate: string): boolean {
  if (targetDate.localeCompare(plan.date) < 0) {
    return false;
  }

  if (plan.repeatUntil && targetDate.localeCompare(plan.repeatUntil) > 0) {
    return false;
  }

  if (plan.repeat === 'none') {
    return plan.date === targetDate;
  }

  const baseDate = toDate(plan.date);
  const date = toDate(targetDate);

  if (plan.repeat === 'daily') {
    return true;
  }

  if (plan.repeat === 'weekly') {
    return baseDate.getDay() === date.getDay();
  }

  if (plan.repeat === 'monthly') {
    return baseDate.getDate() === date.getDate();
  }

  return (
    baseDate.getMonth() === date.getMonth() &&
    baseDate.getDate() === date.getDate()
  );
}

export function getPlanRepeatLabel(repeat: MonthEventRepeat): string {
  return (
    PLAN_REPEAT_OPTIONS.find((option) => option.value === repeat)?.label ??
    '繰り返しなし'
  );
}

export function buildPlanOccurrenceKey(planId: string, occurrenceDate: string): string {
  return `${planId}::${occurrenceDate}`;
}

export function getPlanOccurrenceDate(plan: Plan): string {
  return plan.occurrenceDate ?? plan.date;
}

export function getActualOccurrenceKey(actual: Actual): string {
  return buildPlanOccurrenceKey(actual.planId, actual.occurrenceDate);
}

export function doesPlanOccurOnDate(plan: Plan, targetDate: string): boolean {
  if (plan.excludedDates.includes(targetDate)) {
    return false;
  }

  if (plan.recurrenceRules.length > 0) {
    return selectApplicableRecurrenceRule(plan.recurrenceRules, targetDate) !== null;
  }

  return doesPlanOccurOnDateLegacy(plan, targetDate);
}

export function resolvePlanOccurrence(plan: Plan, occurrenceDate: string): Plan {
  const matchingRule = plan.recurrenceRules.length
    ? selectApplicableRecurrenceRule(plan.recurrenceRules, occurrenceDate)
    : null;

  return {
    ...plan,
    title: matchingRule?.title ?? plan.title,
    subject: matchingRule?.subject ?? plan.subject,
    type: matchingRule?.type ?? plan.type,
    memo: matchingRule?.memo ?? plan.memo,
    startTime: matchingRule?.startTime ?? plan.startTime,
    endTime: matchingRule?.endTime ?? plan.endTime,
    sourceDate: plan.sourceDate ?? plan.date,
    date: occurrenceDate,
    occurrenceDate,
    occurrenceKey: buildPlanOccurrenceKey(plan.id, occurrenceDate),
  };
}

export function expandPlansForDate(plans: Plan[], targetDate: string): Plan[] {
  return plans
    .filter((plan) => doesPlanOccurOnDate(plan, targetDate))
    .map((plan) => resolvePlanOccurrence(plan, targetDate));
}

export function expandPlansForDateRange(
  plans: Plan[],
  startDate: string,
  endDate: string,
): Plan[] {
  const occurrences: Plan[] = [];
  let cursor = startDate;

  while (cursor.localeCompare(endDate) <= 0) {
    occurrences.push(...expandPlansForDate(plans, cursor));
    cursor = addDays(cursor, 1);
  }

  return occurrences;
}
