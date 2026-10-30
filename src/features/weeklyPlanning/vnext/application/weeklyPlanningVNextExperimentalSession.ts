// Experimental VNext conversation session (#926): one turn reads the checkpoint,
// lets the model interpret the words as a typed delta, applies it as one
// transaction, re-projects, and saves state, the presented question and the shown
// preview together. Approval saves exactly the shown preview through the existing
// approval executor and ledger. Nothing here is wired into production; the
// caller supplies every port (model, storage slots, plan repository, clock).
//
// Storage: VNext writes only its own checkpoint slot. A saved Stable V5
// checkpoint is read (never written) and migrated when the VNext slot is empty,
// so rolling back to V5 finds its own data exactly as it was.
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import {
  createWeeklyDraftApprovalOperation,
  executeWeeklyDraftApproval,
  parseWeeklyApprovalLedger,
  serializeWeeklyApprovalLedger,
  validateWeeklyPreviewApproval,
} from '../../planning/weeklyPlanningApproval';
import type { WeeklyDraftApprovalOperation } from '../../planning/weeklyPlanningApprovalTypes';
import {
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from '../../preview/weeklyPlanningPreviewBlocks';
import type { WeeklyPlanDraftBlock } from '../../types';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { compileWeeklyPlanningVNextSchedulerInput } from '../projection/weeklyPlanningVNextSchedulerGraph';
import {
  applyWeeklyPlanningVNextTurn,
  createEmptyWeeklyPlanningVNextState,
} from '../semantic/weeklyPlanningVNextTransaction';
import type {
  WeeklyPlanningVNextInterpretation,
  WeeklyPlanningVNextInterpretationClock,
  WeeklyPlanningVNextInterpreter,
} from '../weeklyPlanningVNextInterpretationContract';
import type {
  VNextQuestion,
  VNextTurnDelta,
  VNextTurnError,
  WeeklyPlanningVNextProjection,
  WeeklyPlanningVNextState,
} from '../weeklyPlanningVNextTypes';
import {
  parseWeeklyPlanningStableV5PersistedSession,
  scheduleWeeklyPlanningStableV5Preview,
} from '../weeklyPlanningVNextV5Boundary';
import { createVNextLineageResolver } from '../weeklyPlanningVNextWorkIdentity';
import { resolveWeeklyPlanningVNextTurnDelta } from './weeklyPlanningVNextAnswerBinding';
import {
  migrateWeeklyPlanningV5GraphToVNextSession,
  parseWeeklyPlanningVNextSessionCheckpoint,
  serializeWeeklyPlanningVNextSessionCheckpoint,
  type WeeklyPlanningVNextSessionCheckpoint,
  type WeeklyPlanningVNextShownPreview,
} from './weeklyPlanningVNextSessionCheckpoint';

export interface WeeklyPlanningVNextStorageSlot {
  read(): string | null;
  write(raw: string): void;
}

export interface WeeklyPlanningVNextExperimentalScope {
  ownerId: string;
  weekStartDate: string;
  conversationId: string;
  clock: WeeklyPlanningVNextInterpretationClock;
  /** Earliest placement time on clock.currentDate (HH:MM). */
  notBeforeTime: string;
}

export interface WeeklyPlanningVNextExperimentalPorts {
  client: OpenAiCompatibleClient;
  interpret: WeeklyPlanningVNextInterpreter;
  checkpoint: WeeklyPlanningVNextStorageSlot;
  /** The Stable V5 checkpoint slot, read-only. */
  legacyV5Checkpoint: Pick<WeeklyPlanningVNextStorageSlot, 'read'>;
  approvalLedger: WeeklyPlanningVNextStorageSlot;
  plans: {
    findExistingPlanId(sourceDraftBlockId: string): Promise<string | undefined>;
    saveBlock(block: WeeklyPlanDraftBlock, approvalOperationId: string): Promise<{ planId: string }>;
  };
  now(): string;
}

export type WeeklyPlanningVNextExperimentalRead =
  | { status: 'ready'; source: 'vnext' | 'migrated_v5' | 'empty'; checkpoint: WeeklyPlanningVNextSessionCheckpoint['vnext'] }
  /** Bytes that are neither format: never overwritten, never guessed. */
  | { status: 'unreadable' };

export type WeeklyPlanningVNextExperimentalTurnOutcome =
  | 'applied'
  | 'noop'
  | 'duplicate'
  /** The answer did not bind to what is shown now; the current question is shown again. */
  | 'answer_represented'
  | 'rejected'
  | 'interpretation_failed'
  /** The checkpoint changed while the model was reading (another turn): nothing is written. */
  | 'stale'
  | 'checkpoint_unreadable';

export interface WeeklyPlanningVNextExperimentalTurn {
  outcome: WeeklyPlanningVNextExperimentalTurnOutcome;
  graphRevision: number | null;
  readiness: WeeklyPlanningVNextProjection['readiness'] | null;
  question: VNextQuestion | null;
  preview: WeeklyPlanningVNextShownPreview | null;
  /** Owners not placed because their question was deferred. */
  unplacedOwnerKeys: string[];
  /** Scheduler issue or status codes when nothing is asked yet no preview could be made; never silent. */
  previewBlockedBy: string[];
  /** Deterministic reply text; the experiment does not call a renderer model. */
  reply: string;
  interpretation: WeeklyPlanningVNextInterpretation | null;
  appliedDelta: VNextTurnDelta | null;
  errors: VNextTurnError[];
}

export function readWeeklyPlanningVNextExperimentalSession(
  scope: Pick<WeeklyPlanningVNextExperimentalScope, 'ownerId' | 'weekStartDate' | 'conversationId'>,
  ports: Pick<WeeklyPlanningVNextExperimentalPorts, 'checkpoint' | 'legacyV5Checkpoint'>,
): WeeklyPlanningVNextExperimentalRead {
  const raw = ports.checkpoint.read();
  if (raw !== null) {
    const parsed = parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate });
    return parsed && parsed.conversationId === scope.conversationId
      ? { status: 'ready', source: 'vnext', checkpoint: parsed.vnext }
      : { status: 'unreadable' };
  }
  const legacy = ports.legacyV5Checkpoint.read();
  if (legacy === null) {
    return { status: 'ready', source: 'empty', checkpoint: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null } };
  }
  const v5 = parseWeeklyPlanningStableV5PersistedSession({ raw: legacy, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate });
  if (!v5 || v5.conversationId !== scope.conversationId) return { status: 'unreadable' };
  // Presented questions and previews were made against the V5 revision; migration moves past it.
  return {
    status: 'ready',
    source: 'migrated_v5',
    checkpoint: { state: migrateWeeklyPlanningV5GraphToVNextSession(v5.graph).state, presentedQuestion: null, preview: null },
  };
}

