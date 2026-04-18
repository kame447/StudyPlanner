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

export interface RelativeDaySpec {
  raw: string;
  kind: "relative-day";
  offsetDays: number;
}

export interface ExplicitDateSpec {
  raw: string;
  kind: "explicit-date";
  year?: number;
  month: number;
  day: number;
}

export interface MonthScopeSpec {
  raw: string;
  kind: "month-scope";
  year?: number;
  month: number;
}

export interface WeekScopeSpec {
  raw: string;
  kind: "week-scope";
  scope:
    | "this-week"
    | "next-week"
    | "this-weekend"
    | "next-weekend"
    | "sometime-this-week"
    | "sometime-next-week";
}

export interface ExplicitUntilSpec {
  raw: string;
  kind: "explicit-until";
  year?: number;
  month: number;
  day: number;
}

export type DateSpec =
  | RelativeDaySpec
  | ExplicitDateSpec
  | MonthScopeSpec
  | WeekScopeSpec;

export interface WeekdayGroupSpec {
  raw: string;
  weekdays: Weekday[];
}

export interface SetCountSpec {
  raw: string;
  count: number;
}

export type StructuralTokenKind =
  | "LOOP_CUE"
  | "CONTROL"
  | "CONTENT_INTRODUCER"
  | "INSTRUCTION_TAIL"
  | "REST"
  | "OVERRIDE"
  | "CONNECTIVE"
  | "SET_COUNT";

export type Token =
  | { kind: "DATE"; raw: string; value: DateSpec }
  | { kind: "TIME"; raw: string; value: TimeSpec }
  | { kind: "TIME_RANGE"; raw: string; value: TimeRangeSpec }
  | { kind: "DURATION"; raw: string; value: DurationSpec }
  | { kind: "WEEKDAY"; raw: string; value: WeekdaySpec }
  | { kind: "WEEKDAY_GROUP"; raw: string; value: WeekdayGroupSpec }
  | { kind: "DAYTYPE"; raw: string; value: DayTypeSpec }
  | { kind: "REPEAT"; raw: string; value: RepeatSpec }
  | { kind: "SET_COUNT"; raw: string; value: SetCountSpec }
  | { kind: "LOOP_CUE"; raw: string }
  | { kind: "CONTROL"; raw: string }
  | { kind: "CONTENT_INTRODUCER"; raw: string }
  | { kind: "INSTRUCTION_TAIL"; raw: string }
  | { kind: "REST"; raw: string; value: DurationSpec }
  | { kind: "OVERRIDE"; raw: string }
  | { kind: "CONNECTIVE"; raw: string }
  | { kind: "CONTENT"; raw: string };

export type ClauseNode =
  | { kind: "EventClause"; tokens: Token[]; spanText: string; sentenceIndex: number }
  | { kind: "TimeOnlyClause"; tokens: Token[]; spanText: string; sentenceIndex: number }
  | { kind: "OverrideClause"; tokens: Token[]; spanText: string; sentenceIndex: number }
  | { kind: "EnumerationClause"; tokens: Token[]; spanText: string; sentenceIndex: number }
  | { kind: "InstructionClause"; tokens: Token[]; spanText: string; sentenceIndex: number };

export interface BaseScheduleNode {
  rawText: string;
  contentText?: string;
  dateSpec?: DateSpec;
  timeSpec?: TimeSpec | TimeRangeSpec;
  durationSpec?: DurationSpec;
  restDurationSpec?: DurationSpec;
  setCount?: number;
  repeatSpec?: RepeatSpec;
  dayTypeSpec?: DayTypeSpec;
  weekdaySpecs?: WeekdaySpec[];
}

export interface OverrideScheduleNode {
  rawText: string;
  dateSpec?: DateSpec;
  weekdaySpecs?: WeekdaySpec[];
  dayTypeSpec?: DayTypeSpec;
  replaceTimeSpec?: TimeSpec | TimeRangeSpec;
  replaceDurationSpec?: DurationSpec;
}

