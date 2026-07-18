export type ViewMode =
  | 'month'
  | 'week'
  | 'day'
  | 'todo'
  | 'report'
  | 'timetable'
  | 'bookshelf';

export type PlanType =
  | 'study'
  | 'mock-exam'
  | 'school-event'
  | 'cram-school'
  | 'deadline'
  | 'other';

export type PlanSourceType = 'manual' | 'todo' | 'timetable' | 'weekly-planning';

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

export interface AdminProfile {
  id: string;
  email: string;
  username: string;
  avatar: string;
  createdAt: string;
}

export interface AdminDashboardStats {
  todayStudyMinutes: number;
  weekStudyMinutes: number;
  todayActualCount: number;
  incompleteTodoCount: number;
  lastUpdatedAt: string | null;
}

export interface AdminDailyRecordSummary {
  date: string;
  minutes: number;
  actualCount: number;
}

export interface AdminMaterialSummary {
  key: string;
  label: string;
  minutes: number;
}

export type AdminReportMode = 'day' | 'week' | 'month';

export interface AdminWeeklyRecordSummary {
  startDate: string;
  endDate: string;
  minutes: number;
  actualCount: number;
}

export interface AdminPeriodReportSummary {
  mode: AdminReportMode;
  startDate: string;
  endDate: string;
  plannedMinutes: number;
  actualMinutes: number;
  differenceMinutes: number;
  actualCount: number;
  plans: Plan[];
  actuals: Actual[];
  incompleteTodos: TodoTask[];
  dayNotes: DayNote[];
  dailySummaries: AdminDailyRecordSummary[];
  weeklySummaries: AdminWeeklyRecordSummary[];
  materialSummaries: AdminMaterialSummary[];
}

export interface AdminUserSummary {
  profile: AdminProfile;
  stats: AdminDashboardStats;
}

export interface AdminUserDetailData {
  profile: AdminProfile;
  stats: AdminDashboardStats;
  plans: Plan[];
  actuals: Actual[];
  todos: TodoTask[];
  dayNotes: DayNote[];
  studyMaterials: StudyMaterial[];
  todayPlans: Plan[];
  todayActuals: Actual[];
  incompleteTodos: TodoTask[];
  recentDayNotes: DayNote[];
  last7Days: AdminDailyRecordSummary[];
  materialSummaries: AdminMaterialSummary[];
  weekPlannedMinutes: number;
  weekActualMinutes: number;
}

export type RecurrenceRuleKind = 'daily' | 'monthly' | 'day-type' | 'weekday' | 'date';

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
  materialId?: string | null;
  materialName?: string;
}

export interface Actual {
  id: string;
  userId: string;
  planId: string | null;
  occurrenceDate: string;
  actualStartTime: string;
  actualEndTime: string;
  title?: string;
  subject: string;
  isAlignedToPlan?: boolean;
  note: string;
  updatedAt: string;
  materialId?: string | null;
  materialName?: string;
  materialProgressUpdates?: ActualMaterialProgressUpdate[];
}

export interface ActualMaterialProgressUpdate {
  materialId: string;
  progressUnit?: StudyMaterialProgressUnit;
  progressUnitLabel?: string;
  fromUnit?: number;
  toUnit?: number;
  deltaUnits?: number;
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
  materialId?: string | null;
  materialName?: string;
}

export interface ActualDraft {
  userId: string;
  planId: string | null;
  occurrenceDate: string;
  actualStartTime: string;
  actualEndTime: string;
  title: string;
  subject: string;
  isAlignedToPlan: boolean;
  note: string;
  materialId?: string | null;
  materialName?: string;
  materialProgressUpdates?: ActualMaterialProgressUpdate[];
}

export interface StudySubject {
  id: string;
  userId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudySubjectDraft {
  userId: string;
  name: string;
  color: string;
}

export type StudyMaterialStatus = 'active' | 'archived';
export type StudyMaterialProgressUnit =
  | 'page'
  | 'problem'
  | 'section'
  | 'video'
  | 'word'
  | 'custom';

export interface StudyMaterial {
  id: string;
  userId: string;
  name: string;
  subjectId: string;
  subjectName: string;
  color?: string;
  coverImageUrl?: string;
  coverImageDataUrl?: string;
  aliases?: string[];
  status?: StudyMaterialStatus;
  paceEnabled?: boolean;
  progressUnit?: StudyMaterialProgressUnit;
  progressUnitLabel?: string;
  totalUnits?: number;
  currentUnit?: number;
  targetDate?: string;
  estimatedMinutesPerUnit?: number;
  maxUnitsPerDay?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudyMaterialDraft {
  userId: string;
  name: string;
  subjectId: string;
  subjectName: string;
  color?: string;
  coverImageDataUrl?: string;
  aliases?: string[];
  status?: StudyMaterialStatus;
  paceEnabled?: boolean;
  progressUnit?: StudyMaterialProgressUnit;
  progressUnitLabel?: string;
  totalUnits?: number;
  currentUnit?: number;
  targetDate?: string;
  estimatedMinutesPerUnit?: number;
  maxUnitsPerDay?: number;
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
  dueTime?: string | null;
  memo: string;
  status: TodoStatus;
  scheduledPlanId: string | null;
  pinned?: boolean;
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
  dueTime?: string | null;
  memo: string;
  status?: TodoStatus;
  scheduledPlanId?: string | null;
  pinned?: boolean;
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
  termId?: string;
  periodNumber?: number;
  classroom?: string;
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
  termId?: string;
  periodNumber?: number;
  classroom?: string;
  memo: string;
  active: boolean;
}

export type TimetableTermKind =
  | 'firstHalf'
  | 'secondHalf'
  | 'term1'
  | 'term2'
  | 'term3'
  | 'term4'
  | 'fullYear'
  | 'custom';

export interface TimetableTerm {
  id: string;
  userId: string;
  year: number;
  kind: TimetableTermKind;
  label: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TimetableTermDraft {
  userId: string;
  year: number;
  kind: TimetableTermKind;
  label: string;
  isActive?: boolean;
}

export interface TimetablePeriod {
  id: string;
  userId: string;
  termId: string;
  periodNumber: number;
  label: string;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimetablePeriodDraft {
  userId: string;
  termId: string;
  periodNumber: number;
  label: string;
  startTime: string | null;
  endTime: string | null;
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
