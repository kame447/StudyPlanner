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
import { projectWeeklyPlanningVNext, type WeeklyPlanningVNextObservedMemoryPace } from '../projection/weeklyPlanningVNextProjection';
import { vnextUnitIdentity } from '../weeklyPlanningVNextWorkIdentity';
import type { Actual, MonthEvent, Plan, ScheduleTemplate } from '../../../../types/domain';
import { deriveWeeklyPlanningMemoryPaceEstimateV5 } from '../../personalization/weeklyPlanningMemoryPaceObservationsV5';
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
  createStableV5ExternalConstraintSources,
  deriveWeeklyPlanningEstimateCalibration,
  scheduleWeeklyPlanningStableV5Preview,
  RENDERER_PREVIEW_CONTINGENCY,
  RENDERER_TECHNICAL_STOP,
  recoveryQuestionEvidenceForStableV5Dialogue,
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

/**
 * The user's existing schedule and records, read-only and read once per turn: placement avoids the
 * schedule exactly as Stable V5 does, and recorded memory-pace results give the observed pace.
 */
export interface WeeklyPlanningVNextCalendar {
  plans: readonly Plan[];
  actuals: readonly Actual[];
  monthEvents: readonly MonthEvent[];
  scheduleTemplates: readonly ScheduleTemplate[];
  timetableTermId?: string;
}

/**
 * Observed minutes per unit for the units of the stated work, by Stable V5's own derivation. V5 matches
 * only the unit code; VNext's unit identity also tells custom units apart by label, so each identity
 * reads only the calibration plans measured in that same unit (V5 validates each result against its plan).
 */
