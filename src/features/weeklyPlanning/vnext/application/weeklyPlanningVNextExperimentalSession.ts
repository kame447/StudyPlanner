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
import type { MonthEvent, Plan, ScheduleTemplate } from '../../../../types/domain';
import type { GenericSchedulerInputContext } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import {
  compileWeeklyPlanningVNextSchedulerInput,
  createWeeklyPlanningVNextSchedulerContext,
} from '../projection/weeklyPlanningVNextSchedulerGraph';
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
  RENDERER_PREVIEW_CONTINGENCY,
  RENDERER_TECHNICAL_STOP,
  type WeeklyPlanningStableV5DialogueRenderer,
} from '../weeklyPlanningVNextV5Boundary';
import { resolveWeeklyPlanningVNextTurnDelta } from './weeklyPlanningVNextAnswerBinding';
import { createWeeklyPlanningVNextRenderInput, VNEXT_RECENT_MESSAGE_LIMIT } from './weeklyPlanningVNextDialogue';
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
  /**
   * clock.planningStartDate/EndDate is the selected week: the horizon until a planning window is
   * stated, and the default the session gives the model and the transaction.
   */
  clock: Omit<WeeklyPlanningVNextInterpretationClock, 'defaultPlanningHorizon'>;
  /** Earliest placement time on clock.currentDate (HH:MM): the time the turn is planned from. */
  notBeforeTime: string;
}

/** The user's existing schedule, read-only: placement avoids it exactly as Stable V5 does. */
export interface WeeklyPlanningVNextCalendar {
  plans: readonly Plan[];
  monthEvents: readonly MonthEvent[];
  scheduleTemplates: readonly ScheduleTemplate[];
  timetableTermId?: string;
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
  calendar(): WeeklyPlanningVNextCalendar;
  /** The Stable V5 dialogue renderer: explains the turn's result, never changes state. */
  renderer: WeeklyPlanningStableV5DialogueRenderer;
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
  reply: string;
  /** renderer: the V5 renderer's text; renderer_fallback: V5's contingency text (the question counts as not shown); system: a failure or stop notice. */
  replySource: 'renderer' | 'renderer_fallback' | 'system';
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
    return { status: 'ready', source: 'empty', checkpoint: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [] } };
  }
  const v5 = parseWeeklyPlanningStableV5PersistedSession({ raw: legacy, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate });
  if (!v5 || v5.conversationId !== scope.conversationId) return { status: 'unreadable' };
  // Presented questions and previews were made against the V5 revision; migration moves past it.
  return {
    status: 'ready',
    source: 'migrated_v5',
    checkpoint: { state: migrateWeeklyPlanningV5GraphToVNextSession(v5.graph, v5.planningState.intakeState?.groundingRecords).state,
      presentedQuestion: null, preview: null, messages: [] },
  };
}

/** The scheduling context of a state: horizon from its planning window (or the selected week), by V5's resolvers. */
function schedulingContext(scope: WeeklyPlanningVNextExperimentalScope, ports: WeeklyPlanningVNextExperimentalPorts,
  state: WeeklyPlanningVNextState): GenericSchedulerInputContext {
  const { currentDate, timeZone, planningStartDate } = scope.clock;
  return createWeeklyPlanningVNextSchedulerContext({
    state,
    ownerId: scope.ownerId,
    selectedDate: planningStartDate,
    requestContext: { startedAtIso: ports.now(), timeZone, currentDate, currentTime: scope.notBeforeTime,
      notBeforeDate: currentDate, notBeforeTime: scope.notBeforeTime, weekStartsOn: scope.clock.weekStartsOn },
  });
}

