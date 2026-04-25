export type ViewMode = 'month' | 'week' | 'day' | 'todo' | 'report';

export type PlanType =
  | 'study'
  | 'mock-exam'
  | 'school-event'
  | 'cram-school'
  | 'deadline'
  | 'other';

export type PlanSourceType = 'manual' | 'todo';

export interface User {
  id: string;
  email: string;
  username: string;
  avatar: string;
  createdAt: string;
}

export interface UserProfileDraft {
  username: string;
  avatar: string;
}

export type RecurrenceRuleKind = 'daily' | 'day-type' | 'weekday' | 'date';

export type RecurrenceDayType = 'weekday' | 'weekend';

export type RecurrenceWeekday =
  | 'sun'
  | 'mon'
  | 'tue'
  | 'wed'
  | 'thu'
  | 'fri'
  | 'sat';

export interface RecurrenceRule {
  id: string;
  kind: RecurrenceRuleKind;
  startDate: string;
  until: string | null;
  dates: string[];
  weekdays: RecurrenceWeekday[];
  dayType: RecurrenceDayType | null;
  startTime: string;
  endTime: string;
  title?: string;
  subject?: string;
  type?: PlanType;
  memo?: string;
  isOverride: boolean;
}

export type RecurringPlanScope = 'single' | 'future' | 'all';

export interface Plan {
  id: string;
  seriesId: string;
  userId: string;
  title: string;
  subject: string;
  date: string;
  startTime: string;
  endTime: string;
  repeat: MonthEventRepeat;
  repeatUntil: string | null;
  excludedDates: string[];
  recurrenceRules: RecurrenceRule[];
  type: PlanType;
  memo: string;
  createdAt: string;
  updatedAt: string;
  sourceType?: PlanSourceType;
  sourceId?: string | null;
  sourceDate?: string;
  occurrenceDate?: string;
  occurrenceKey?: string;
}

export interface Actual {
  id: string;
  userId: string;
  planId: string;
  occurrenceDate: string;
  actualStartTime: string;
  actualEndTime: string;
  title?: string;
  subject: string;
  isAlignedToPlan?: boolean;
  note: string;
  updatedAt: string;
}

export interface PlanDraft {
  userId: string;
  title: string;
  subject: string;
  date: string;
  startTime: string;
  endTime: string;
  repeat: MonthEventRepeat;
  repeatUntil: string | null;
  excludedDates: string[];
  recurrenceRules: RecurrenceRule[];
  type: PlanType;
  memo: string;
  sourceType?: PlanSourceType;
  sourceId?: string | null;
}

export interface ActualDraft {
  userId: string;
  planId: string;
  occurrenceDate: string;
  actualStartTime: string;
  actualEndTime: string;
  title: string;
  subject: string;
  isAlignedToPlan: boolean;
  note: string;
}

export type MonthEventRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface MonthEventChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface MonthEvent {
  id: string;
  userId: string;
  date: string;
  title: string;
  startTime: string;
  endTime: string;
  repeat: MonthEventRepeat;
  repeatUntil: string | null;
  excludedDates: string[];
  url: string;
  memo: string;
  checklist: MonthEventChecklistItem[];
  locationTags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MonthEventDraft {
  userId: string;
  date: string;
  title: string;
  startTime: string;
  endTime: string;
  repeat: MonthEventRepeat;
  repeatUntil: string | null;
  excludedDates: string[];
  url: string;
  memo: string;
  checklist: MonthEventChecklistItem[];
  locationTags: string[];
}

export interface DayNote {
  id: string;
  userId: string;
  date: string;
  quickMemo: string;
  reflection: string;
  nextFocus: string;
  checkedPlan: boolean;
  checkedRecord: boolean;
  checkedReady: boolean;
  updatedAt: string;
}

export interface DayNoteDraft {
  userId: string;
  date: string;
  quickMemo: string;
  reflection: string;
  nextFocus: string;
  checkedPlan: boolean;
  checkedRecord: boolean;
  checkedReady: boolean;
}

export type TodoStatus = 'open' | 'scheduled' | 'done' | 'archived';

export interface TodoTask {
  id: string;
  userId: string;
  title: string;
  subject: string;
  type: PlanType;
  estimatedMinutes: number | null;
  dueDate: string | null;
  memo: string;
  status: TodoStatus;
  scheduledPlanId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TodoTaskDraft {
  userId: string;
  title: string;
  subject: string;
  type: PlanType;
  estimatedMinutes: number | null;
  dueDate: string | null;
  memo: string;
}

export interface ScheduleTemplate {
  id: string;
  userId: string;
  title: string;
  subject: string;
  type: PlanType;
  weekday: RecurrenceWeekday;
  startTime: string;
  endTime: string;
  memo: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleTemplateDraft {
  userId: string;
  title: string;
  subject: string;
  type: PlanType;
  weekday: RecurrenceWeekday;
  startTime: string;
  endTime: string;
  memo: string;
  active: boolean;
}

export type NaturalLanguageMode = 'add' | 'edit';

export type SuggestionField =
  | 'targetPlan'
  | 'date'
  | 'startTime'
  | 'endTime'
  | 'subject'
  | 'type'
  | 'title'
  | 'memo';

export type SuggestionStatus = 'ready' | 'needs_review' | 'failed';

export interface NaturalLanguageSuggestion {
  mode: NaturalLanguageMode;
  rawText: string;
  confidence: number;
  reason: string;
  source: 'llm' | 'rules';
  providerLabel: string;
  status: SuggestionStatus;
  matchedPlanId?: string;
  parsedPlan: PlanDraft;
  assumptions: string[];
  unresolvedFields: SuggestionField[];
  issues: string[];
}

export interface EvaluationSummary {
  achievement: number;
  consistency: number;
  realism: number;
  comment: string;
}