function shownPreview(
  scope: WeeklyPlanningVNextExperimentalScope,
  state: WeeklyPlanningVNextState,
  projection: WeeklyPlanningVNextProjection,
): { preview: WeeklyPlanningVNextShownPreview | null; unplacedOwnerKeys: string[]; previewBlockedBy: string[] } {
  const compiled = compileWeeklyPlanningVNextSchedulerInput({
    state,
    projection,
    context: {
      ownerId: scope.ownerId,
      currentDate: scope.clock.currentDate,
      planningStartDate: scope.clock.planningStartDate,
      planningEndDate: scope.clock.planningEndDate,
      timeZone: scope.clock.timeZone,
    },
  });
  if (compiled.status !== 'compiled') return { preview: null, unplacedOwnerKeys: [], previewBlockedBy: [] };
  if (!compiled.compilation.input) {
    const codes = compiled.compilation.issues.filter((issue) => issue.blocking).map((issue) => issue.code);
    return { preview: null, unplacedOwnerKeys: compiled.unplacedOwnerKeys,
      previewBlockedBy: compiled.compilation.status === 'empty' ? [] : [...new Set(codes.length ? codes : [compiled.compilation.status])] };
  }
  const scheduled = scheduleWeeklyPlanningStableV5Preview({
    input: compiled.compilation.input,
    graph: compiled.placementGraph,
    notBefore: { date: scope.clock.currentDate, time: scope.notBeforeTime },
  });
  if (scheduled.status !== 'ready') {
    return { preview: null, unplacedOwnerKeys: compiled.unplacedOwnerKeys,
      previewBlockedBy: scheduled.status === 'empty' ? [] : [scheduled.status] };
  }
  // Candidates carry the conversation of their stated facts; the preview id is per conversation and revision.
  const blocks = createWeeklyPlanningPreviewBlocks(scheduled.candidates)
    .map((block) => createWeeklyPlanningPreviewDisplayBlock(block, scope.ownerId));
  const previewId = blocks[0]?.behaviorMetadata?.previewMetadata?.previewId;
  return {
    preview: previewId ? { previewId, graphRevision: state.graph.revision, blocks } : null,
    unplacedOwnerKeys: compiled.unplacedOwnerKeys,
    previewBlockedBy: [],
  };
}

function taskTitle(state: WeeklyPlanningVNextState, taskId: string): string {
  const leaf = createVNextLineageResolver(state.graph).leafOf(taskId) ?? taskId;
  return state.graph.tasks.find((task) => task.id === leaf)?.title ?? '';
}