function shownPreview(
  scope: WeeklyPlanningVNextExperimentalScope,
  ports: WeeklyPlanningVNextExperimentalPorts,
  state: WeeklyPlanningVNextState,
  projection: WeeklyPlanningVNextProjection,
): { preview: WeeklyPlanningVNextShownPreview | null; unplacedOwnerKeys: string[]; previewBlockedBy: string[] } {
  const compiled = compileWeeklyPlanningVNextSchedulerInput({ state, projection, context: schedulingContext(scope, ports, state) });
  if (compiled.status !== 'compiled') return { preview: null, unplacedOwnerKeys: [], previewBlockedBy: [] };
  if (!compiled.compilation.input) {
    const codes = compiled.compilation.issues.filter((issue) => issue.blocking).map((issue) => issue.code);
    return { preview: null, unplacedOwnerKeys: compiled.unplacedOwnerKeys,
      previewBlockedBy: compiled.compilation.status === 'empty' ? [] : [...new Set(codes.length ? codes : [compiled.compilation.status])] };
  }
  const scheduled = scheduleWeeklyPlanningStableV5Preview({
    input: compiled.compilation.input,
    graph: compiled.placementGraph,
    ...ports.calendar(),
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

/** Notices for turns that changed nothing the renderer could explain: a failure, a stale turn, or a blocked preview. */
function systemReply(outcome: WeeklyPlanningVNextExperimentalTurnOutcome, previewBlockedBy: string[]): string {
  if (outcome === 'stale') return '別の操作で会話が更新されました。最新の内容でもう一度送ってください。';
  if (outcome === 'interpretation_failed' || outcome === 'rejected') {
    return 'うまく反映できませんでした。もう一度、言い方を変えて教えてください。';
  }
  return `予定案を作れませんでした（${previewBlockedBy.join(', ')}）。`;
}

const isEmpty = (delta: VNextTurnDelta) =>
  delta.add.length + delta.patch.length + delta.remove.length + delta.relate.length + delta.defer.length === 0;

/** One user turn. Every step reads from and writes to the checkpoint slot, so a reload is the normal path. */
export async function submitWeeklyPlanningVNextExperimentalTurn(params: {
  scope: WeeklyPlanningVNextExperimentalScope;
  ports: WeeklyPlanningVNextExperimentalPorts;
  turnId: string;
  userText: string;
  /**
   * Graph revision of the reply the user is answering (`graphRevision` of the turn shown), or null
   * before any reply. Another tab may have moved the conversation on since; then the stored question is
   * not the one the user saw, and the words are read without it.
   */
  shownRevision: number | null;
}): Promise<WeeklyPlanningVNextExperimentalTurn> {
  const { scope, ports } = params;
  const rawBefore = ports.checkpoint.read();
  const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
  if (read.status !== 'ready') {
    return { outcome: 'checkpoint_unreadable', graphRevision: null, readiness: null, question: null, preview: null,
      unplacedOwnerKeys: [], previewBlockedBy: [], reply: '保存された会話を読み込めませんでした。', replySource: 'system',
      interpretation: null, appliedDelta: null, errors: [] };
  }
  let { state } = read.checkpoint;
  const before = projectWeeklyPlanningVNext(state);
  const presented = read.checkpoint.presentedQuestion;
  const presentationFresh = presented !== null && presented.graphRevision === params.shownRevision;
  const presentedQuestion = presentationFresh && presented.graphRevision === state.graph.revision
    ? before.questions.find((question) => question.key === presented.questionKey) ?? null
    : null;

  // The model reads dates against the horizon the state currently has (a stated planning window moves it).
  const horizon = schedulingContext(scope, ports, state);
  const clock: WeeklyPlanningVNextInterpretationClock = { ...scope.clock,
    planningStartDate: horizon.planningStartDate || scope.clock.planningStartDate,
    planningEndDate: horizon.planningEndDate || scope.clock.planningEndDate,
    defaultPlanningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate } };
  const interpretation = await ports.interpret({
    client: ports.client, state, projection: before, presentedQuestion, userText: params.userText, clock,
    // The reply the question was shown in: what the user's words answer (e.g. an ordinal over its options).
    presentedText: presentedQuestion ? presented!.shownText : null,
  });

  // The turn was read against `rawBefore`; if another turn saved meanwhile, applying
  // this reading would overwrite it. Nothing is written; the user sends it again.
  const staleTurn = (): WeeklyPlanningVNextExperimentalTurn => ({ outcome: 'stale', graphRevision: read.checkpoint.state.graph.revision,
    readiness: before.readiness, question: presentedQuestion, preview: read.checkpoint.preview, unplacedOwnerKeys: [], previewBlockedBy: [],
    reply: systemReply('stale', []), replySource: 'system', interpretation, appliedDelta: null, errors: [] });
  if (ports.checkpoint.read() !== rawBefore) return staleTurn();

  let outcome: WeeklyPlanningVNextExperimentalTurnOutcome;
  let delta: VNextTurnDelta | null = null;
  let errors: VNextTurnError[] = [];
  if (interpretation.status === 'failed') {
    outcome = 'interpretation_failed';
    errors = interpretation.errors;
  } else {
    // The checkpoint stores the presented question with the reply it was shown in; it is the question
    // answered only when that reply is the one the user saw.
    const resolution = resolveWeeklyPlanningVNextTurnDelta({
      presentationFresh,
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
        // Dates are fixed against the same horizon and week the model read them with.
        weekStartsOn: clock.weekStartsOn,
        planningHorizon: { startDate: clock.planningStartDate, endDate: clock.planningEndDate },
        defaultPlanningHorizon: clock.defaultPlanningHorizon,
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
    : shownPreview(scope, ports, state, projection);
  const { preview, unplacedOwnerKeys, previewBlockedBy } = !question && shown && shown.graphRevision === state.graph.revision
    ? { preview: shown, unplacedOwnerKeys: made.unplacedOwnerKeys, previewBlockedBy: [] }
    : made;
  // Failures and stops are notices; everything the user is told about the plan comes from the renderer.
  let reply: string;
  let replySource: WeeklyPlanningVNextExperimentalTurn['replySource'];
  if (outcome === 'interpretation_failed' || outcome === 'rejected' || previewBlockedBy.length) {
    reply = systemReply(outcome, previewBlockedBy);
    replySource = 'system';
  } else {
    const rendered = await ports.renderer.render(createWeeklyPlanningVNextRenderInput({
      state, question, preview, actionId: `${scope.conversationId}:${params.turnId}`, turnId: params.turnId,
      previousQuestionCode: presentedQuestion?.code ?? null, userText: params.userText,
      recentConversation: read.checkpoint.messages,
    }));
    if (rendered.status === 'rendered') {
      reply = rendered.text;
      replySource = 'renderer';
    } else {
      // As in Stable V5: the preview stays (unsaved) and is said so; a question that was not shown is not presented.
      reply = preview ? RENDERER_PREVIEW_CONTINGENCY : RENDERER_TECHNICAL_STOP;
      replySource = 'renderer_fallback';
    }
    // The renderer is a model call: if another turn saved meanwhile, nothing of this turn is written.
    if (ports.checkpoint.read() !== rawBefore) return staleTurn();
  }
  // What the user now sees decides, once, which question their next words answer. The question the
  // state still asks is not the same thing: a rendered reply shows it with this text; a failed render
  // shows none; a notice shows no new question, so an earlier shown question stays bound only while
  // it is still asked at the same revision (it is still on screen above the notice).
  const previous = read.checkpoint.presentedQuestion;
  const presentedQuestionRecord = replySource === 'renderer'
    ? (question ? { questionKey: question.key, graphRevision: projection.graphRevision, shownText: reply } : null)
    : replySource === 'system' && previous !== null && previous.graphRevision === projection.graphRevision
      && projection.questions.some((asked) => asked.key === previous.questionKey) ? previous : null;
  const raw = serializeWeeklyPlanningVNextSessionCheckpoint({
    ownerId: scope.ownerId,
    weekStartDate: scope.weekStartDate,
    conversationId: scope.conversationId,
    vnext: {
      state,
      presentedQuestion: presentedQuestionRecord,
      preview,
      messages: [...read.checkpoint.messages, { role: 'user' as const, content: params.userText },
        { role: 'assistant' as const, content: reply }].slice(-VNEXT_RECENT_MESSAGE_LIMIT),
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
    reply,
    replySource,
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
