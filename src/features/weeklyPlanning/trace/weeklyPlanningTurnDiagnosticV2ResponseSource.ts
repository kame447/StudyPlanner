import type { WeeklyPlanningDialogueRendererTrace } from './weeklyPlanningDialogueRendererTrace';
import type { WeeklyPlanningTraceResponseSource } from './weeklyPlanningTraceTypes';
import {
  createWeeklyPlanningTurnDiagnosticV2 as createBaseWeeklyPlanningTurnDiagnosticV2,
} from './weeklyPlanningTurnDiagnosticV2';

type BaseCreateInput = Parameters<typeof createBaseWeeklyPlanningTurnDiagnosticV2>[0];
type BaseDiagnostic = ReturnType<typeof createBaseWeeklyPlanningTurnDiagnosticV2>;

export type CreateWeeklyPlanningTurnDiagnosticV2WithResponseSourceInput = BaseCreateInput & {
  responseSource?: WeeklyPlanningTraceResponseSource;
  dialogueRendererTrace?: WeeklyPlanningDialogueRendererTrace;
};

export type WeeklyPlanningTurnDiagnosticV2WithRendererTrace = BaseDiagnostic & {
  dialogueRenderer?: WeeklyPlanningDialogueRendererTrace;
};

function boundedText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…[trace truncated]`;
}

function boundedNullableText(value: string | null, maxLength: number): string | null {
  return value === null ? null : boundedText(value, maxLength);
}

function boundedDialogueRendererTrace(
  trace: WeeklyPlanningDialogueRendererTrace,
): WeeklyPlanningDialogueRendererTrace {
  return {
    actionId: boundedNullableText(trace.actionId, 512),
    actionKind: trace.actionKind,
    questionCode: boundedNullableText(trace.questionCode, 256),
    request: trace.request
      ? {
          purpose: 'weekly_planning_renderer',
          requiredLabels: trace.request.requiredLabels
            .slice(0, 20)
            .map((label) => boundedText(label, 256)),
          fallbackText: boundedText(trace.request.fallbackText, 2_000),
          previewCount: trace.request.previewCount,
        }
      : null,
    response: {
      status: trace.response.status,
      reason: boundedNullableText(trace.response.reason, 512),
      rawResponse: boundedNullableText(trace.response.rawResponse, 4_000),
      renderedText: boundedNullableText(trace.response.renderedText, 2_000),
    },
    decision: {
      branch: trace.decision.branch,
      responseSource: trace.decision.responseSource,
      finalMessage: boundedText(trace.decision.finalMessage, 2_000),
    },
  };
}

export function createWeeklyPlanningTurnDiagnosticV2(
  input: CreateWeeklyPlanningTurnDiagnosticV2WithResponseSourceInput,
): WeeklyPlanningTurnDiagnosticV2WithRendererTrace {
  const { responseSource, dialogueRendererTrace, ...baseInput } = input;
  const entry = createBaseWeeklyPlanningTurnDiagnosticV2(baseInput);
  const effectiveResponseSource = responseSource ?? dialogueRendererTrace?.decision.responseSource;
  const explicitFallback = effectiveResponseSource === 'deterministic_fallback';
  return {
    ...entry,
    ...(dialogueRendererTrace
      ? { dialogueRenderer: boundedDialogueRendererTrace(dialogueRendererTrace) }
      : {}),
    assistantOutput: {
      ...entry.assistantOutput,
      ...(effectiveResponseSource ? { responseSource: effectiveResponseSource } : {}),
    },
    diagnostics: {
      ...entry.diagnostics,
      fallback: explicitFallback
        ? dialogueRendererTrace?.response.reason ?? 'deterministic_fallback'
        : entry.diagnostics.fallback,
    },
  };
}
