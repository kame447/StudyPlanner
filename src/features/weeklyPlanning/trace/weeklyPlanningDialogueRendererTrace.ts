import type { WeeklyPlanningTraceResponseSource } from './weeklyPlanningTraceTypes';

export type WeeklyPlanningDialogueRendererTraceActionKind =
  | 'question'
  | 'status'
  | 'preview_ready';

export type WeeklyPlanningDialogueRendererTraceStatus =
  | 'rendered'
  | 'fallback'
  | 'bypassed';

export type WeeklyPlanningDialogueRendererTraceBranch =
  | 'ai_rendered'
  | 'deterministic_fallback'
  | 'system_message_bypass';

export interface WeeklyPlanningDialogueRendererTrace {
  actionId: string | null;
  actionKind: WeeklyPlanningDialogueRendererTraceActionKind | null;
  questionCode: string | null;
  request: {
    purpose: 'weekly_planning_renderer';
    requiredLabels: string[];
    fallbackText: string;
    previewCount: number;
  } | null;
  response: {
    status: WeeklyPlanningDialogueRendererTraceStatus;
    reason: string | null;
    rawResponse: string | null;
    renderedText: string | null;
  };
  decision: {
    branch: WeeklyPlanningDialogueRendererTraceBranch;
    responseSource: WeeklyPlanningTraceResponseSource;
    finalMessage: string;
  };
}
