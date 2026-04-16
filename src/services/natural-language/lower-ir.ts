import type {
  AttachmentNode,
  BaseScheduleNode,
  EnumerationVariantNode,
  NormalizedEnumerationIntent,
  NormalizedOverrideIntent,
  NormalizedPlanIntent,
  NormalizedSequencedIntent,
  OverrideScheduleNode,
  ScheduleAST,
  ScheduleIR,
  SequencedEventNode,
  TimeRangeSpec,
  TimeSpec,
  UnresolvedField,
  Weekday,
} from "./shared/types";

function isTimeRangeSpec(value: TimeSpec | TimeRangeSpec): value is TimeRangeSpec {
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
    endTime: durationMinutes != null ? addMinutes(timeSpec.hm, durationMinutes) : undefined,
  };
}

function buildUnresolvedFieldsFromTimes(
  startTime?: string,
  endTime?: string,
): UnresolvedField[] {
  const unresolved: UnresolvedField[] = [];

  if (!startTime) {
    unresolved.push("startTime");
  }

  if (!endTime) {
    unresolved.push("endTime");
  }

  return unresolved;
}

function lowerBase(baseNode: BaseScheduleNode): NormalizedPlanIntent {
  const durationMinutes = baseNode.durationSpec?.minutes;
  const timeInfo = buildStartEnd(baseNode.timeSpec, durationMinutes);

  return {
    rawText: baseNode.rawText,
    contentText: baseNode.contentText,
    startTime: timeInfo.startTime,
    endTime: timeInfo.endTime,
    durationMinutes,
    repeatSpec: baseNode.repeatSpec,
    dayType: baseNode.dayTypeSpec?.dayType,
    weekdays: baseNode.weekdaySpecs?.map((weekday) => weekday.weekday),
    assumptions: [],
    unresolvedFields: [],
  };
}

function applyAttachments(base: NormalizedPlanIntent, attachments: AttachmentNode[]): void {
  for (const attachment of attachments) {
    if (attachment.kind !== "AttachedTime") {
      continue;
    }

    const timeInfo = buildStartEnd(attachment.time, base.durationMinutes);

    if (timeInfo.startTime) {
      base.startTime = timeInfo.startTime;
    }

    if (timeInfo.endTime) {
      base.endTime = timeInfo.endTime;
    }

    base.assumptions.push("time-only attached");
  }
}

function splitOverrideByWeekday(override: OverrideScheduleNode): OverrideScheduleNode[] {
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
): NormalizedOverrideIntent {
  const durationMinutes =
    override.replaceDurationSpec?.minutes ?? base.durationMinutes;

  const timeInfo = buildStartEnd(override.replaceTimeSpec, durationMinutes);

  return {
    rawText: override.rawText,
    dayType: override.dayTypeSpec?.dayType,
    weekdays: override.weekdaySpecs?.map((weekday) => weekday.weekday),
    startTime: timeInfo.startTime,
    endTime: timeInfo.endTime,
    durationMinutes,
    assumptions:
      override.replaceDurationSpec == null && base.durationMinutes != null
        ? ["duration inherited from base"]
        : [],
  };
}

function lowerSequence(
  sequence: SequencedEventNode,
  previous: { startTime?: string; endTime?: string },
): NormalizedSequencedIntent {
  const durationMinutes = sequence.durationSpec?.minutes;
  const explicitTimeInfo = buildStartEnd(sequence.timeSpec, durationMinutes);

  let startTime = explicitTimeInfo.startTime;
  let endTime = explicitTimeInfo.endTime;
  const assumptions: string[] = [];

  if (!startTime && previous.endTime) {
    startTime = previous.endTime;
    endTime = durationMinutes != null ? addMinutes(startTime, durationMinutes) : undefined;
    assumptions.push("anchored to previous event endTime");
  }

  return {
    rawText: sequence.rawText,
    contentText: sequence.contentText,
    anchor: "previous-event",
    startTime,
    endTime,
    durationMinutes,
    assumptions,
    unresolvedFields: buildUnresolvedFieldsFromTimes(startTime, endTime),
  };
}

function lowerEnumeration(
  enumeration: EnumerationVariantNode,
  base: NormalizedPlanIntent,
): NormalizedEnumerationIntent {
  return {
    rawText: enumeration.rawText,
    contentText: enumeration.contentText,
    index: enumeration.index,
    baseContentText: base.contentText,
    startTime: base.startTime,
    endTime: base.endTime,
    durationMinutes: base.durationMinutes,
    repeatSpec: base.repeatSpec,
    dayType: base.dayType,
    weekdays: base.weekdays,
    excludedWeekdays: base.excludedWeekdays,
    assumptions: ["enumeration expanded from base"],
    unresolvedFields: [...base.unresolvedFields],
  };
}

export function lowerToIR(ast: ScheduleAST): ScheduleIR {
  const ir: ScheduleIR = {
    sequencedIntents: [],
    enumeratedIntents: [],
    overrideIntents: [],
    diagnostics: [...ast.diagnostics],
  };

  if (!ast.base) {
    return ir;
  }

  const base = lowerBase(ast.base);
  applyAttachments(base, ast.attachments);

  const splitOverrides: OverrideScheduleNode[] = [];
  for (const override of ast.overrides) {
    splitOverrides.push(...splitOverrideByWeekday(override));
  }

  const overrideIntents = splitOverrides.map((override) => lowerOverride(override, base));

  if (base.dayType === "weekday") {
    const overriddenWeekdays = overrideIntents
      .flatMap((override) => override.weekdays ?? []);
    if (overriddenWeekdays.length > 0) {
      base.excludedWeekdays = dedupeWeekdays(overriddenWeekdays);
    }
  }

  base.unresolvedFields = buildUnresolvedFieldsFromTimes(base.startTime, base.endTime);

  let previousEvent = {
    startTime: base.startTime,
    endTime: base.endTime,
  };

  for (const sequence of ast.sequences) {
    const lowered = lowerSequence(sequence, previousEvent);
    ir.sequencedIntents.push(lowered);

    previousEvent = {
      startTime: lowered.startTime,
      endTime: lowered.endTime,
    };
  }

  for (const enumeration of ast.enumerations) {
    ir.enumeratedIntents.push(lowerEnumeration(enumeration, base));
  }

  ir.base = base;
  ir.overrideIntents = overrideIntents;

  return ir;
}