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

/**
 * Rendererへ実際に渡した入力のうち、固定request field以外の拡張情報。
 * 新しいprompt fieldが追加されてもtrace schemaの同期漏れで消えないよう、
 * JSON-safeな拡張領域として保持する。
 */
export type WeeklyPlanningDialogueRendererPromptContext = unknown;

export interface WeeklyPlanningDialogueRendererTrace {
  actionId: string | null;
  actionKind: WeeklyPlanningDialogueRendererTraceActionKind | null;
  questionCode: string | null;
  request: {
    purpose: 'weekly_planning_renderer';
    requiredLabels: string[];
    fallbackText: string;
    previewCount: number;
    promptContext?: WeeklyPlanningDialogueRendererPromptContext;
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

function decodeUtf8Suffix(bytes: Uint8Array, maxBytes: number): string {
  const start = Math.max(0, bytes.byteLength - Math.max(0, maxBytes));
  for (let offset = start; offset <= bytes.byteLength; offset += 1) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(offset));
    } catch {
      // Advance when the suffix starts in the middle of a multi-byte code point.
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

function boundedJsonValue(value: unknown, maxBytes: number): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? 'null';
  } catch {
    return { traceTruncated: true, reason: 'unserializable' };
  }
  const bytes = utf8Bytes(serialized);
  if (bytes.byteLength <= maxBytes) {
    try {
      return JSON.parse(serialized);
    } catch {
      return { traceTruncated: true, reason: 'invalid_serialized_json' };
    }
  }
  const markerBudget = Math.min(512, Math.max(128, Math.floor(maxBytes * 0.15)));
  const contentBudget = Math.max(256, maxBytes - markerBudget);
  return {
    traceTruncated: true,
    originalBytes: bytes.byteLength,
    jsonHead: decodeUtf8Prefix(bytes, Math.floor(contentBudget * 0.65)),
    jsonTail: decodeUtf8Suffix(bytes, Math.floor(contentBudget * 0.35)),
  };
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
          ...(trace.request.promptContext === undefined
            ? {}
            : { promptContext: boundedJsonValue(trace.request.promptContext, 12 * 1024) }),
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