function replyFor(state: WeeklyPlanningVNextState, question: VNextQuestion | null,
  preview: WeeklyPlanningVNextShownPreview | null, outcome: WeeklyPlanningVNextExperimentalTurnOutcome,
  previewBlockedBy: string[]): string {
  if (outcome === 'stale') return '別の操作で会話が更新されました。最新の内容でもう一度送ってください。';
  if (outcome === 'interpretation_failed' || outcome === 'rejected') {
    return 'うまく反映できませんでした。もう一度、言い方を変えて教えてください。';
  }
  if (question) {
    const title = taskTitle(state, question.taskId);
    if (question.code === 'missing_schedulable_work') return `「${title}」は、どれくらいやりますか？（時間や量）`;
    if (question.code === 'missing_effort_estimate' && question.forWork) {
      return `「${title}」の${question.forWork.amount}は、全部で何分くらいかかりそうですか？`;
    }
    const values = question.options.map((option) => option.value).join(' / ');
    return `「${title}」について確認させてください（${question.code}${values ? `: ${values}` : ''}）。`;
  }
  if (preview) {
    const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const minutes = preview.blocks.reduce((sum, block) => sum + clockMinutes(block.endTime) - clockMinutes(block.startTime), 0);
    return `${preview.blocks.length}件、合計${minutes}分の予定案を作りました。保存しますか？`;
  }
  if (previewBlockedBy.length) return `予定案を作れませんでした（${previewBlockedBy.join(', ')}）。`;
  return '予定にする作業を教えてください。';
}

const isEmpty = (delta: VNextTurnDelta) =>
  delta.add.length + delta.patch.length + delta.remove.length + delta.relate.length + delta.defer.length === 0;

/** One user turn. Every step reads from and writes to the checkpoint slot, so a reload is the normal path. */
export async function submitWeeklyPlanningVNextExperimentalTurn(params: {
  scope: WeeklyPlanningVNextExperimentalScope;
  ports: WeeklyPlanningVNextExperimentalPorts;
  turnId: string;
  userText: string;
}): Promise<WeeklyPlanningVNextExperimentalTurn> {
  const { scope, ports } = params;
  const rawBefore = ports.checkpoint.read();
  const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
  if (read.status !== 'ready') {
    return { outcome: 'checkpoint_unreadable', graphRevision: null, readiness: null, question: null, preview: null,
      unplacedOwnerKeys: [], previewBlockedBy: [], reply: '保存された会話を読み込めませんでした。', interpretation: null, appliedDelta: null, errors: [] };
  }
  let { state } = read.checkpoint;
  const before = projectWeeklyPlanningVNext(state);
  const presented = read.checkpoint.presentedQuestion;
  const presentedQuestion = presented && presented.graphRevision === state.graph.revision
    ? before.questions.find((question) => question.key === presented.questionKey) ?? null
    : null;

  const interpretation = await ports.interpret({
    client: ports.client, state, projection: before, presentedQuestion, userText: params.userText, clock: scope.clock,
  });

  // The turn was read against `rawBefore`; if another turn saved meanwhile, applying
  // this reading would overwrite it. Nothing is written; the user sends it again.
  if (ports.checkpoint.read() !== rawBefore) {
    return { outcome: 'stale', graphRevision: state.graph.revision, readiness: before.readiness, question: presentedQuestion,
      preview: read.checkpoint.preview, unplacedOwnerKeys: [], previewBlockedBy: [],
      reply: replyFor(state, null, null, 'stale', []), interpretation, appliedDelta: null, errors: [] };
  }

  let outcome: WeeklyPlanningVNextExperimentalTurnOutcome;
  let delta: VNextTurnDelta | null = null;
  let errors: VNextTurnError[] = [];
  if (interpretation.status === 'failed') {
    outcome = 'interpretation_failed';
    errors = interpretation.errors;
  } else {
    // The checkpoint stores the presented question with the reply it was shown in, so it is that reply's question.
    const resolution = resolveWeeklyPlanningVNextTurnDelta({
      presentationFresh: true,
      presented,
      projection: before,
      graph: state.graph,
      interpreted: interpretation,
    });
    delta = resolution.status === 'delta' ? resolution.delta : null;
    if (resolution.status === 'conflict') errors = resolution.errors;
    if (resolution.status === 'conflict') {
      outcome = 'rejected';
    } else if (delta === null) {
      outcome = 'answer_represented';
    } else if (isEmpty(delta)) {
      outcome = 'noop';
    } else {
      const result = applyWeeklyPlanningVNextTurn(state, delta, {
        turnKey: `${scope.conversationId}:${params.turnId}`,
        acceptedDate: scope.clock.currentDate,
        expectedRevision: state.graph.revision,
        conversationId: scope.conversationId,
        turnId: params.turnId,
        sourceText: params.userText,
      });
      outcome = result.status;
      state = result.state;
      if (result.status === 'rejected') errors = result.errors;
    }
  }

  const projection = projectWeeklyPlanningVNext(state);
  const question = projection.questions[0] ?? null;
  // A shown preview belongs to its revision: while the revision is current it is
  // exactly what the user saw (and may have approved), so it is not made again.
  const shown = read.checkpoint.preview;
  const made = question
    ? { preview: null, unplacedOwnerKeys: [], previewBlockedBy: [] }
    : shownPreview(scope, state, projection);
  const { preview, unplacedOwnerKeys, previewBlockedBy } = !question && shown && shown.graphRevision === state.graph.revision
    ? { preview: shown, unplacedOwnerKeys: made.unplacedOwnerKeys, previewBlockedBy: [] }
    : made;
  const raw = serializeWeeklyPlanningVNextSessionCheckpoint({
    ownerId: scope.ownerId,
    weekStartDate: scope.weekStartDate,
    conversationId: scope.conversationId,
    vnext: {
      state,
      presentedQuestion: question ? { questionKey: question.key, graphRevision: projection.graphRevision } : null,
      preview,
    },
    savedAt: ports.now(),
  });
  if (raw === null) throw new Error('VNext checkpoint exceeds the storage limit');
  ports.checkpoint.write(raw);
  return {
    outcome,
    graphRevision: state.graph.revision,
    readiness: projection.readiness,
    question,
    preview,
    unplacedOwnerKeys,
    previewBlockedBy,
    reply: replyFor(state, question, preview, outcome, previewBlockedBy),
    interpretation,
    appliedDelta: outcome === 'applied' ? delta : null,
    errors,
  };
}

