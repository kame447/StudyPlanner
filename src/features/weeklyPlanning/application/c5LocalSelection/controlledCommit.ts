import { bindWeeklyPlanningQuestionPresentation } from '../../intake/weeklyPlanningQuestionPresentation';
import type { PlanningState, WeeklyPlanningAction, WeeklyPlanningMessage, WeeklyPlanningPendingTurn } from '../../types';
import type { WeeklyPlanningTurnExecutionResult, WeeklyPlanningTurnSubmissionResult } from '../../weeklyPlanningTurnExecutionTypes';
import { commitWeeklyPlanningStableV5RuntimeGraph, discardWeeklyPlanningStableV5StagedGraph, finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt, getWeeklyPlanningStableV5RuntimeSession, rollbackWeeklyPlanningStableV5RuntimeGraphFinalize } from '../weeklyPlanningStableV5RuntimeSession';
import { captureC5Question, serializeC5Value, serializeC5ApplicationState } from './basis';
import { bindC5CommitNextLedger, prepareC5TurnCommit } from './selection';
import { writeC5Checkpoint, type C5CheckpointWrite } from './checkpoint';
import type { C5LocalSelectionOptions, C5ReducerCommit, C5SelectedTurn } from './contracts';
import { recordWeeklyPlanningStableV5DebugTrace } from '../../trace/weeklyPlanningStableV5DebugTrace';

const recovery = new Map<string, () => WeeklyPlanningTurnSubmissionResult>();
const scopeKey = (ownerId: string, conversationId: string) => serializeC5Value([ownerId, conversationId]);

export function hasC5Recovery(ownerId: string, conversationId: string): boolean {
  return recovery.has(scopeKey(ownerId, conversationId));
}

/** Recovery inspects the same write/read receipt. It never repeats selection or applies another graph. */
export function recoverC5ControlledTurn(ownerId: string, conversationId: string): WeeklyPlanningTurnSubmissionResult {
  return recovery.get(scopeKey(ownerId, conversationId))?.() ?? { accepted: false, draftCandidates: [] };
}

export function readC5RuntimeGraph(ownerId: string, conversationId: string) {
  const session = getWeeklyPlanningStableV5RuntimeSession(conversationId);
  if (!session || session.ownerId !== ownerId) throw new Error('C5 runtime scope unavailable.');
  return session.graph;
}

export interface ControlledCandidateTurnInput {
  ownerId: string; snapshot: PlanningState; begun: PlanningState; pending: WeeklyPlanningPendingTurn;
  selected: C5SelectedTurn; result: WeeklyPlanningTurnExecutionResult; assistantMessage: WeeklyPlanningMessage;
  /** Synchronous, fresh domain/Unit 2 decision; an unbranded receipt is rejected by the reducer. */
  prepare(): C5ReducerCommit | null;
  bindNextQuestion?(state: WeeklyPlanningTurnExecutionResult['state']): WeeklyPlanningTurnExecutionResult['state'];
  branch: 'c5_local_selection' | 'd5_pending_selection';
  getState(): PlanningState; dispatch(action: WeeklyPlanningAction): PlanningState;
}

