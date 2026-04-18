import type {
  AttachmentNode,
  BaseScheduleNode,
  DateSpec,
  EnumerationVariantNode,
  EventGroupIR,
  EventGroupNode,
  NormalizedEnumerationIntent,
  NormalizedOverrideIntent,
  NormalizedPlanIntent,
  NormalizedSequencedIntent,
  OverrideScheduleNode,
  PipelineOptions,
  ScheduleAST,
  ScheduleIR,
  SequencedEventNode,
  TimeRangeSpec,
  TimeSpec,
  UnresolvedField,
  Weekday,
} from "./shared/types";

function isTimeRangeSpec(
  value: TimeSpec | TimeRangeSpec,
): value is TimeRangeSpec {
  return "start" in value && "end" in value;
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToHm(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutes(hm: string, delta: number): string {
  return minutesToHm(hmToMinutes(hm) + delta);
}

function deriveDurationMinutes(
  timeSpec?: TimeSpec | TimeRangeSpec,
): number | undefined {
  if (!timeSpec || !isTimeRangeSpec(timeSpec)) {
    return undefined;
  }

  const start = hmToMinutes(timeSpec.start.hm);
  let end = hmToMinutes(timeSpec.end.hm);
  if (end <= start) {
    end += 1440;
  }

  return end - start;
}

function dedupeWeekdays(values: Weekday[]): Weekday[] {
  return [...new Set(values)];
}

function buildStartEnd(
  timeSpec: TimeSpec | TimeRangeSpec | undefined,
  durationMinutes?: number,
): { startTime?: string; endTime?: string } {
  if (!timeSpec) {
    return {};
  }

  if (isTimeRangeSpec(timeSpec)) {
    return {
      startTime: timeSpec.start.hm,
      endTime: timeSpec.end.hm,
    };
  }

  return {
    startTime: timeSpec.hm,
    endTime:
      durationMinutes != null ? addMinutes(timeSpec.hm, durationMinutes) : undefined,
  };
}

function buildUnresolvedFields(
  startTime?: string,
  endTime?: string,
  date?: string,
  dateSpec?: DateSpec,
): UnresolvedField[] {
  const unresolved: UnresolvedField[] = [];

  if (dateSpec && !date) {
    unresolved.push("date");
  }
  if (!startTime) {
    unresolved.push("startTime");
  }
  if (!endTime) {
    unresolved.push("endTime");
  }

  return unresolved;
}

function parseReferenceDate(referenceDate?: string): Date {
  if (referenceDate) {
    const normalized = referenceDate.trim();
    const match = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (match) {
      return new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      );
    }

    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return new Date(
        Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
      );
    }
  }

  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addDays(base: Date, delta: number): Date {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function startOfWeek(base: Date): Date {
  const jsDay = base.getUTCDay();
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
  return addDays(base, mondayOffset);
}

function weekdayIndex(weekday: Weekday): number {
  const map: Record<Weekday, number> = {
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
    sun: 0,
  };

  return map[weekday];
}

function weekdaysFromDayType(dayType?: "weekday" | "weekend"): Weekday[] | undefined {
  if (dayType === "weekday") {
    return ["mon", "tue", "wed", "thu", "fri"];
  }
  if (dayType === "weekend") {
    return ["sat", "sun"];
  }
  return undefined;
}

function firstMatchingWeekdayOnOrAfter(base: Date, weekdays: Weekday[]): Date {
  const sorted = dedupeWeekdays(weekdays).sort(
    (a, b) => weekdayIndex(a) - weekdayIndex(b),
  );

  for (let delta = 0; delta < 14; delta += 1) {
    const candidate = addDays(base, delta);
    const candidateIndex = candidate.getUTCDay();
    if (sorted.some((weekday) => weekdayIndex(weekday) === candidateIndex)) {
      return candidate;
    }
  }

  return base;
}

function firstMatchingWeekdayInWeek(weekStart: Date, weekdays: Weekday[]): Date {
  const sorted = dedupeWeekdays(weekdays).sort(
    (a, b) => weekdayIndex(a) - weekdayIndex(b),
  );
  const weekday = sorted[0];
  return addDays(weekStart, weekdayIndex(weekday) === 0 ? 6 : weekdayIndex(weekday) - 1);
}

function normalizeScopedWeekStart(scope: DateSpec["kind"] extends never ? never : DateSpec, reference: Date): Date | undefined {
  if (scope.kind !== "week-scope") {
    return undefined;
  }

  switch (scope.scope) {
    case "this-week":
    case "sometime-this-week":
    case "this-weekend":
      return startOfWeek(reference);
    case "next-week":
    case "sometime-next-week":
    case "next-weekend":
      return addDays(startOfWeek(reference), 7);
    default:
      return undefined;
  }
}

function resolveRepresentativeDate(
  dateSpec: DateSpec | undefined,
  context: {
    weekdays?: Weekday[];
    dayType?: "weekday" | "weekend";
  },
  options: PipelineOptions,
): {
  date?: string;
  dateSpec?: DateSpec;
  assumptions: string[];
} {
  const referenceDate = parseReferenceDate(options.referenceDate);
  const assumptions: string[] = [];
  const targetWeekdays =
    context.weekdays && context.weekdays.length > 0
      ? dedupeWeekdays(context.weekdays)
      : weekdaysFromDayType(context.dayType);

  if (!dateSpec) {
    if (targetWeekdays && targetWeekdays.length > 0) {
      return {
        date: formatDate(firstMatchingWeekdayOnOrAfter(referenceDate, targetWeekdays)),
        assumptions: ["representative date derived from weekday scope"],
      };
    }

    return { assumptions };
  }

  if (dateSpec.kind === "relative-day") {
    return {
      date: formatDate(addDays(referenceDate, dateSpec.offsetDays)),
      assumptions,
    };
  }

  if (dateSpec.kind === "explicit-date") {
    return {
      date: formatDate(
        new Date(
          Date.UTC(
            dateSpec.year ?? referenceDate.getUTCFullYear(),
            dateSpec.month - 1,
            dateSpec.day,
          ),
        ),
      ),
      assumptions,
    };
  }

  if (dateSpec.kind === "month-scope") {
    const year = dateSpec.year ?? referenceDate.getUTCFullYear();
    const inSameMonth =
      referenceDate.getUTCFullYear() === year &&
      referenceDate.getUTCMonth() + 1 === dateSpec.month;

    return {
      date: formatDate(
        inSameMonth
          ? referenceDate
          : new Date(Date.UTC(year, dateSpec.month - 1, 1)),
      ),
      dateSpec,
      assumptions: ["month scope retained"],
    };
  }

  const weekStart = normalizeScopedWeekStart(dateSpec, referenceDate);
  if (!weekStart) {
    return { dateSpec, assumptions: ["date scope retained"] };
  }

  if (dateSpec.scope === "this-weekend" || dateSpec.scope === "next-weekend") {
    return {
      date: formatDate(addDays(weekStart, 5)),
      dateSpec,
      assumptions: ["weekend representative date derived from scope"],
    };
  }

  if (targetWeekdays && targetWeekdays.length > 0) {
    const representativeDate =
      dateSpec.scope === "this-week"
        ? firstMatchingWeekdayOnOrAfter(referenceDate, targetWeekdays)
        : firstMatchingWeekdayInWeek(weekStart, targetWeekdays);

    return {
      date: formatDate(representativeDate),
      dateSpec,
      assumptions: ["representative date derived from scoped weekday"],
    };
  }

  return {
    date: formatDate(
      dateSpec.scope === "this-week" ? referenceDate : weekStart,
    ),
    dateSpec,
    assumptions: ["representative date derived from date scope"],
  };
}

function lowerBase(
  baseNode: BaseScheduleNode,
  options: PipelineOptions,
): NormalizedPlanIntent {
  const durationMinutes =
    baseNode.durationSpec?.minutes ?? deriveDurationMinutes(baseNode.timeSpec);
  const timeInfo = buildStartEnd(baseNode.timeSpec, durationMinutes);
  const weekdays = baseNode.weekdaySpecs?.map((weekday) => weekday.weekday);
  const dateInfo = resolveRepresentativeDate(
    baseNode.dateSpec,
    {
      weekdays,
      dayType: baseNode.dayTypeSpec?.dayType,
    },
    options,
  );

  return {
    rawText: baseNode.rawText,
    contentText: baseNode.contentText,
    date: dateInfo.date,
    dateSpec: dateInfo.dateSpec,
    startTime: timeInfo.startTime,
    endTime: timeInfo.endTime,
    durationMinutes,
    restDurationMinutes: baseNode.restDurationSpec?.minutes,
    setCount: baseNode.setCount,
    repeatSpec: baseNode.repeatSpec,
    dayType: baseNode.dayTypeSpec?.dayType,
    weekdays,
    assumptions: [...dateInfo.assumptions],
    unresolvedFields: [],
  };
}

function applyAttachments(base: NormalizedPlanIntent, attachments: AttachmentNode[]): void {
  for (const attachment of attachments) {
    if (attachment.kind === "AttachedTime") {
      if (attachment.durationSpec) {
        base.durationMinutes = attachment.durationSpec.minutes;
      }

      const timeInfo = buildStartEnd(attachment.time, base.durationMinutes);

      if (timeInfo.startTime) {
        base.startTime = timeInfo.startTime;
      }

      if (timeInfo.endTime) {
        base.endTime = timeInfo.endTime;
      }

      base.assumptions.push("time-only attached");
      continue;
    }

    if (attachment.kind === "AttachedControl") {
      if (attachment.setCount != null) {
        base.setCount = attachment.setCount;
        base.assumptions.push("set-count attached");
      }

      if (attachment.contentText) {
        base.contentText = attachment.contentText;
        base.assumptions.push("content override attached");
      }
    }
  }
}

function splitOverrideByWeekday(
  override: OverrideScheduleNode,
): OverrideScheduleNode[] {
  if (!override.weekdaySpecs || override.weekdaySpecs.length <= 1) {
    return [override];
  }

  return override.weekdaySpecs.map((weekdaySpec) => ({
    ...override,
    weekdaySpecs: [weekdaySpec],
  }));
}

function lowerOverride(
  override: OverrideScheduleNode,
  base: NormalizedPlanIntent,
  options: PipelineOptions,
): NormalizedOverrideIntent {
  const durationMinutes =
    override.replaceDurationSpec?.minutes ??
    base.durationMinutes ??
    deriveDurationMinutes(override.replaceTimeSpec);
  const timeInfo = buildStartEnd(override.replaceTimeSpec, durationMinutes);
  const weekdays = override.weekdaySpecs?.map((weekday) => weekday.weekday);
  const dateInfo = resolveRepresentativeDate(
    override.dateSpec,
    {
      weekdays,
      dayType: override.dayTypeSpec?.dayType,
    },
    options,
  );

  return {
    rawText: override.rawText,
    date: dateInfo.date,
    dateSpec: dateInfo.dateSpec,
    dayType: override.dayTypeSpec?.dayType,
    weekdays,
    startTime: timeInfo.startTime,
    endTime: timeInfo.endTime,
    durationMinutes,
    assumptions: [
      ...dateInfo.assumptions,
      ...(override.replaceDurationSpec == null && base.durationMinutes != null
        ? ["duration inherited from base"]
        : []),
    ],
  };
}

function eventCrossesMidnight(startTime?: string, endTime?: string): boolean {
  return Boolean(
    startTime &&
      endTime &&
      hmToMinutes(endTime) <= hmToMinutes(startTime),
  );
}

function rolloverDate(date: string | undefined, deltaDays: number): string | undefined {
  if (!date) {
    return undefined;
  }
  return formatDate(addDays(parseReferenceDate(date), deltaDays));
}

function lowerSequence(
  sequence: SequencedEventNode,
  previous: {
    date?: string;
    dateSpec?: DateSpec;
    startTime?: string;
    endTime?: string;
  },
  options: PipelineOptions,
): NormalizedSequencedIntent {
  const durationMinutes =
    sequence.durationSpec?.minutes ?? deriveDurationMinutes(sequence.timeSpec);
  const explicitTimeInfo = buildStartEnd(sequence.timeSpec, durationMinutes);
  const explicitDateInfo = resolveRepresentativeDate(sequence.dateSpec, {}, options);

  let date = explicitDateInfo.date;
  let dateSpec = explicitDateInfo.dateSpec;
  let startTime = explicitTimeInfo.startTime;
  let endTime = explicitTimeInfo.endTime;
  const assumptions: string[] = [...explicitDateInfo.assumptions];

  const inheritedDate = !date && !dateSpec && (previous.date || previous.dateSpec);
  if (inheritedDate) {
    date = previous.date;
    dateSpec = previous.dateSpec;
    assumptions.push("date inherited from previous event");
  }

  if (!startTime && previous.endTime) {
    startTime = previous.endTime;
    endTime =
      durationMinutes != null ? addMinutes(startTime, durationMinutes) : undefined;
    assumptions.push("anchored to previous event endTime");
  }

  if (
    inheritedDate &&
    previous.date &&
    eventCrossesMidnight(previous.startTime, previous.endTime)
  ) {
    date = rolloverDate(previous.date, 1);
    assumptions.push("rolled over to next day after cross-midnight previous event");
  }

  if (date && eventCrossesMidnight(startTime, endTime)) {
    assumptions.push("cross-midnight event retains start date");
  }

  return {
    rawText: sequence.rawText,
    contentText: sequence.contentText,
    date,
    dateSpec,
    anchor: "previous-event",
    startTime,
    endTime,
    durationMinutes,
    assumptions,
    unresolvedFields: buildUnresolvedFields(startTime, endTime, date, dateSpec),
  };
}

function lowerEnumeration(
  enumeration: EnumerationVariantNode,
  base: NormalizedPlanIntent,
): NormalizedEnumerationIntent {
  const baseDate =
    base.date &&
    base.dateSpec?.kind === "week-scope" &&
    (base.dateSpec.scope === "sometime-next-week" ||
      base.dateSpec.scope === "sometime-this-week")
      ? rolloverDate(base.date, enumeration.index)
      : base.date;

  return {
    rawText: enumeration.rawText,
    contentText: enumeration.contentText,
    index: enumeration.index,
    baseContentText: base.contentText,
    date: baseDate,
    dateSpec: base.dateSpec,
    startTime: base.startTime,
    endTime: base.endTime,
    durationMinutes: base.durationMinutes,
    restDurationMinutes: base.restDurationMinutes,
    setCount: base.setCount,
    repeatSpec: base.repeatSpec,
    dayType: base.dayType,
    weekdays: base.weekdays,
    excludedWeekdays: base.excludedWeekdays,
    assumptions: ["enumeration expanded from base"],
    unresolvedFields: [...base.unresolvedFields],
  };
}

function subtractWeekdays(source: Weekday[] | undefined, excluded: Weekday[]): Weekday[] | undefined {
  if (!source) {
    return undefined;
  }

  const filtered = source.filter((weekday) => !excluded.includes(weekday));
  return filtered.length > 0 ? filtered : undefined;
}

function lowerGroup(group: EventGroupNode, options: PipelineOptions): EventGroupIR {
  const base = lowerBase(group.base, options);
  applyAttachments(base, group.attachments);

  const splitOverrides: OverrideScheduleNode[] = [];
  for (const override of group.overrides) {
    splitOverrides.push(...splitOverrideByWeekday(override));
  }

  const overrideIntents = splitOverrides.map((override) =>
    lowerOverride(override, base, options),
  );
  const overriddenWeekdays = dedupeWeekdays(
    overrideIntents.flatMap((override) => override.weekdays ?? []),
  );

  if (base.dayType && overriddenWeekdays.length > 0) {
    base.excludedWeekdays = overriddenWeekdays;
  } else if (base.repeatSpec?.kind === "daily" && overriddenWeekdays.length > 0) {
    base.excludedWeekdays = overriddenWeekdays;
  } else if (base.weekdays && overriddenWeekdays.length > 0) {
    base.weekdays = subtractWeekdays(base.weekdays, overriddenWeekdays);
  }

  base.unresolvedFields = buildUnresolvedFields(
    base.startTime,
    base.endTime,
    base.date,
    base.dateSpec,
  );

  let previousEvent = {
    date: base.date,
    dateSpec: base.dateSpec,
    startTime: base.startTime,
    endTime: base.endTime,
  };

  const sequencedIntents: NormalizedSequencedIntent[] = [];
  for (const sequence of group.sequences) {
    const lowered = lowerSequence(sequence, previousEvent, options);
    sequencedIntents.push(lowered);

    previousEvent = {
      date: lowered.date,
      dateSpec: lowered.dateSpec,
      startTime: lowered.startTime,
      endTime: lowered.endTime,
    };
  }

  const enumeratedIntents = group.enumerations.map((enumeration) =>
    lowerEnumeration(enumeration, base),
  );

  return {
    base,
    sequencedIntents,
    enumeratedIntents,
    overrideIntents,
    diagnostics: [],
  };
}

export function lowerToIR(
  ast: ScheduleAST,
  options: PipelineOptions = {},
): ScheduleIR {
  return {
    groups: ast.groups.map((group) => lowerGroup(group, options)),
    diagnostics: [...ast.diagnostics],
  };
}
