import type { PlanningIntakeState, WeeklyPlanningQuestionContext } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  takeWeeklyPlanningTurnDispatchUsage,
  type WeeklyPlanningTurnDispatchUsage,
} from './weeklyPlanningTurnDispatchBudget';

/**
 * One shared measurement of a weekly-planning turn, taken identically for every conversation
 * architecture so the two can be compared honestly.
 *
 * It is observation only: nothing here feeds back into interpretation, retries, budgets,
 * presentation or persistence. Records live in memory for the current page session (no
 * storage, no network, no planning truth, no user text); the evaluation panel and the local
 * debug trace are its only readers.
 */
export type WeeklyPlanningTurnMeasurementStatus = 'committed' | 'failed' | 'discarded';

export type WeeklyPlanningTurnResultKind = 'preview' | 'question' | 'status' | 'failure';

export type WeeklyPlanningTurnQuestionPresentation = 'none' | 'presented' | 're_presented';

export interface WeeklyPlanningTurnMeasurement {
  /** Local, monotonically increasing display counter (not an identity). */
  sequence: number;
  architecture: WeeklyPlanningConversationArchitecture;
  requestId: string;
  turnId: string;
  /** User-turn admission → assistant message committed (or failure message presented). */
  elapsedMs: number;
  aiDispatches: {
    total: number;
    semantic: number;
    renderer: number;
    enforced: boolean;
    refused: number;
  };
  status: WeeklyPlanningTurnMeasurementStatus;
  /** Deterministic interaction kind; `null` where the architecture has no interaction layer. */
  interactionOutcome: string | null;
  /** Architecture-neutral classification of what the user was shown. */
  resultKind: WeeklyPlanningTurnResultKind;
  /** Failure category code (e.g. `stable_v5_provider_failure`; no diagnostics detail) or null. */
  failureCode: string | null;
  pendingQuestion: WeeklyPlanningTurnQuestionPresentation;
}

export type WeeklyPlanningMeasurementClock = () => number;

export function defaultWeeklyPlanningMeasurementClock(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function sameQuestion(
  previous: WeeklyPlanningQuestionContext | undefined,
  next: WeeklyPlanningQuestionContext | undefined,
): boolean {
  return Boolean(previous && next
    && previous.targetSlot === next.targetSlot
    && previous.topicId === next.topicId
    && previous.actionId === next.actionId);
}

/**
 * What the user was shown: a new preview, a (re)presented machine question, or a status.
 * (`preserveExistingPreview` is set on question turns too, so it says nothing about the turn.)
 */
function resultKind(result: WeeklyPlanningTurnExecutionResult | undefined): WeeklyPlanningTurnResultKind {
  if (!result || result.failure) return 'failure';
  if (result.draftCandidates.length > 0) return 'preview';
  return result.questionPresentationContent && result.state.lastQuestionContext ? 'question' : 'status';
}

function questionPresentation(
  previousState: PlanningIntakeState | undefined,
  result: WeeklyPlanningTurnExecutionResult | undefined,
): WeeklyPlanningTurnQuestionPresentation {
  if (!result) return 'none';
  const outcome = result.interactionOutcome;
  if (outcome?.kind === 'recover') return outcome.representedQuestion ? 're_presented' : 'none';
  if (!result.questionPresentationContent || !result.state.lastQuestionContext) return 'none';
  return sameQuestion(previousState?.lastQuestionContext, result.state.lastQuestionContext)
    ? 're_presented'
    : 'presented';
}

export interface WeeklyPlanningTurnMeasurementTimer {
  /** Takes the final measurement exactly once; later calls return null. */
  finish(params: {
    status: WeeklyPlanningTurnMeasurementStatus;
    result?: WeeklyPlanningTurnExecutionResult;
    failureCode?: string | null;
  }): WeeklyPlanningTurnMeasurement | null;
}

export function startWeeklyPlanningTurnMeasurement(params: {
  architecture: WeeklyPlanningConversationArchitecture;
  requestId: string;
  turnId: string;
  previousState: PlanningIntakeState | undefined;
  clock?: WeeklyPlanningMeasurementClock;
  enforcesBudget: boolean;
}): WeeklyPlanningTurnMeasurementTimer {
  const clock = params.clock ?? defaultWeeklyPlanningMeasurementClock;
  const startedAt = clock();
  let finished = false;
  return {
    finish({ status, result, failureCode }) {
      if (finished) return null;
      finished = true;
      const elapsedMs = Math.max(0, Math.round(clock() - startedAt));
      const usage: WeeklyPlanningTurnDispatchUsage = takeWeeklyPlanningTurnDispatchUsage(params.requestId)
        ?? {
          total: 0,
          semantic: 0,
          renderer: 0,
          limit: 0,
          enforced: params.enforcesBudget,
          refused: 0,
        };
      const measurement: WeeklyPlanningTurnMeasurement = {
        sequence: 0,
        architecture: params.architecture,
        requestId: params.requestId,
        turnId: params.turnId,
        elapsedMs,
        aiDispatches: {
          total: usage.total,
          semantic: usage.semantic,
          renderer: usage.renderer,
          enforced: usage.enforced,
          refused: usage.refused,
        },
        status,
        interactionOutcome: result?.interactionOutcome?.kind ?? null,
        resultKind: status === 'failed' ? 'failure' : resultKind(result),
        failureCode: failureCode ?? result?.failure?.code ?? null,
        pendingQuestion: questionPresentation(params.previousState, result),
      };
      return recordWeeklyPlanningTurnMeasurement(measurement);
    },
  };
}

const MAX_MEASUREMENTS = 20;
let nextSequence = 1;
let measurements: readonly WeeklyPlanningTurnMeasurement[] = [];
const listeners = new Set<() => void>();

export function recordWeeklyPlanningTurnMeasurement(
  measurement: WeeklyPlanningTurnMeasurement,
): WeeklyPlanningTurnMeasurement {
  const recorded = { ...measurement, sequence: nextSequence };
  nextSequence += 1;
  measurements = [...measurements, recorded].slice(-MAX_MEASUREMENTS);
  listeners.forEach((listener) => listener());
  return recorded;
}

/** Oldest first; a stable reference between changes (safe for useSyncExternalStore). */
export function getWeeklyPlanningTurnMeasurements(): readonly WeeklyPlanningTurnMeasurement[] {
  return measurements;
}

export function getLatestWeeklyPlanningTurnMeasurement(): WeeklyPlanningTurnMeasurement | null {
  return measurements[measurements.length - 1] ?? null;
}

export function subscribeWeeklyPlanningTurnMeasurements(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetWeeklyPlanningTurnMeasurementsForTest(): void {
  measurements = [];
  nextSequence = 1;
  listeners.forEach((listener) => listener());
}
