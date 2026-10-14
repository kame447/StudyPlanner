import { truncateMiddleWithMarker } from '../harness/codexUtf8Budget';
import { boundContextJson } from '../harness/codexJsonPreview';
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

const MAX_PENDING_PROMPT_CONTEXTS = 128;
const pendingPromptContexts = new Map<string, WeeklyPlanningDialogueRendererPromptContext>();

function trimPendingPromptContexts(): void {
  while (pendingPromptContexts.size > MAX_PENDING_PROMPT_CONTEXTS) {
    const oldestActionId = pendingPromptContexts.keys().next().value;
    if (typeof oldestActionId !== 'string') return;
    pendingPromptContexts.delete(oldestActionId);
  }
}

export function rememberWeeklyPlanningDialogueRendererPromptContext(
  actionId: string,
  promptContext: WeeklyPlanningDialogueRendererPromptContext,
): void {
  pendingPromptContexts.delete(actionId);
  pendingPromptContexts.set(actionId, promptContext);
  trimPendingPromptContexts();
}

function takeWeeklyPlanningDialogueRendererPromptContext(
  actionId: string | null,
): WeeklyPlanningDialogueRendererPromptContext | undefined {
  if (!actionId) return undefined;
  const promptContext = pendingPromptContexts.get(actionId);
  pendingPromptContexts.delete(actionId);
  return promptContext;
}

export function resetWeeklyPlanningDialogueRendererPromptContextsForTest(): void {
  pendingPromptContexts.clear();
}

function boundedText(value: string, maxBytes: number): string {
  return truncateMiddleWithMarker(value, maxBytes, '…[trace truncated]');
}

function boundedNullableText(value: string | null, maxBytes: number): string | null {
  return value === null ? null : boundedText(value, maxBytes);
}

export function boundWeeklyPlanningDialogueRendererTraceForTransport(
  trace: WeeklyPlanningDialogueRendererTrace,
): WeeklyPlanningDialogueRendererTrace {
  const promptContext = trace.request?.promptContext
    ?? takeWeeklyPlanningDialogueRendererPromptContext(trace.actionId);
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
          ...(promptContext === undefined
            ? {}
            : { promptContext: boundContextJson(promptContext, 12 * 1024) }),
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