export type AttachmentNode = {
  kind: "AttachedTime";
  target: "nearest-event";
  time?: TimeSpec | TimeRangeSpec;
  durationSpec?: DurationSpec;
  rawText: string;
} | {
  kind: "AttachedControl";
  target: "nearest-event";
  setCount?: number;
  contentText?: string;
  rawText: string;
};

export interface SequenceRelation {
  kind: "after-previous-event";
  rawText: string;
}

export interface SequencedEventNode {
  rawText: string;
  contentText?: string;
  dateSpec?: DateSpec;
  timeSpec?: TimeSpec | TimeRangeSpec;
  durationSpec?: DurationSpec;
  relation: SequenceRelation;
}

export interface EnumerationVariantNode {
  rawText: string;
  contentText: string;
  index: number;
}

export interface EventGroupNode {
  base: BaseScheduleNode;
  sequences: SequencedEventNode[];
  overrides: OverrideScheduleNode[];
  attachments: AttachmentNode[];
  enumerations: EnumerationVariantNode[];
}

export interface ScheduleAST {
  groups: EventGroupNode[];
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
  date?: string;
  dateSpec?: DateSpec;
  untilDate?: string;
  untilSpec?: ExplicitUntilSpec;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  restDurationMinutes?: number;
  setCount?: number;
  repeatSpec?: RepeatSpec;
  dayType?: "weekday" | "weekend";
  weekdays?: Weekday[];
  excludedWeekdays?: Weekday[];
  assumptions: string[];
  unresolvedFields: UnresolvedField[];
}

export interface NormalizedOverrideIntent {
  rawText: string;
  date?: string;
  dateSpec?: DateSpec;
  untilDate?: string;
  untilSpec?: ExplicitUntilSpec;
  dayType?: "weekday" | "weekend";
  weekdays?: Weekday[];
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  assumptions: string[];
}

export interface NormalizedSequencedIntent {
  rawText: string;
  contentText?: string;
  date?: string;
  dateSpec?: DateSpec;
  anchor: "previous-event";
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  assumptions: string[];
  unresolvedFields: UnresolvedField[];
}

export interface NormalizedEnumerationIntent {
  rawText: string;
  contentText: string;
  index: number;
  baseContentText?: string;
  date?: string;
  dateSpec?: DateSpec;
  untilDate?: string;
  untilSpec?: ExplicitUntilSpec;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  restDurationMinutes?: number;
  setCount?: number;
  repeatSpec?: RepeatSpec;
  dayType?: "weekday" | "weekend";
  weekdays?: Weekday[];
  excludedWeekdays?: Weekday[];
  assumptions: string[];
  unresolvedFields: UnresolvedField[];
}

export interface EventGroupIR {
  base: NormalizedPlanIntent;
  sequencedIntents: NormalizedSequencedIntent[];
  enumeratedIntents: NormalizedEnumerationIntent[];
  overrideIntents: NormalizedOverrideIntent[];
  diagnostics: Diagnostic[];
}

export interface ScheduleIR {
  groups: EventGroupIR[];
  diagnostics: Diagnostic[];
}

export interface RecurrenceRule {
  id?: string;
  kind: "daily" | "day-type" | "weekday" | "date";
  startDate?: string;
  until?: string | null;
  dates?: string[];
  dayType?: "weekday" | "weekend";
  weekdays?: Weekday[];
  excludedWeekdays?: Weekday[];
  startTime?: string;
  endTime?: string;
  title?: string;
  subject?: string;
  type?: string;
  memo?: string;
  isOverride?: boolean;
}

export interface PlanDraft {
  rawText: string;
  title?: string;
  subject?: string;
  contentText?: string;
  date?: string;
  dateSpec?: DateSpec;
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

export interface PipelineOptions {
  referenceDate?: string;
}