/** Actual runtime + reducer + one envelope, with no await after prepare. No provider/domain default. */
export function commitControlledCandidateTurn(input: ControlledCandidateTurnInput): WeeklyPlanningTurnSubmissionResult {
  const fail = (): WeeklyPlanningTurnSubmissionResult => ({ accepted: false, draftCandidates: [] });
  const selected = input.selected;
  if (!input.result.stableV5Graph || serializeC5Value(input.result.stableV5Graph) !== serializeC5Value(selected.graph)
    || input.result.state.draftGenerationIntent !== input.snapshot.intakeState?.draftGenerationIntent
    || input.result.state.draftGenerationAuthorizedAtRevision !== input.snapshot.intakeState?.draftGenerationAuthorizedAtRevision) return fail();
  const commit = input.prepare();
  if (!commit) return fail();
  const bound = bindWeeklyPlanningQuestionPresentation({
      state: { ...input.result.state, c5SelectionLedger: commit.nextLedger },
      content: input.result.questionPresentationContent,
      turnId: input.pending.turnId, assistantMessageId: input.assistantMessage.id,
      planningStateRevision: input.pending.baseRevision + 2, graphRevision: selected.graph.revision,
  });
  const state = input.bindNextQuestion?.(bound) ?? bound;
  // A next question may advance the epoch, but does not alter the consumed receipt.
  const reducerCommit = state.c5SelectionLedger ? bindC5CommitNextLedger(commit, state.c5SelectionLedger) : null;
  if (!reducerCommit) return fail();
  let receipt: ReturnType<typeof finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt>['receipt'];
  try {
    commitWeeklyPlanningStableV5RuntimeGraph({ ownerId: input.ownerId, conversationId: input.pending.conversationId, graph: selected.graph });
    receipt = finalizeWeeklyPlanningStableV5RuntimeGraphWithReceipt({ ownerId: input.ownerId, conversationId: input.pending.conversationId, requestId: input.pending.requestId }).receipt;
  } catch {
    discardWeeklyPlanningStableV5StagedGraph(input.pending);
    return fail();
  }
  const key = scopeKey(input.ownerId, input.pending.conversationId);
  const unknown = (recover: () => WeeklyPlanningTurnSubmissionResult): WeeklyPlanningTurnSubmissionResult => {
    recovery.set(key, recover);
    return { accepted: false, draftCandidates: [], recoveryRequired: true };
  };
  try {
    input.dispatch({ type: 'commit_turn', pending: input.pending, intakeState: state,
      assistantMessage: input.assistantMessage, draftCandidates: input.result.draftCandidates,
      preservePreviewCandidates: input.result.preserveExistingPreview, c5Commit: reducerCommit });
  } catch { /* Dispatch may commit then throw. Read authoritative state below. */ }
  let graphRolledBack = false;
  const rollback = (expected: PlanningState): WeeklyPlanningTurnSubmissionResult => {
    try {
      const live = input.getState();
      if (serializeC5ApplicationState(live) !== serializeC5ApplicationState(expected)
        && serializeC5ApplicationState(live) !== serializeC5ApplicationState(input.snapshot)) return unknown(() => rollback(expected));
      if (!graphRolledBack) {
        if (!rollbackWeeklyPlanningStableV5RuntimeGraphFinalize(receipt)) return unknown(() => rollback(expected));
        graphRolledBack = true;
      }
      if (serializeC5ApplicationState(live) !== serializeC5ApplicationState(input.snapshot)) {
        try { input.dispatch({ type: 'load_state', state: input.snapshot }); } catch { /* Read the actual result. */ }
      }
      if (serializeC5ApplicationState(input.getState()) !== serializeC5ApplicationState(input.snapshot)) return unknown(() => rollback(expected));
      recovery.delete(key);
      return fail();
    } catch { return unknown(() => rollback(expected)); }
  };
  let write: C5CheckpointWrite | undefined;
  let committed: PlanningState | undefined;
  const settle = (): WeeklyPlanningTurnSubmissionResult => {
    try {
      if (!committed) {
        const live = input.getState();
        const accepted = live.pendingTurn === undefined && live.weekStartDate === input.pending.weekStartDate
          && live.revision === input.pending.baseRevision + 2
          && live.messages[live.messages.length - 1]?.id === input.assistantMessage.id
          && serializeC5ApplicationState(live.intakeState ?? null) === serializeC5ApplicationState(state);
        if (!accepted) return rollback(input.begun);
        committed = live;
      }
      if (!write) write = writeC5Checkpoint({ ownerId: input.ownerId, conversationId: input.pending.conversationId,
        graph: selected.graph, planningState: committed });
      const status = write.recover();
      if (status === 'unknown') return unknown(settle);
      if (status === 'failed') return rollback(committed);
      // A durable receipt does not authorize overwriting intervening runtime work.
      if (serializeC5ApplicationState(input.getState()) !== serializeC5ApplicationState(committed)
        || serializeC5Value(readC5RuntimeGraph(input.ownerId, input.pending.conversationId)) !== serializeC5Value(selected.graph)) return unknown(settle);
      recovery.delete(key);
      recordWeeklyPlanningStableV5DebugTrace({ requestId: input.pending.requestId, stage: 'runtime_branch_selected',
        data: { branch: input.branch, basis: {}, output: { draftCandidates: [] } } });
      recordWeeklyPlanningStableV5DebugTrace({ requestId: input.pending.requestId, stage: 'semantic_canonicalization_evaluated',
        data: { branch: input.branch, result: { status: 'accepted' },
          adoptedOperations: [{ kind: 'local_candidate_selection', candidateCount: selected.selection.manifest.candidates.length,
            durableConsumption: true }] } });
      return { accepted: true, draftCandidates: input.result.draftCandidates };
    } catch { return unknown(settle); }
  };
  return settle();
}

/** C5 domain wrapper: generic reuse cannot bypass the narrow replacement proof. */
export function commitC5ControlledTurn(input: {
  ownerId: string; snapshot: PlanningState; begun: PlanningState; pending: WeeklyPlanningPendingTurn;
  userText: string; options: C5LocalSelectionOptions; selected: C5SelectedTurn;
  result: WeeklyPlanningTurnExecutionResult; assistantMessage: WeeklyPlanningMessage;
  getState(): PlanningState; dispatch(action: WeeklyPlanningAction): PlanningState;
}): WeeklyPlanningTurnSubmissionResult {
  return commitControlledCandidateTurn({ ...input, branch: 'c5_local_selection',
    prepare: () => prepareC5TurnCommit({ ...input,
      getGraph: () => readC5RuntimeGraph(input.ownerId, input.pending.conversationId) }, input.selected),
    bindNextQuestion: (state) => captureC5Question({ state, graph: input.selected.graph,
      ownerId: input.ownerId, conversationId: input.pending.conversationId }),
  });
}