function observedMemoryPace(state: WeeklyPlanningVNextState, calendar: WeeklyPlanningVNextCalendar): WeeklyPlanningVNextObservedMemoryPace {
  const pace: Record<string, number> = {};
  const units = new Map(state.graph.workloads.map((workload) => [vnextUnitIdentity(workload), workload.unitCode]));
  for (const [identity, unitCode] of units) {
    const plans = calendar.plans.filter((plan) => plan.weeklyPlanningObservationSource !== undefined
      && vnextUnitIdentity(plan.weeklyPlanningObservationSource) === identity);
    const observed = deriveWeeklyPlanningMemoryPaceEstimateV5({ plans, actuals: calendar.actuals, unitCode });
    if (observed.observationCount > 0 && observed.medianMinutesPerUnit !== null) pace[identity] = observed.medianMinutesPerUnit;
  }
  return pace;
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
  /**
   * The Stable V5 dialogue renderer: explains the turn's result, never changes state. Made per turn,
   * as V5 does, so a failed turn's recovery reply can check it is still current before each call.
   */
  createRenderer(options: { canDispatchRecovery: () => boolean }): WeeklyPlanningStableV5DialogueRenderer;
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
  /**
   * renderer: the V5 renderer's text; renderer_recovery: its verified reply to a failed turn (nothing was
   * applied); renderer_fallback: V5's contingency text (the question counts as not shown); system: a notice.
   */
  replySource: 'renderer' | 'renderer_recovery' | 'renderer_fallback' | 'system';
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
  calendar: WeeklyPlanningVNextCalendar,
  state: WeeklyPlanningVNextState,
  projection: WeeklyPlanningVNextProjection,
): { preview: WeeklyPlanningVNextShownPreview | null; unplacedOwnerKeys: string[]; previewBlockedBy: string[] } {
  const context = schedulingContext(scope, ports, state);
  // V5 resolves source selection; placement still enforces raw calendar busy time after stop_using.
  // ConstraintSources tests guard the use/stop and unavailable-source controls through this boundary.
  const externalSources = createStableV5ExternalConstraintSources({ ownerId: scope.ownerId,
    plans: calendar.plans, monthEvents: calendar.monthEvents, templates: calendar.scheduleTemplates,
    timetableTermId: calendar.timetableTermId,
    horizon: { startDate: context.planningStartDate, endDate: context.planningEndDate }, timeZone: context.timeZone });
  const estimateCalibration = deriveWeeklyPlanningEstimateCalibration({ plans: calendar.plans, actuals: calendar.actuals });
  const compiled = compileWeeklyPlanningVNextSchedulerInput({ state, projection, context, externalSources,
    estimateCalibrationMultiplier: estimateCalibration.multiplier });
  if (compiled.status !== 'compiled') return { preview: null, unplacedOwnerKeys: [], previewBlockedBy: [] };
  if (!compiled.compilation.input) {
    const codes = compiled.compilation.issues.filter((issue) => issue.blocking).map((issue) => issue.code);
    return { preview: null, unplacedOwnerKeys: compiled.unplacedOwnerKeys,
      previewBlockedBy: compiled.compilation.status === 'empty' ? [] : [...new Set(codes.length ? codes : [compiled.compilation.status])] };
  }
  const scheduled = scheduleWeeklyPlanningStableV5Preview({
    input: compiled.compilation.input,
    graph: compiled.placementGraph,
    plans: calendar.plans,
    monthEvents: calendar.monthEvents,
    scheduleTemplates: calendar.scheduleTemplates,
    timetableTermId: calendar.timetableTermId,
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
  !delta.proposalDecision && delta.add.length + delta.patch.length + delta.remove.length + delta.relate.length + delta.defer.length === 0;

/**
 * One user turn. Every step reads from and writes to the checkpoint slot, so a reload is the normal path.
 * Order (each step has one owner; do not reorder): read the checkpoint bytes → interpret against
 * them (horizon and dates from the state, the shown reply as context) → stale check → bind the answer
 * (answer binding) → one transaction → project → preview (V5 placement) → render (V5 renderer) →
 * stale check again → bind what was displayed → one write. Breaks if reordered: a write before a
 * stale check overwrites another tab; binding from the state's question instead of the display
 * pairs a question with a notice (user audit S01). Tests: integration "writes nothing when another
 * turn saved…", "a failure notice never becomes the presented question…", OptionChoice
 * "reads a reply to an older revision without its question…".
 */
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
  // One calendar snapshot per turn: the observed pace before and after the turn, and the preview, agree.
  const calendar = ports.calendar();
  const pace = observedMemoryPace(state, calendar);
  const before = projectWeeklyPlanningVNext(state, pace);
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
    observedMemoryPace: pace,
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
        observedMemoryPace: pace,
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

  const projection = projectWeeklyPlanningVNext(state, observedMemoryPace(state, calendar));
  const question = projection.questions[0] ?? null;
  // A shown preview belongs to its revision: while the revision is current it is
  // exactly what the user saw (and may have approved), so it is not made again.
  const shown = read.checkpoint.preview;
  const made = question
    ? { preview: null, unplacedOwnerKeys: [], previewBlockedBy: [] }
    : shownPreview(scope, ports, calendar, state, projection);
  const { preview, unplacedOwnerKeys, previewBlockedBy } = !question && shown && shown.graphRevision === state.graph.revision
    ? { preview: shown, unplacedOwnerKeys: made.unplacedOwnerKeys, previewBlockedBy: [] }
    : made;
  // Everything the user is told about the plan comes from the renderer; only a blocked preview and a
  // failed turn the renderer could not verify are notices. What the reply shows decides, once, which
  // question the user's next words answer (it is not the question the state still asks): a question it
  // shows, with this text; 'none' when it shows no question; 'unchanged' when it adds nothing new, so an
  // earlier shown question stays bound while it is still asked at the same revision (user audit S01).
  const previous = read.checkpoint.presentedQuestion;
  const stillShown = previous !== null && previous.graphRevision === projection.graphRevision
    ? projection.questions.find((asked) => asked.key === previous.questionKey) ?? null : null;
  const renderBase = (shownQuestion: VNextQuestion | null, shownPreview: WeeklyPlanningVNextShownPreview | null) =>
    createWeeklyPlanningVNextRenderInput({
      state, question: shownQuestion, preview: shownPreview, actionId: `${scope.conversationId}:${params.turnId}`,
      turnId: params.turnId, previousQuestionCode: presentedQuestion?.code ?? null, userText: params.userText,
      recentConversation: read.checkpoint.messages,
    });
  // The renderer is a model call: it may run only while this turn is still current.
  const canDispatchRecovery = () => ports.checkpoint.read() === rawBefore;
  let reply: string;
  let replySource: WeeklyPlanningVNextExperimentalTurn['replySource'];
  let shows: { question: VNextQuestion } | 'none' | 'unchanged';
  if (outcome === 'interpretation_failed' || outcome === 'rejected') {
    // As Stable V5 recovers a failed turn: nothing was applied; the renderer says so and asks again the
    // question still shown (only with its reconstructible evidence), and a second call verifies the reply.
    // Unverified, unavailable or no longer current → the fixed notice.
    const base = renderBase(stillShown, null);
    const evidence = stillShown ? recoveryQuestionEvidenceForStableV5Dialogue(base) : undefined;
    const rendered = stillShown && !evidence ? null : await ports.createRenderer({ canDispatchRecovery }).render({
      ...base,
      currentTurnGrounding: { mode: 'none', acceptedFacts: [] },
      fallbackText: '',
      previewCount: 0,
      recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true,
        // Said from the preview this turn keeps, the one decision above (the calendar can change a
        // projection without a revision change, so the shown revision alone does not say it stays).
        retainedPreviewUnchanged: preview !== null && preview === shown },
      ...(evidence ? { recoveryQuestionEvidence: evidence } : {}),
    });
    if (rendered?.status === 'rendered' && rendered.recoveryVerified === true && canDispatchRecovery()) {
      reply = rendered.text;
      replySource = 'renderer_recovery';
      shows = stillShown ? { question: stillShown } : 'unchanged';
    } else {
      reply = systemReply(outcome, []);
      replySource = 'system';
      shows = 'unchanged';
    }
    if (!canDispatchRecovery()) return staleTurn();
  } else if (previewBlockedBy.length) {
    reply = systemReply(outcome, previewBlockedBy);
    replySource = 'system';
    shows = 'unchanged';
  } else {
    const rendered = await ports.createRenderer({ canDispatchRecovery }).render(renderBase(question, preview));
    if (rendered.status === 'rendered') {
      reply = rendered.text;
      replySource = 'renderer';
      shows = question ? { question } : 'none';
    } else {
      // As in Stable V5: the preview stays (unsaved) and is said so; a question that was not shown is not presented.
      reply = preview ? RENDERER_PREVIEW_CONTINGENCY : RENDERER_TECHNICAL_STOP;
      replySource = 'renderer_fallback';
      shows = 'none';
    }
    // If another turn saved meanwhile, nothing of this turn is written.
    if (!canDispatchRecovery()) return staleTurn();
  }
  const presentedQuestionRecord = typeof shows === 'object'
    ? { questionKey: shows.question.key, graphRevision: projection.graphRevision, shownText: reply }
    : shows === 'unchanged' && stillShown ? previous : null;
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
 * The save boundary: only this function writes plans, and only blocks that were shown. Do not save
 * from a turn or re-schedule here (the user approves what they saw). Tests: integration
 * "asks, binds the answer…saves partially, resumes, and never saves twice", "a correction before
 * approval replaces the shown preview…".
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
