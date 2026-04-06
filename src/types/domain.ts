export type ViewMode = 'month' | 'week' | 'day';

export type PlanType =
  | 'study'
  | 'mock-exam'
  | 'school-event'
  | 'cram-school'
  | 'deadline'
  | 'other';

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface EmailChallenge {
  email: string;
  expiresAt: string;
  previewCode: string;
}

export interface Plan {
  id: string;
  userId: string;
  title: string;
  subject: string;
  date: string;
  startTime: string;
  endTime: string;
  type: PlanType;
  memo: string;
  createdAt: string;
  updatedAt: string;
}

export interface Actual {
  id: string;
  userId: string;
  planId: string;
  actualStartTime: string;
  actualEndTime: string;
  subject: string;
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
  type: PlanType;
  memo: string;
}

export interface ActualDraft {
  userId: string;
  planId: string;
  actualStartTime: string;
  actualEndTime: string;
  subject: string;
  note: string;
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
