import type { WeeklyPlanningTurnExecutionResult } from '../../weeklyPlanningTurnExecutionTypes';
import {
  createWeeklyPlanningAiRenderedDialogueTrace, createWeeklyPlanningFallbackDialogueTrace,
  createWeeklyPlanningSystemDialogueRendererTrace, recordWeeklyPlanningStableV5DebugTrace,
  takeWeeklyPlanningStableV5DebugTrace, type WeeklyPlanningStableV5DialogueRenderInput,
  type WeeklyPlanningStableV5DialogueRenderResult,
  WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
} from '../weeklyPlanningVNextV5Boundary';
import type { WeeklyPlanningVNextExperimentalPorts, WeeklyPlanningVNextExperimentalTurn } from './weeklyPlanningVNextExperimentalSession';

/** Application-only observation of the actual ports, not another trace writer. The existing
 * bounded collector and outcome lifecycle own persistence, retry and Worker privacy. Keep
 * interpretation/session free of telemetry; RuntimeGateway integration guards that evidence
 * survives failed turns, outbox retry and truncation without becoming planning authority.
 */
export function captureWeeklyPlanningVNextTurnDiagnostics(requestId: string, ports: WeeklyPlanningVNextExperimentalPorts) {
  let attempt = 0;
  let renderer: { input: WeeklyPlanningStableV5DialogueRenderInput; result: WeeklyPlanningStableV5DialogueRenderResult } | undefined;
  const observed: WeeklyPlanningVNextExperimentalPorts = { ...ports,
    client: { ...ports.client, async createChatCompletion(request) {
      const current = `vnext_${++attempt}`;
      recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_provider_request',
        data: { attempt: current, requestBytes: new TextEncoder().encode(JSON.stringify(request)).byteLength, request } });
      try {
        const rawResponse = await ports.client.createChatCompletion(request);
        recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_provider_response',
          data: { attempt: current, rawResponse, responseLength: rawResponse.length } });
        return rawResponse;
      } catch (error) {
        recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_provider_error', severity: 'error',
          data: { attempt: current, error: { name: error instanceof Error ? error.name : 'unknown_error' } } });
        throw error;
      }
    } },
    createRenderer(options) {
      const delegate = ports.createRenderer(options);
      return { async render(input) {
        const result = await delegate.render(input);
        renderer = { input, result };
        return result;
      } };
    },
  };
  return { ports: observed, finish(turn: WeeklyPlanningVNextExperimentalTurn): Pick<WeeklyPlanningTurnExecutionResult,
    'debugTraceEvents' | 'dialogueRendererTrace' | 'observability' | 'failure' | 'interactionOutcome' | 'recoveryPresentation' | 'responseSource'> {
    const interpretation = turn.interpretation;
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_validation_result',
      data: { attempt: 'vnext_result', accepted: interpretation?.status === 'interpreted' && turn.outcome !== 'rejected',
        errors: turn.errors, parsedDocument: interpretation
          ? { authorizationDecision: turn.authorizationDecision, ...interpretation } : interpretation } });
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_normalizer_decision',
      data: { status: interpretation?.status ?? turn.outcome, diagnostics: interpretation?.metrics ?? null } });
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'runtime_branch_selected',
      data: { branch: `vnext_${turn.outcome}`, basis: { graphRevision: turn.graphRevision, readiness: turn.readiness,
        previewBlockedBy: turn.previewBlockedBy }, output: { interpretation, errors: turn.errors } } });
    let trace = createWeeklyPlanningSystemDialogueRendererTrace(turn.reply);
    if (renderer) {
      const common = { actionId: renderer.input.actionId, actionKind: renderer.input.actionKind,
        questionCode: renderer.input.questionCode, renderInput: renderer.input, finalMessage: turn.reply };
      trace = renderer.result.status === 'rendered'
        ? createWeeklyPlanningAiRenderedDialogueTrace({ ...common, rendered: renderer.result })
        : createWeeklyPlanningFallbackDialogueTrace({ ...common, rendered: renderer.result });
      trace.request!.promptContext = renderer.input;
      // An unverified recovery response is evidence, but the actual reply is the system notice.
      if (turn.replySource === 'system') trace.decision = createWeeklyPlanningSystemDialogueRendererTrace(turn.reply).decision;
    }
    const failed = turn.outcome === 'interpretation_failed' || turn.outcome === 'rejected'
      || turn.outcome === 'checkpoint_unreadable' || turn.outcome === 'stale';
    const reason = interpretation?.status === 'failed' ? interpretation.reason : turn.outcome;
    const providerError = reason === 'provider_error';
    return {
      responseSource: turn.replySource === 'system' ? 'system'
        : turn.replySource === 'renderer_fallback' ? 'deterministic_fallback' : 'ai',
      dialogueRendererTrace: trace,
      debugTraceEvents: takeWeeklyPlanningStableV5DebugTrace(requestId),
      interactionOutcome: { kind: turn.outcome === 'answer_represented' ? 'explain_pending_question' : 'apply' },
      observability: { repairUsed: interpretation ? interpretation.metrics.repairs > 0 : null,
        schedulerVersion: turn.preview ? WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION : null,
        previewCount: turn.preview?.blocks.length ?? 0, unscheduledCount: turn.unplacedOwnerKeys.length },
      ...(failed ? { failure: { code: providerError ? 'stable_v5_provider_failure'
        : interpretation?.status === 'failed' ? 'stable_v5_normalization_rejected' : 'stable_v5_canonicalization_rejected',
        userMessage: turn.reply, traceCode: `vnext_${reason}`, diagnostics: {
          attemptCount: interpretation?.metrics.calls ?? 0, repairAttempted: (interpretation?.metrics.repairs ?? 0) > 0,
          validationErrorCategories: [...new Set(turn.errors.map(error => error.code))],
          providerErrorCategory: providerError ? 'provider_error' : null,
        } } } : {}),
      // The session has already checked recovery wording and kept the accepted graph unchanged.
      // Both verified recovery and system fallback must retain exactly its actual presentation.
      ...(turn.outcome === 'interpretation_failed' || turn.outcome === 'rejected'
        ? { recoveryPresentation: { question: null, commitStagedPresentation: true } } : {}),
    };
  } };
}