export type WeeklyPlanningVNextExperimentalApproval =
  | { status: 'rejected'; reason: string }
  | { status: 'executed'; operation: WeeklyDraftApprovalOperation };

/**
 * Saves the shown preview. The existing approval guard checks it against the
 * current revision; the ledger records each block, so a partial save resumes
 * with the same operation and an approved preview is never saved twice.
 */
export async function approveWeeklyPlanningVNextExperimentalPreview(params: {
  scope: WeeklyPlanningVNextExperimentalScope;
  ports: WeeklyPlanningVNextExperimentalPorts;
}): Promise<WeeklyPlanningVNextExperimentalApproval> {
  const { scope, ports } = params;
  const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
  if (read.status !== 'ready' || read.source !== 'vnext' || !read.checkpoint.preview) {
    return { status: 'rejected', reason: 'no-shown-preview' };
  }
  const { preview, state } = read.checkpoint;
  const guard = validateWeeklyPreviewApproval({
    blocks: preview.blocks,
    currentStateRevision: state.graph.revision,
    userId: scope.ownerId,
    proposalRecords: [],
    runtimeSnapshot: { conversationId: scope.conversationId, stateRevision: state.graph.revision, proposalRecords: [] },
  });
  if (!guard.allowed) return { status: 'rejected', reason: guard.attempt.kind };

  const ledgerRaw = ports.approvalLedger.read();
  const ledger = ledgerRaw === null ? { operations: [] } : parseWeeklyApprovalLedger(ledgerRaw);
  if (!ledger) return { status: 'rejected', reason: 'approval-ledger-unreadable' };
  const existing = ledger.operations.find((operation) => operation.userId === scope.ownerId
    && operation.previewId === guard.metadata.previewId && operation.previewStateRevision === guard.metadata.stateRevision);
  const operation = await executeWeeklyDraftApproval({
    operation: existing ?? createWeeklyDraftApprovalOperation({
      userId: scope.ownerId, metadata: guard.metadata, blocks: preview.blocks, now: ports.now(),
    }),
    blocks: preview.blocks,
    dependencies: {
      findExistingPlanId: ({ sourceDraftBlockId }) => ports.plans.findExistingPlanId(sourceDraftBlockId),
      saveBlock: ({ block, source }) => ports.plans.saveBlock(block, source.approvalOperationId),
      now: ports.now,
    },
  });
  ports.approvalLedger.write(serializeWeeklyApprovalLedger([
    ...ledger.operations.filter((candidate) => candidate.approvalOperationId !== operation.approvalOperationId),
    operation,
  ]));
  return { status: 'executed', operation };
}
