import { addDays, minutesFromTime, timeFromMinutes } from "../../lib/date";
import { selectApplicableRecurrenceRule } from "../../lib/planRecurrence";
import type {
  NaturalLanguageSuggestion,
  Plan,
  PlanType,
  SuggestionField,
} from "../../types/domain";
import type {
  PlanningIntent,
  PlanningIntentTask,
  Weekday,
} from "./shared/types";

export interface PlanAllocationInput {
  intent: PlanningIntent;
  existingPlans: Plan[];
  selectedDate: string;
  userId: string;
}

interface NormalizedAllocationTask {
  title: string;
  subject: string;
  type: PlanType;
  sessionCount: number;
  sessionMinutes: number;
  preferredStartTime?: string;
}

interface TimeSlot {
  startTime: string;
  endTime: string;
}

const DEFAULT_SESSION_MINUTES = 60;
const DEFAULT_START_TIME = "20:00";
const MAX_ALLOCATION_WINDOW_DAYS = 31;
const FALLBACK_START_TIMES = [
  DEFAULT_START_TIME,
  "19:00",
  "18:00",
  "21:00",
  "06:30",
  "07:00",
];
const PLAN_TYPES: PlanType[] = [
  "study",
  "mock-exam",
  "school-event",
  "cram-school",
  "deadline",
  "other",
];
const WEEKDAY_BY_DATE_INDEX: Weekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

function uniqueValues<T>(values: T[]): T[] {
  return values.filter((value, index, array) => array.indexOf(value) === index);
}

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isClockTime(value: string | undefined): value is string {
  return Boolean(value && /^\d{2}:\d{2}$/.test(value));
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.ceil(value);
}

