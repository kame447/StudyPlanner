import type { WeeklyPlanningIntakePipelineOutput } from '../pipeline/weeklyPlanningIntakePipeline';

export interface WeeklyPlanningTracePipelineOptions {
  conversationId?: string;
  traceRequestId?: string;
  userId?: string;
  dialoguePlanner?: unknown;
  useAiDialoguePlanner?: boolean;
}

export interface WeeklyPlanningTracePipelineOutput extends WeeklyPlanningIntakePipelineOutput {
  behavior: {
    snapshot: {
      stateRevision: number;
      readiness: unknown;
    };
    actions: readonly { actionId: string }[];
    gate: {
      allowed: boolean;
    };
  };
  behaviorDialogue: {
    source: string;
    renderedActionIds?: readonly string[];
    response?: {
      items: readonly { actionId: string }[];
    } | null;
    message: string;
  };
  feasibility: {
    scheduledMinutes: number;
    unscheduledMinutes: number;
  };
  lifecycleDiagnostics?: {
    acceptedDecisionCount: number;
    rejectedDecisions: readonly { value: unknown; reason: string }[];
    acceptedCorrectionCount: number;
    rejectedCorrections: readonly { value: unknown; reason: string }[];
  };
}
