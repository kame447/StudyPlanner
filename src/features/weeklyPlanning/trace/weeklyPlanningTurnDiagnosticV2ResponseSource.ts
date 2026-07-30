import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
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
  diagnostics: BaseDiagnostic['diagnostics'] & {
    dialogueRenderer?: WeeklyPlanningDialogueRendererTrace;
  };
};

interface RendererTraceLimits {
  actionIdBytes: number;
  questionCodeBytes: number;
  labelCount: number;
  labelBytes: number;
  fallbackTextBytes: number;
  reasonBytes: number;
  rawResponseBytes: number;
  renderedTextBytes: number;
  finalMessageBytes: number;
  includeRequest: boolean;
  includeRawResponse: boolean;
}

const NORMAL_RENDERER_LIMITS: RendererTraceLimits = {
  actionIdBytes: 512,
  questionCodeBytes: 256,
  labelCount: 10,
  labelBytes: 256,
  fallbackTextBytes: 1_500,
  reasonBytes: 512,
  rawResponseBytes: 3_500,
  renderedTextBytes: 1_500,
  finalMessageBytes: 1_500,
  includeRequest: true,
  includeRawResponse: true,
};

const COMPACT_RENDERER_LIMITS: RendererTraceLimits = {
  actionIdBytes: 256,
  questionCodeBytes: 128,
  labelCount: 3,
  labelBytes: 128,
  fallbackTextBytes: 500,
  reasonBytes: 256,
  rawResponseBytes: 0,
  renderedTextBytes: 500,
  finalMessageBytes: 500,
  includeRequest: true,
  includeRawResponse: false,
};

const MINIMAL_RENDERER_LIMITS: RendererTraceLimits = {
  actionIdBytes: 128,
  questionCodeBytes: 64,
  labelCount: 0,
  labelBytes: 0,
  fallbackTextBytes: 0,
  reasonBytes: 128,
  rawResponseBytes: 0,
  renderedTextBytes: 0,
  finalMessageBytes: 300,
  includeRequest: false,
  includeRawResponse: false,
};

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = utf8Bytes(value);
  if (bytes.byteLength <= maxBytes) return value;
  if (maxBytes <= 0) return '';
  const marker = '…[trace truncated]';
  const markerBytes = utf8Bytes(marker).byteLength;
  if (maxBytes <= markerBytes) {
    return new TextDecoder().decode(bytes.slice(0, maxBytes));
  }
  const prefix = new TextDecoder().decode(bytes.slice(0, maxBytes - markerBytes));
  return `${prefix}${marker}`;
}

function boundedNullableText(value: string | null, maxBytes: number): string | null {
  return value === null ? null : truncateUtf8(value, maxBytes);
}

function boundedDialogueRendererTrace(
  trace: WeeklyPlanningDialogueRendererTrace,
  limits: RendererTraceLimits,
): WeeklyPlanningDialogueRendererTrace {
  return {
    actionId: boundedNullableText(trace.actionId, limits.actionIdBytes),
    actionKind: trace.actionKind,
    questionCode: boundedNullableText(trace.questionCode, limits.questionCodeBytes),
    request: limits.includeRequest && trace.request
      ? {
          purpose: 'weekly_planning_renderer',
          requiredLabels: trace.request.requiredLabels
            .slice(0, limits.labelCount)
            .map((label) => truncateUtf8(label, limits.labelBytes)),
          fallbackText: truncateUtf8(trace.request.fallbackText, limits.fallbackTextBytes),
          previewCount: trace.request.previewCount,
        }
      : null,
    response: {
      status: trace.response.status,
      reason: boundedNullableText(trace.response.reason, limits.reasonBytes),
      rawResponse: limits.includeRawResponse
        ? boundedNullableText(trace.response.rawResponse, limits.rawResponseBytes)
        : null,
      renderedText: limits.renderedTextBytes > 0
        ? boundedNullableText(trace.response.renderedText, limits.renderedTextBytes)
        : null,
    },
    decision: {
      branch: trace.decision.branch,
      responseSource: trace.decision.responseSource,
      finalMessage: truncateUtf8(trace.decision.finalMessage, limits.finalMessageBytes),
    },
  };
}

function withRendererTrace(
  entry: BaseDiagnostic,
  responseSource: WeeklyPlanningTraceResponseSource | undefined,
  rendererTrace: WeeklyPlanningDialogueRendererTrace | undefined,
  fallback: string | null,
): WeeklyPlanningTurnDiagnosticV2WithRendererTrace {
  return {
    ...entry,
    assistantOutput: {
      ...entry.assistantOutput,
      ...(responseSource ? { responseSource } : {}),
    },
    diagnostics: {
      ...entry.diagnostics,
      fallback,
      ...(rendererTrace ? { dialogueRenderer: rendererTrace } : {}),
    },
  };
}

function markRendererCompaction(
  entry: WeeklyPlanningTurnDiagnosticV2WithRendererTrace,
  field: string,
): WeeklyPlanningTurnDiagnosticV2WithRendererTrace {
  const current = entry.diagnostics.truncation;
  return {
    ...entry,
    diagnostics: {
      ...entry.diagnostics,
      truncation: {
        applied: true,
        fields: [...new Set([...(current?.fields ?? []), field])].sort(),
        originalCounts: { ...(current?.originalCounts ?? {}) },
      },
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
  const fallback = explicitFallback
    ? dialogueRendererTrace?.response.reason ?? 'deterministic_fallback'
    : entry.diagnostics.fallback;
  if (!dialogueRendererTrace) {
    return withRendererTrace(entry, effectiveResponseSource, undefined, fallback);
  }

  const normal = withRendererTrace(
    entry,
    effectiveResponseSource,
    boundedDialogueRendererTrace(dialogueRendererTrace, NORMAL_RENDERER_LIMITS),
    fallback,
  );
  if (measureWeeklyPlanningTraceJsonBytes(normal)
    <= WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes) {
    return normal;
  }

  const compact = markRendererCompaction(withRendererTrace(
    entry,
    effectiveResponseSource,
    boundedDialogueRendererTrace(dialogueRendererTrace, COMPACT_RENDERER_LIMITS),
    fallback,
  ), 'diagnostics.dialogueRenderer.compact');
  if (measureWeeklyPlanningTraceJsonBytes(compact)
    <= WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes) {
    return compact;
  }

  return markRendererCompaction(withRendererTrace(
    entry,
    effectiveResponseSource,
    boundedDialogueRendererTrace(dialogueRendererTrace, MINIMAL_RENDERER_LIMITS),
    fallback,
  ), 'diagnostics.dialogueRenderer.minimal');
}
