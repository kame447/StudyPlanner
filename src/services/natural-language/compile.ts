import type {
  DateSpec,
  EventGroupIR,
  NormalizedEnumerationIntent,
  NormalizedOverrideIntent,
  NormalizedPlanIntent,
  NormalizedSequencedIntent,
  PlanDraft,
  RecurrenceRule,
  ScheduleIR,
  Suggestion,
  UnresolvedField,
  Weekday,
} from "./shared/types";
import { inferCatalogSubject } from "./catalog";
import { inferEventTitle } from "./title";

function hmToMinutes(hm: string): number {
  const [hourText, minuteText] = hm.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function minutesToHm(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addDays(date: string, deltaDays: number): string {
  const base = new Date(`${date}T00:00:00`);
  base.setDate(base.getDate() + deltaDays);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(
    base.getDate(),
  ).padStart(2, "0")}`;
}

function unique<T>(values: T[] | undefined): T[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return [...new Set(values)];
}

function inferSubject(
  contentText?: string,
  rawText?: string,
  titleText?: string,
  contextText?: string,
): string | undefined {
  const localSource = [titleText, contentText, rawText, contextText]
    .filter(Boolean)
    .join(" ");
  const source = localSource.trim();
  return inferCatalogSubject(source);
}

function inferTitle(
  contentText?: string,
  contextText?: string
): string | undefined {
  return inferEventTitle(contentText, contextText);
}

function parseIsoDate(date?: string): Date | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function deriveRecurrenceUntil(
  dateSpec?: DateSpec,
  startDate?: string,
): string | null | undefined {
  if (!dateSpec) {
    return undefined;
  }

  if (dateSpec.kind === "month-scope") {
    const year =
      dateSpec.year ??
      (parseIsoDate(startDate)?.getFullYear() ?? new Date().getFullYear());
    const endOfMonth = new Date(year, dateSpec.month, 0);
    return formatIsoDate(endOfMonth);
  }

  if (dateSpec.kind !== "week-scope") {
    return undefined;
  }

  const anchor = parseIsoDate(startDate);
  if (!anchor) {
    return undefined;
  }

  const day = anchor.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(anchor);
  weekStart.setDate(anchor.getDate() + mondayOffset);
  const weekEnd = new Date(weekStart);

  if (dateSpec.scope === "this-weekend" || dateSpec.scope === "next-weekend") {
    weekEnd.setDate(weekStart.getDate() + 6);
    return formatIsoDate(weekEnd);
  }

  weekEnd.setDate(weekStart.getDate() + 6);
  return formatIsoDate(weekEnd);
}

function toRecurrenceRules(input: {
  dayType?: "weekday" | "weekend";
  weekdays?: Weekday[];
  excludedWeekdays?: Weekday[];
  repeatKind?: "daily" | "weekly" | "monthly" | "unknown";
  startTime?: string;
  endTime?: string;
  startDate?: string;
  dateSpec?: DateSpec;
  isOverride?: boolean;
}): RecurrenceRule[] | undefined {
  const until = deriveRecurrenceUntil(input.dateSpec, input.startDate);

  if (input.dayType) {
    return [
      {
        kind: "day-type",
        dayType: input.dayType,
        excludedWeekdays: unique(input.excludedWeekdays),
        startDate: input.startDate,
        until,
        startTime: input.startTime,
        endTime: input.endTime,
        isOverride: input.isOverride,
      },
    ];
  }

  if (input.weekdays && input.weekdays.length > 0) {
    return [
      {
        kind: "weekday",
        weekdays: unique(input.weekdays),
        excludedWeekdays: unique(input.excludedWeekdays),
        startDate: input.startDate,
        until,
        startTime: input.startTime,
        endTime: input.endTime,
        isOverride: input.isOverride,
      },
    ];
  }

  if (input.repeatKind === "daily") {
    return [
      {
        kind: "daily",
        excludedWeekdays: unique(input.excludedWeekdays),
        startDate: input.startDate,
        until,
        startTime: input.startTime,
        endTime: input.endTime,
        isOverride: input.isOverride,
      },
    ];
  }

  return undefined;
}

function unresolvedFromTime(
  startTime?: string,
  endTime?: string
): UnresolvedField[] {
  const result: UnresolvedField[] = [];

  if (!startTime) {
    result.push("startTime");
  }

  if (!endTime) {
    result.push("endTime");
  }

  return result;
}

function buildBaseDraft(base: NormalizedPlanIntent): PlanDraft {
  const title = inferTitle(base.contentText);
  const subject = inferSubject(base.contentText, base.rawText, title);

  return {
    rawText: base.rawText,
    title,
    subject,
    contentText: base.contentText,
    date: base.date,
    dateSpec: base.dateSpec,
    startTime: base.startTime,
    endTime: base.endTime,
    durationMinutes: base.durationMinutes,
    recurrenceRules: toRecurrenceRules({
      dayType: base.dayType,
      weekdays: base.weekdays,
      excludedWeekdays: base.excludedWeekdays,
      repeatKind: base.repeatSpec?.kind,
      startDate: base.date,
      dateSpec: base.dateSpec,
      startTime: base.startTime,
      endTime: base.endTime,
    }),
  };
}

function buildOverrideDraft(
  override: NormalizedOverrideIntent,
  base: NormalizedPlanIntent
): PlanDraft {
  const title = inferTitle(override.rawText, base.contentText);
  const subject = inferSubject(
    override.rawText,
    override.rawText,
    title,
    base.contentText,
  );

  return {
    rawText: override.rawText,
    title,
    subject,
    contentText: override.rawText,
    date: override.date,
    dateSpec: override.dateSpec,
    startTime: override.startTime,
    endTime: override.endTime,
    durationMinutes: override.durationMinutes,
    recurrenceRules: toRecurrenceRules({
      dayType: override.dayType,
      weekdays: override.weekdays,
      startDate: override.date,
      dateSpec: override.dateSpec,
      startTime: override.startTime,
      endTime: override.endTime,
      isOverride: true,
    }),
  };
}

function buildSequencedDraft(sequence: NormalizedSequencedIntent): PlanDraft {
  const title = inferTitle(sequence.contentText);
  const subject = inferSubject(sequence.contentText, sequence.rawText, title);

  return {
    rawText: sequence.rawText,
    title,
    subject,
    contentText: sequence.contentText,
    date: sequence.date,
    dateSpec: sequence.dateSpec,
    startTime: sequence.startTime,
    endTime: sequence.endTime,
    durationMinutes: sequence.durationMinutes,
  };
}

function buildEnumerationDraft(item: NormalizedEnumerationIntent): PlanDraft {
  const title = inferTitle(item.contentText, item.baseContentText);
  const subject = inferSubject(
    item.contentText,
    item.rawText,
    title,
    item.baseContentText,
  );

  return {
    rawText: item.rawText,
    title,
    subject,
    contentText: item.contentText,
    date: item.date,
    dateSpec: item.dateSpec,
    startTime: item.startTime,
    endTime: item.endTime,
    durationMinutes: item.durationMinutes,
    recurrenceRules: toRecurrenceRules({
      dayType: item.dayType,
      weekdays: item.weekdays,
      excludedWeekdays: item.excludedWeekdays,
      repeatKind: item.repeatSpec?.kind,
      startDate: item.date,
      dateSpec: item.dateSpec,
      startTime: item.startTime,
      endTime: item.endTime,
    }),
  };
}

function expandLoopedBaseSuggestions(
  base: NormalizedPlanIntent,
): Suggestion[] | null {
  if (
    !base.setCount ||
    base.setCount <= 1 ||
    !base.startTime ||
    base.durationMinutes == null
  ) {
    return null;
  }

  const durationMinutes = base.durationMinutes;
  const intervalMinutes =
    durationMinutes + (base.restDurationMinutes ?? 0);
  const baseStartMinutes = hmToMinutes(base.startTime);

  return Array.from({ length: base.setCount }, (_, index) => {
    const startOffsetMinutes = baseStartMinutes + intervalMinutes * index;
    const dayDelta = Math.floor(startOffsetMinutes / 1440);
    const startTime = minutesToHm(startOffsetMinutes);
    const endTime = minutesToHm(startOffsetMinutes + durationMinutes);
    const date =
      base.date && dayDelta > 0 ? addDays(base.date, dayDelta) : base.date;
    const parsedPlan = buildBaseDraft({
      ...base,
      date,
      startTime,
      endTime,
    });

    return {
      rawText: base.rawText,
      parsedPlan,
      assumptions: [
        ...base.assumptions,
        "loop expanded from set count",
        ...(base.restDurationMinutes != null
          ? ["rest duration applied between loop iterations"]
          : []),
      ],
      unresolvedFields: [...base.unresolvedFields].filter(
        (field) => field !== "startTime" && field !== "endTime",
      ),
      confidence: 0.89,
    } satisfies Suggestion;
  });
}

function shouldRetainSetCountWithoutExpansion(group: EventGroupIR): boolean {
  return (
    Boolean(group.base.repeatSpec) ||
    Boolean(group.base.dayType) ||
    Boolean(group.base.weekdays?.length) ||
    Boolean(group.base.excludedWeekdays?.length) ||
    group.overrideIntents.length > 0 ||
    group.enumeratedIntents.length > 0
  );
}

function compileGroup(group: EventGroupIR): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const loopedBaseSuggestions = shouldRetainSetCountWithoutExpansion(group)
    ? null
    : expandLoopedBaseSuggestions(group.base);
  const retainedSetCountAssumption =
    group.base.setCount && group.base.setCount > 1 && !loopedBaseSuggestions
      ? [
          "set-count は recurrence / override / enumeration と競合するため未展開のまま保持しました",
        ]
      : [];

  if (group.enumeratedIntents.length === 0) {
    if (loopedBaseSuggestions) {
      suggestions.push(...loopedBaseSuggestions);
    } else {
      suggestions.push({
        rawText: group.base.rawText,
        parsedPlan: buildBaseDraft(group.base),
        assumptions: [...group.base.assumptions, ...retainedSetCountAssumption],
        unresolvedFields: [...group.base.unresolvedFields],
        confidence: 0.9,
      });
    }
  }

  for (const enumeration of group.enumeratedIntents) {
    suggestions.push({
      rawText: enumeration.rawText,
      parsedPlan: buildEnumerationDraft(enumeration),
      assumptions: [...enumeration.assumptions, ...retainedSetCountAssumption],
      unresolvedFields: [...enumeration.unresolvedFields],
      confidence: 0.89,
    });
  }

  for (const sequence of group.sequencedIntents) {
    suggestions.push({
      rawText: sequence.rawText,
      parsedPlan: buildSequencedDraft(sequence),
      assumptions: [...sequence.assumptions],
      unresolvedFields: [...sequence.unresolvedFields],
      confidence: 0.88,
    });
  }

  for (const override of group.overrideIntents) {
    suggestions.push({
      rawText: override.rawText,
      parsedPlan: buildOverrideDraft(override, group.base),
      assumptions: [...group.base.assumptions, ...override.assumptions],
      unresolvedFields: unresolvedFromTime(
        override.startTime,
        override.endTime
      ),
      confidence: 0.85,
    });
  }

  return suggestions;
}

export function compileToSuggestions(ir: ScheduleIR): Suggestion[] {
  return ir.groups.flatMap((group) => compileGroup(group));
}
