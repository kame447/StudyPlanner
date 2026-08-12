import {
  recordWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningDialogueRendererTrace } from '../trace/weeklyPlanningDialogueRendererTrace';
import type {
  WeeklyPlanningStableV5DialogueActionKind,
  WeeklyPlanningStableV5DialogueRenderInput,
  WeeklyPlanningStableV5DialogueRenderResult,
} from './weeklyPlanningStableV5DialogueContracts';

function rendererRequestTrace(
  input: WeeklyPlanningStableV5DialogueRenderInput,
): NonNullable<WeeklyPlanningDialogueRendererTrace['request']> {
  return {
    purpose: 'weekly_planning_renderer',
    requiredLabels: [...input.requiredLabels],
    fallbackText: input.fallbackText,
    previewCount: input.previewCount,
  };
}

export function createWeeklyPlanningSystemDialogueRendererTrace(
  message: string,
): WeeklyPlanningDialogueRendererTrace {
  return {
    actionId: null,
    actionKind: null,
    questionCode: null,
    request: null,
    response: {
      status: 'bypassed',
      reason: 'system_message',
      rawResponse: null,
      renderedText: null,
    },
    decision: {
      branch: 'system_message_bypass',
      responseSource: 'system',
      finalMessage: message,
    },
  };
}

export function createWeeklyPlanningDeterministicQuestionDialogueTrace(params: {
  actionId: string;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  finalMessage: string;
}): WeeklyPlanningDialogueRendererTrace {
  return {
    actionId: params.actionId,
    actionKind: params.actionKind,
    questionCode: params.questionCode,
    request: null,
    response: {
      status: 'bypassed',
      reason: 'deterministic_question',
      rawResponse: null,
      renderedText: null,
    },
    decision: {
      branch: 'deterministic_question_bypass',
      responseSource: 'rules',
      finalMessage: params.finalMessage,
    },
  };
}

export function createWeeklyPlanningFallbackDialogueTrace(params: {
  actionId: string;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  renderInput: WeeklyPlanningStableV5DialogueRenderInput;
  rendered: Extract<WeeklyPlanningStableV5DialogueRenderResult, { status: 'fallback' }>;
  finalMessage: string;
}): WeeklyPlanningDialogueRendererTrace {
  return {
    actionId: params.actionId,
    actionKind: params.actionKind,
    questionCode: params.questionCode,
    request: rendererRequestTrace(params.renderInput),
    response: {
      status: 'fallback',
      reason: params.rendered.reason,
      rawResponse: params.rendered.rawResponse,
      renderedText: null,
    },
    decision: {
      branch: 'deterministic_fallback',
      responseSource: 'deterministic_fallback',
      finalMessage: params.finalMessage,
    },
  };
}

export function createWeeklyPlanningAiRenderedDialogueTrace(params: {
  actionId: string;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  questionCode: string | null;
  renderInput: WeeklyPlanningStableV5DialogueRenderInput;
  rendered: Extract<WeeklyPlanningStableV5DialogueRenderResult, { status: 'rendered' }>;
  finalMessage: string;
}): WeeklyPlanningDialogueRendererTrace {
  return {
    actionId: params.actionId,
    actionKind: params.actionKind,
    questionCode: params.questionCode,
    request: rendererRequestTrace(params.renderInput),
    response: {
      status: 'rendered',
      reason: null,
      rawResponse: params.rendered.rawResponse,
      renderedText: params.rendered.text,
    },
    decision: {
      branch: 'ai_rendered',
      responseSource: 'ai',
      finalMessage: params.finalMessage,
    },
  };
}

export function recordWeeklyPlanningDialogueRendererRequestV5(params: {
  requestId: string;
  input: WeeklyPlanningStableV5DialogueRenderInput;
}): void {
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.requestId,
    stage: 'dialogue_renderer_request',
    data: {
      purpose: 'weekly_planning_renderer',
      input: params.input,
    },
  });
}

export function recordWeeklyPlanningDialogueRendererResponseV5(params: {
  requestId: string;
  actionId: string;
  rendered: WeeklyPlanningStableV5DialogueRenderResult;
  selfRepairNotice: string | null;
}): void {
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.requestId,
    stage: 'dialogue_renderer_response',
    severity: params.rendered.status === 'rendered' ? 'info' : 'warn',
    data: {
      actionId: params.actionId,
      status: params.rendered.status,
      reason: params.rendered.status === 'fallback' ? params.rendered.reason : null,
      rawResponse: params.rendered.rawResponse,
      selfRepairNotice: params.selfRepairNotice,
    },
  });
}

export function recordWeeklyPlanningDialogueDecisionV5(params: {
  requestId: string;
  branch: 'system_message_bypass' | 'deterministic_question_bypass' | 'deterministic_fallback' | 'ai_rendered';
  actionId?: string | null;
  questionCode?: string | null;
  responseSource: 'ai' | 'deterministic_fallback' | 'rules' | 'system';
  message: string;
  selfRepairNotice?: string | null;
  reason?: string | null;
  preservedQuestionContext?: unknown;
  severity?: 'debug' | 'info' | 'warn' | 'error';
}): void {
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.requestId,
    stage: 'dialogue_renderer_decision',
    severity: params.severity,
    data: {
      branch: params.branch,
      ...(params.actionId !== undefined ? { actionId: params.actionId } : {}),
      ...(params.questionCode !== undefined ? { questionCode: params.questionCode } : {}),
      ...(params.reason !== undefined ? { reason: params.reason } : {}),
      responseSource: params.responseSource,
      message: params.message,
      ...(params.selfRepairNotice !== undefined
        ? { selfRepairNotice: params.selfRepairNotice }
        : {}),
      ...(params.preservedQuestionContext !== undefined
        ? { preservedQuestionContext: params.preservedQuestionContext }
        : {}),
    },
  });
}
