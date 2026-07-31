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

const CLIENT_TARGET_BYTES = WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes;

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let length = Math.min(bytes.byteLength, Math.max(0, maxBytes)); length >= 0; length -= 1) {
    try {
      return decoder.decode(bytes.slice(0, length));
    } catch {
      // A UTF-8 code point was cut in the middle. Back up to the previous boundary.
    }
  }
  return '';
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = utf8Bytes(value);
  if (bytes.byteLength <= maxBytes) return value;
  if (maxBytes <= 0) return '';
  const marker = '…[trace truncated]';
  const markerBytes = utf8Bytes(marker).byteLength;
  if (maxBytes <= markerBytes) return decodeUtf8Prefix(bytes, maxBytes);
  return `${decodeUtf8Prefix(bytes, maxBytes - markerBytes)}${marker}`;
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

function fitsClientTarget(entry: WeeklyPlanningTurnDiagnosticV2WithRendererTrace): boolean {
  return measureWeeklyPlanningTraceJsonBytes(entry) <= CLIENT_TARGET_BYTES;
}

function forceFitClientTarget(
  entry: WeeklyPlanningTurnDiagnosticV2WithRendererTrace,
): WeeklyPlanningTurnDiagnosticV2WithRendererTrace {
  if (fitsClientTarget(entry)) return entry;

  const withoutRawResponses: WeeklyPlanningTurnDiagnosticV2WithRendererTrace = {
    ...entry,
    aiInterpreter: {
      ...entry.aiInterpreter,
      rawResponses: [],
    },
  };
  if (fitsClientTarget(withoutRawResponses)) return withoutRawResponses;

  const scheduler = withoutRawResponses.constraintContext.scheduler;
  const withoutOptionalCollections: WeeklyPlanningTurnDiagnosticV2WithRendererTrace = {
    ...withoutRawResponses,
    aiInterpreter: {
      ...withoutRawResponses.aiInterpreter,
      input: {
        ...withoutRawResponses.aiInterpreter.input,
        planningStateSummary: null,
        requests: [],
      },
      structuredResults: [],
      candidateOperations: [],
    },
    parsers: [],
    decision: {
      ...withoutRawResponses.decision,
      acceptedOperations: [],
      rejectedOperations: [],
      finalOperations: [],
      stateDiff: null,
    },
    constraintContext: {
      ...withoutRawResponses.constraintContext,
      relevantBusyIntervals: [],
      ...(scheduler ? {
        scheduler: {
          ...scheduler,
          externalSources: [],
          issues: [],
          preview: scheduler.preview
            ? { ...scheduler.preview, representativeCandidates: [] }
            : null,
        },
      } : {}),
    },
  };
  if (fitsClientTarget(withoutOptionalCollections)) return withoutOptionalCollections;

  const shortenedText: WeeklyPlanningTurnDiagnosticV2WithRendererTrace = {
    ...withoutOptionalCollections,
    userInput: {
      text: truncateUtf8(withoutOptionalCollections.userInput.text, 500),
    },
    aiInterpreter: {
      ...withoutOptionalCollections.aiInterpreter,
      input: {
        ...withoutOptionalCollections.aiInterpreter.input,
        userText: truncateUtf8(withoutOptionalCollections.aiInterpreter.input.userText, 500),
        conversationContext: [],
      },
    },
    assistantOutput: {
      ...withoutOptionalCollections.assistantOutput,
      text: boundedNullableText(withoutOptionalCollections.assistantOutput.text, 500),
    },
    diagnostics: {
      ...withoutOptionalCollections.diagnostics,
      fallback: null,
    },
  };
  if (fitsClientTarget(shortenedText)) return shortenedText;

  return {
    ...shortenedText,
    userInput: {
      text: truncateUtf8(shortenedText.userInput.text, 128),
    },
    aiInterpreter: {
      ...shortenedText.aiInterpreter,
      provider: boundedNullableText(shortenedText.aiInterpreter.provider, 128),
      model: boundedNullableText(shortenedText.aiInterpreter.model, 128),
      promptVersion: boundedNullableText(shortenedText.aiInterpreter.promptVersion, 128),
      input: {
        userText: truncateUtf8(shortenedText.aiInterpreter.input.userText, 128),
        conversationContext: [],
        planningStateSummary: null,
        requests: [],
      },
      rawResponses: [],
      structuredResults: [],
      candidateOperations: [],
    },
    parsers: [],
    decision: {
      ...shortenedText.decision,
      acceptedOperations: [],
      rejectedOperations: [],
      finalOperations: [],
      stateDiff: null,
    },
    constraintContext: {
      existingPlanCount: shortenedText.constraintContext.existingPlanCount,
      scheduleTemplateCount: shortenedText.constraintContext.scheduleTemplateCount,
      relevantBusyIntervals: [],
    },
    assistantOutput: {
      ...shortenedText.assistantOutput,
      text: boundedNullableText(shortenedText.assistantOutput.text, 128),
    },
    diagnostics: {
      ...shortenedText.diagnostics,
      fallback: null,
      truncation: {
        applied: true,
        fields: ['diagnostics.wrapperEmergencyCompaction'],
        originalCounts: {},
      },
    },
  };
}

function fitWithoutRenderer(params: {
  entry: BaseDiagnostic;
  responseSource: WeeklyPlanningTraceResponseSource | undefined;
  fallback: string | null;
  omittedForSize: boolean;
}): WeeklyPlanningTurnDiagnosticV2WithRendererTrace {
  const candidate = withRendererTrace(
    params.entry,
    params.responseSource,
    undefined,
    params.fallback,
  );
  const marked = params.omittedForSize
    ? markRendererCompaction(candidate, 'diagnostics.dialogueRenderer.omittedForSize')
    : candidate;
  if (fitsClientTarget(marked)) return marked;

  const compactFallback = params.responseSource === 'deterministic_fallback'
    ? 'deterministic_fallback'
    : params.entry.diagnostics.fallback;
  const compact = withRendererTrace(
    params.entry,
    params.responseSource,
    undefined,
    compactFallback,
  );
  if (fitsClientTarget(compact)) return compact;

  const minimal = withRendererTrace(params.entry, params.responseSource, undefined, null);
  return forceFitClientTarget(minimal);
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
    return fitWithoutRenderer({
      entry,
      responseSource: effectiveResponseSource,
      fallback,
      omittedForSize: false,
    });
  }

  const normal = withRendererTrace(
    entry,
    effectiveResponseSource,
    boundedDialogueRendererTrace(dialogueRendererTrace, NORMAL_RENDERER_LIMITS),
    fallback,
  );
  if (fitsClientTarget(normal)) return normal;

  const compact = markRendererCompaction(withRendererTrace(
    entry,
    effectiveResponseSource,
    boundedDialogueRendererTrace(dialogueRendererTrace, COMPACT_RENDERER_LIMITS),
    fallback,
  ), 'diagnostics.dialogueRenderer.compact');
  if (fitsClientTarget(compact)) return compact;

  const minimal = markRendererCompaction(withRendererTrace(
    entry,
    effectiveResponseSource,
    boundedDialogueRendererTrace(dialogueRendererTrace, MINIMAL_RENDERER_LIMITS),
    fallback,
  ), 'diagnostics.dialogueRenderer.minimal');
  if (fitsClientTarget(minimal)) return minimal;

  return fitWithoutRenderer({
    entry,
    responseSource: effectiveResponseSource,
    fallback,
    omittedForSize: true,
  });
}
