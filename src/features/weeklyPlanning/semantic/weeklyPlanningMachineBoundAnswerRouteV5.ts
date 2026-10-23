import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  createFocusedContextualBindingSnapshotV5,
  isFocusedContextualBindingCurrentV5,
} from './weeklyPlanningFocusedContextualBindingV5';
import {
  createFocusedContextualAnswerDocumentV5,
  focusedContextualTargetV5,
} from './weeklyPlanningFocusedContextualAnswerV5';
import {
  decodeWeeklyPlanningMachineBoundEffortAnswerV5,
  formatWeeklyPlanningMachineBoundEffortAnswerV5,
} from './weeklyPlanningMachineBoundAnswerV5';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import type { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * #735: a typed control answer bound to the presented missing-effort question needs no
 * provider. Meaning comes from the control; this route re-checks the machine binding
 * and builds the same focused document the AI route builds, which then takes the
 * normal canonicalization and commit path. Any mismatch returns null, and the turn
 * continues on the ordinary AI route with the generated label as its text.
 */
export function tryMachineBoundEffortAnswerRouteV5(
  run: WeeklyPlanningSemanticNormalizerRunV5,
): WeeklyPlanningSemanticNormalizerResultV5 | null {
  const { input } = run;
  if (input.machineBoundAnswer === undefined) return null;
  const answer = decodeWeeklyPlanningMachineBoundEffortAnswerV5(input.machineBoundAnswer);
  const pending = input.publicStateSummary?.pendingQuestion;
  const target = focusedContextualTargetV5(input);
  const binding = input.committedGraph ? createFocusedContextualBindingSnapshotV5(input) : null;
  const accepted = Boolean(answer && target && binding && isRecord(pending)
    && !input.supplementalContext?.trim() && !input.selectedStarterTarget
    && input.userText === formatWeeklyPlanningMachineBoundEffortAnswerV5(answer)
    && pending.questionCode === 'missing_effort_estimate'
    && (pending.actionId ?? null) === answer.questionActionId
    && pending.targetFactId === answer.targetFactId
    && pending.graphRevision === answer.graphRevision
    && pending.effortMeasurement === answer.effortMeasurement
    && pending.estimateForWorkloadFactId === null && pending.questionBasis === null
    && target.questionCode === 'missing_effort_estimate'
    && target.estimateForWorkload === null && target.questionBasis === null
    && isFocusedContextualBindingCurrentV5(binding, input));
  const document = accepted && answer
    ? createFocusedContextualAnswerDocumentV5({
        input,
        decision: {
          decision: 'effort_answer',
          effortTarget: 'question_target',
          effortMeasurement: answer.effortMeasurement,
          minutes: answer.minutes,
          // Options are coarse presets, so the selected value is an estimate.
          precision: 'approximate',
          quantityRole: null,
        },
      })
    : null;
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: input.traceRequestId,
    stage: 'semantic_orchestrator_route',
    data: {
      route: 'machine_bound_typed_effort_answer',
      meaningOwner: 'typed_ui_control',
      accepted: Boolean(document),
    },
  });
  if (!document) return null;
  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document,
    diagnostics: run.diagnostics({
      attemptCount: 0,
      repairAttempted: false,
      validationErrors: [],
      providerError: null,
      requestBytes: [],
      responseLengths: [],
    }),
  };
  run.recordDecision(result, { route: 'machine_bound_typed_effort_answer_no_provider' });
  return result;
}