function normalizePlanType(value: string | undefined): PlanType {
  return PLAN_TYPES.find((type) => type === value) ?? "study";
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function inferSubject(title: string, subject: string | undefined): string {
  if (subject) {
    return subject;
  }

  if (/英語|英文|英単語|長文|文法/.test(title)) {
    return "英語";
  }

  if (/数学|数IA|数I|数A|数II|数B|数III|チャート/.test(title)) {
    return "数学";
  }

  if (/物理/.test(title)) {
    return "物理";
  }

  if (/勉強|学習|自習/.test(title)) {
    return "勉強";
  }

  return title;
}

function normalizeTask(task: PlanningIntentTask): NormalizedAllocationTask {
  const title = normalizeText(task.title) ?? normalizeText(task.subject) ?? "学習";
  const preferredStartTime = isClockTime(task.preferredStartTime)
    ? task.preferredStartTime
    : undefined;
  const preferredEndTime = isClockTime(task.preferredEndTime)
    ? task.preferredEndTime
    : undefined;
  const explicitDuration =
    preferredStartTime && preferredEndTime
      ? minutesFromTime(preferredEndTime) - minutesFromTime(preferredStartTime)
      : undefined;
  const sessionCount = normalizePositiveInteger(task.sessionCount);
  const totalMinutes = normalizePositiveInteger(task.totalMinutes);
  const sessionMinutes =
    normalizePositiveInteger(task.sessionMinutes) ??
    (totalMinutes && sessionCount ? Math.ceil(totalMinutes / sessionCount) : undefined) ??
    (explicitDuration && explicitDuration > 0 ? explicitDuration : undefined) ??
    DEFAULT_SESSION_MINUTES;

  return {
    title,
    subject: inferSubject(title, normalizeText(task.subject)),
    type: normalizePlanType(task.type),
    sessionCount:
      sessionCount ?? (totalMinutes ? Math.ceil(totalMinutes / sessionMinutes) : 1),
    sessionMinutes,
    preferredStartTime,
  };
}

function getDateWeekday(date: string): Weekday {
  return WEEKDAY_BY_DATE_INDEX[new Date(`${date}T00:00:00`).getDay()] ?? "sun";
}

function isDateAllowed(intent: PlanningIntent, date: string): boolean {
  const weekday = getDateWeekday(date);
  const weekdays = intent.window.weekdays ?? [];
  const excludedWeekdays = intent.window.excludedWeekdays ?? [];

  if (weekdays.length > 0 && !weekdays.includes(weekday)) {
    return false;
  }

  return !excludedWeekdays.includes(weekday);
}

function buildCandidateDates(intent: PlanningIntent, selectedDate: string): string[] {
  const rawStartDate = isIsoDate(intent.window.startDate)
    ? intent.window.startDate
    : selectedDate;
  const startDate =
    rawStartDate.localeCompare(selectedDate) < 0 ? selectedDate : rawStartDate;
  const endDate = isIsoDate(intent.window.endDate)
    ? intent.window.endDate
    : addDays(startDate, 6);
  const dates: string[] = [];
  let cursor = startDate;

  for (
    let index = 0;
    index < MAX_ALLOCATION_WINDOW_DAYS && cursor.localeCompare(endDate) <= 0;
    index += 1
  ) {
    if (isDateAllowed(intent, cursor)) {
      dates.push(cursor);
    }

    cursor = addDays(cursor, 1);
  }

  return dates.length > 0 ? dates : [selectedDate];
}

function isLegacyRepeatActiveOnDate(plan: Plan, date: string): boolean {
  if (plan.excludedDates.includes(date)) {
    return false;
  }

  if (date.localeCompare(plan.date) < 0) {
    return false;
  }

  if (plan.repeatUntil && date.localeCompare(plan.repeatUntil) > 0) {
    return false;
  }

  if (plan.repeat === "daily") {
    return true;
  }

  if (plan.repeat === "weekly") {
    return getDateWeekday(plan.date) === getDateWeekday(date);
  }

  if (plan.repeat === "monthly") {
    return plan.date.slice(8, 10) === date.slice(8, 10);
  }

  if (plan.repeat === "yearly") {
    return plan.date.slice(5) === date.slice(5);
  }

  return plan.date === date;
}

function getExistingPlanSlot(plan: Plan, date: string): TimeSlot | null {
  const recurrenceRule = selectApplicableRecurrenceRule(
    plan.recurrenceRules ?? [],
    date,
  );

  if (recurrenceRule) {
    return {
      startTime: recurrenceRule.startTime,
      endTime: recurrenceRule.endTime,
    };
  }

  if (!isLegacyRepeatActiveOnDate(plan, date)) {
    return null;
  }

  return {
    startTime: plan.startTime,
    endTime: plan.endTime,
  };
}

function getSuggestionSlot(
  suggestion: NaturalLanguageSuggestion,
  date: string,
): TimeSlot | null {
  if (suggestion.parsedPlan.date !== date) {
    return null;
  }

  return {
    startTime: suggestion.parsedPlan.startTime,
    endTime: suggestion.parsedPlan.endTime,
  };
}

function normalizeEndMinutes(startTime: string, endTime: string): number {
  const startMinutes = minutesFromTime(startTime);
  const endMinutes = minutesFromTime(endTime);
  return endMinutes <= startMinutes ? endMinutes + 1440 : endMinutes;
}

function overlaps(left: TimeSlot, right: TimeSlot): boolean {
  const leftStart = minutesFromTime(left.startTime);
  const leftEnd = normalizeEndMinutes(left.startTime, left.endTime);
  const rightStart = minutesFromTime(right.startTime);
  const rightEnd = normalizeEndMinutes(right.startTime, right.endTime);

  return leftStart < rightEnd && rightStart < leftEnd;
}

function hasConflict(
  slot: TimeSlot,
  date: string,
  existingPlans: Plan[],
  allocatedSuggestions: NaturalLanguageSuggestion[],
): boolean {
  return (
    existingPlans.some((plan) => {
      const existingSlot = getExistingPlanSlot(plan, date);
      return existingSlot ? overlaps(slot, existingSlot) : false;
    }) ||
    allocatedSuggestions.some((suggestion) => {
      const allocatedSlot = getSuggestionSlot(suggestion, date);
      return allocatedSlot ? overlaps(slot, allocatedSlot) : false;
    })
  );
}

function buildEndTime(startTime: string, durationMinutes: number): string | null {
  const endMinutes = minutesFromTime(startTime) + durationMinutes;

  if (endMinutes > 24 * 60) {
    return null;
  }

  return timeFromMinutes(endMinutes);
}

function findSlot(
  task: NormalizedAllocationTask,
  date: string,
  input: PlanAllocationInput,
  allocatedSuggestions: NaturalLanguageSuggestion[],
): TimeSlot | null {
  const startTimes = uniqueValues([
    task.preferredStartTime ?? DEFAULT_START_TIME,
    ...FALLBACK_START_TIMES,
  ]);

  for (const startTime of startTimes) {
    const endTime = buildEndTime(startTime, task.sessionMinutes);

    if (!endTime) {
      continue;
    }

    const slot = { startTime, endTime };

    if (
      !input.intent.nonOverlap ||
      !hasConflict(slot, date, input.existingPlans, allocatedSuggestions)
    ) {
      return slot;
    }
  }

  return null;
}

function createSuggestion(
  input: PlanAllocationInput,
  task: NormalizedAllocationTask,
  date: string,
  slot: TimeSlot,
  sessionIndex: number,
): NaturalLanguageSuggestion {
  return {
    mode: "add",
    rawText: input.intent.rawText,
    confidence: 0.74,
    reason: "PlanningIntent を deterministic planner で具体予定に割り当てました。",
    source: "rules",
    providerLabel: "deterministic planner",
    status: "ready",
    parsedPlan: {
      userId: input.userId,
      title: task.title,
      subject: task.subject,
      date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      repeat: "none",
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      type: task.type,
      memo:
        task.sessionCount > 1
          ? `${sessionIndex + 1}/${task.sessionCount} 回目`
          : "",
    },
    assumptions: [
      ...input.intent.assumptions,
      "AI は PlanningIntent 抽出だけに使い、具体日程は deterministic planner で決定しました。",
    ],
    unresolvedFields: [],
    issues: [],
  };
}

function createFailedSuggestion(
  input: PlanAllocationInput,
  unresolvedFields: SuggestionField[],
): NaturalLanguageSuggestion {
  return {
    mode: "add",
    rawText: input.intent.rawText,
    confidence: 0.42,
    reason: "PlanningIntent の制約を満たす空き枠を deterministic planner で確定できませんでした。",
    source: "rules",
    providerLabel: "deterministic planner",
    status: "failed",
    parsedPlan: {
      userId: input.userId,
      title: "学習",
      subject: "学習",
      date: input.selectedDate,
      startTime: DEFAULT_START_TIME,
      endTime: timeFromMinutes(minutesFromTime(DEFAULT_START_TIME) + DEFAULT_SESSION_MINUTES),
      repeat: "none",
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      type: "study",
      memo: "",
    },
    assumptions: input.intent.assumptions,
    unresolvedFields,
    issues: ["allocation_unresolved"],
  };
}

export function allocatePlanningIntent(
  input: PlanAllocationInput,
): NaturalLanguageSuggestion[] {
  const tasks = (input.intent.tasks.length > 0
    ? input.intent.tasks
    : [{ title: "学習" }]
  ).map(normalizeTask);
  const candidateDates = buildCandidateDates(input.intent, input.selectedDate);
  const suggestions: NaturalLanguageSuggestion[] = [];
  let unallocatedSessions = 0;

  tasks.forEach((task, taskIndex) => {
    for (let sessionIndex = 0; sessionIndex < task.sessionCount; sessionIndex += 1) {
      let allocated = false;

      for (let offset = 0; offset < candidateDates.length; offset += 1) {
        const dateIndex = (taskIndex + sessionIndex + offset) % candidateDates.length;
        const date = candidateDates[dateIndex];
        const slot = findSlot(task, date, input, suggestions);

        if (!slot) {
          continue;
        }

        suggestions.push(createSuggestion(input, task, date, slot, sessionIndex));
        allocated = true;
        break;
      }

      if (!allocated) {
        unallocatedSessions += 1;
      }
    }
  });

  if (suggestions.length === 0) {
    return [createFailedSuggestion(input, ["date", "startTime"])];
  }

  if (unallocatedSessions > 0) {
    return suggestions.map((suggestion) => ({
      ...suggestion,
      status: "needs_review",
      assumptions: [
        ...suggestion.assumptions,
        `${unallocatedSessions} 件は空き枠不足で割り当てられませんでした。`,
      ],
      issues: [...suggestion.issues, "allocation_incomplete"],
    }));
  }

  return suggestions;
}
