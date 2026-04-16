import type { Diagnostic } from "./diagnostics";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface TimeSpec {
  raw: string;
  hour: number;
  minute: number;
  hm: string;
}

export interface TimeRangeSpec {
  raw: string;
  start: TimeSpec;
  end: TimeSpec;
}

export interface DurationSpec {
  raw: string;
  minutes: number;
}

export interface WeekdaySpec {
  raw: string;
  weekday: Weekday;
}

export interface DayTypeSpec {
  raw: string;
  dayType: "weekday" | "weekend";
}

export interface RepeatSpec {
  raw: string;
  kind: "daily" | "weekly" | "monthly" | "unknown";
  anchor?: "morning" | "night";
}

export type Token =
  | { kind: "TIME"; raw: string; value: TimeSpec }
  | { kind: "TIME_RANGE"; raw: string; value: TimeRangeSpec }
  | { kind: "DURATION"; raw: string; value: DurationSpec }
  | { kind: "WEEKDAY"; raw: string; value: WeekdaySpec }
  | { kind: "DAYTYPE"; raw: string; value: DayTypeSpec }
  | { kind: "REPEAT"; raw: string; value: RepeatSpec }
  | { kind: "OVERRIDE"; raw: string }
  | { kind: "CONNECTIVE"; raw: string }
  | { kind: "CONTENT"; raw: string };

export type ClauseNode =
  | { kind: "EventClause"; tokens: Token[]; spanText: string }
  | { kind: "TimeOnlyClause"; tokens: Token[]; spanText: string }
  | { kind: "OverrideClause"; tokens: Token[]; spanText: string }
  | { kind: "EnumerationClause"; tokens: Token[]; spanText: string }
  | { kind: "InstructionClause"; tokens: Token[]; spanText: string };

export interface BaseScheduleNode {
  rawText: string;
  contentText?: string;
  timeSpec?: TimeSpec | TimeRangeSpec;
  durationSpec?: DurationSpec;
  repeatSpec?: RepeatSpec;
  dayTypeSpec?: DayTypeSpec;
  weekdaySpecs?: WeekdaySpec[];
}

export interface OverrideScheduleNode {
  rawText: string;
  weekdaySpecs?: WeekdaySpec[];
  dayTypeSpec?: DayTypeSpec;
  replaceTimeSpec?: TimeSpec | TimeRangeSpec;
  replaceDurationSpec?: DurationSpec;
}

export type AttachmentNode = {
  kind: "AttachedTime";
  target: "nearest-event";
  time: TimeSpec | TimeRangeSpec;
  rawText: string;
};

export interface ScheduleAST {
  base: BaseScheduleNode | null;
  overrides: OverrideScheduleNode[];
  attachments: AttachmentNode[];
  enumerations: never[];
  diagnostics: Diagnostic[];
}

export type UnresolvedField =
  | "date"
  | "startTime"
  | "endTime"
  | "subject"
  | "title"
  | "type";

export interface NormalizedPlanIntent {
  rawText: string;
  contentText?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  repeatSpec?: RepeatSpec;
  dayType?: "weekday" | "weekend";
  weekdays?: Weekday[];
  excludedWeekdays?: Weekday[];
  assumptions: string[];
  unresolvedFields: UnresolvedField[];
}

export interface NormalizedOverrideIntent {
  rawText: string;
  dayType?: "weekday" | "weekend";
  weekdays?: Weekday[];
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  assumptions: string[];
}

export interface ScheduleIR {
  base?: NormalizedPlanIntent;
  overrideIntents: NormalizedOverrideIntent[];
  diagnostics: Diagnostic[];
}

export interface RecurrenceRule {
  kind: "daily" | "day-type" | "weekday";
  dayType?: "weekday" | "weekend";
  weekdays?: Weekday[];
  excludedWeekdays?: Weekday[];
  startTime?: string;
  endTime?: string;
}

export interface PlanDraft {
  rawText: string;
  title?: string;
  subject?: string;
  contentText?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  recurrenceRules?: RecurrenceRule[];
}

export interface Suggestion {
  rawText: string;
  parsedPlan: PlanDraft;
  assumptions: string[];
  unresolvedFields: UnresolvedField[];
  confidence?: number;
}
