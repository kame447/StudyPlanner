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

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  for (let length = Math.min(bytes.byteLength, Math.max(0, maxBytes)); length >= 0; length -= 1) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, length));
    } catch {
      // Back up when the byte limit cuts a multi-byte code point.
    }
  }
  return '';
}

function boundedText(value: string, maxBytes: number): string {
  const bytes = utf8Bytes(value);
  if (bytes.byteLength <= maxBytes) return value;
  const marker = '…[trace truncated]';
  const markerBytes = utf8Bytes(marker).byteLength;
  if (maxBytes <= markerBytes) return decodeUtf8Prefix(bytes, maxBytes);
  return `${decodeUtf8Prefix(bytes, maxBytes - markerBytes)}${marker}`;
}

function boundedNullableText(value: string | null, maxBytes: number): string | null {
  return value === null ? null : boundedText(value, maxBytes);
}

export function boundWeeklyPlanningDialogueRendererTraceForTransport(
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
            .slice(0, 10)
            .map((label) => boundedText(label, 256)),
          fallbackText: boundedText(trace.request.fallbackText, 1_500),
          previewCount: trace.request.previewCount,
        }
      : null,
    response: {
      status: trace.response.status,
      reason: boundedNullableText(trace.response.reason, 512),
      rawResponse: boundedNullableText(trace.response.rawResponse, 8_000),
      renderedText: boundedNullableText(trace.response.renderedText, 1_500),
    },
    decision: {
      branch: trace.decision.branch,
      responseSource: trace.decision.responseSource,
      finalMessage: boundedText(trace.decision.finalMessage, 1_500),
    },
  };
}
