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
import { resolveVNextPlanningAuthorization, type VNextAuthorizationDecision } from './weeklyPlanningVNextPlanningAuthorization';
import {
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from '../../preview/weeklyPlanningPreviewBlocksCore';
import type { WeeklyPlanDraftBlock } from '../../types';
import type { WeeklyDraftCandidate } from '../../scheduling/weeklyDraftCandidateGenerator';
import { projectWeeklyPlanningVNext, vnextQuestionKeyAllowsProvisionalTimebox,
  type WeeklyPlanningVNextObservedMemoryPace } from '../projection/weeklyPlanningVNextProjection';
import { projectWeeklyPlanningFixedEventRegistration, weeklyPlanningFixedEventRegistrationFacts,
  fixedEventOnlyInteractionStatus, fixedEventCommunicationFacts, decideWeeklyPlanningStableDialogueV5,
  type SemanticConversationActV5, type WeeklyPlanningFixedEventCommunicationFacts } from '../weeklyPlanningVNextV5Boundary';
import { createVNextLineageResolver, withCurrentVNextReferences, vnextUnitIdentity } from '../weeklyPlanningVNextWorkIdentity';
import type { Actual, MonthEvent, Plan, ScheduleTemplate } from '../../../../types/domain';
import { deriveWeeklyPlanningMemoryPaceEstimateV5 } from '../../personalization/weeklyPlanningMemoryPaceObservationsV5';
import type { GenericSchedulerInputContext } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import {
  compileWeeklyPlanningVNextSchedulerInput,
  createWeeklyPlanningVNextSchedulerContext,
} from '../projection/weeklyPlanningVNextSchedulerGraph';
import {
  applyWeeklyPlanningVNextTurn,
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
  createStableV5ExternalConstraintSources,
  deriveWeeklyPlanningEstimateCalibration,
  scheduleWeeklyPlanningStableV5Preview,
  RENDERER_PREVIEW_CONTINGENCY,
  RENDERER_TECHNICAL_STOP,
  recoveryQuestionEvidenceForStableV5Dialogue,
  type WeeklyPlanningStableV5DialogueRenderer,
} from '../weeklyPlanningVNextV5Boundary';
import { resolveWeeklyPlanningVNextTurnDelta } from './weeklyPlanningVNextAnswerBinding';
import { workNotCoveredBySavedPlans } from '../../application/weeklyPlanningSavedWorkCoverage';
import { createVNextOptionalInvitation } from './weeklyPlanningVNextOptionalInvitation';
import { createWeeklyPlanningVNextRenderInput, VNEXT_RECENT_MESSAGE_LIMIT } from './weeklyPlanningVNextDialogue';
import {
  serializeWeeklyPlanningVNextSessionCheckpoint,
  type WeeklyPlanningVNextFailureRecovery,
  type WeeklyPlanningVNextUnansweredQuestionStreak,
  type WeeklyPlanningVNextShownPreview,
} from './weeklyPlanningVNextSessionCheckpoint';

export { readWeeklyPlanningVNextExperimentalSession, type WeeklyPlanningVNextExperimentalRead } from './weeklyPlanningVNextSessionRead';
import { readWeeklyPlanningVNextExperimentalSession } from './weeklyPlanningVNextSessionRead';

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
  /** A normal permission request, never a provider/placement failure or a new machine question. */
  authorizationRequired?: boolean;
  /** Read-only application decision for the shared trace owner; never read back as authority. */
  authorizationDecision?: VNextAuthorizationDecision;
  /** Exact V5 placement candidates for the ordinary preview UI, never rebuilt from blocks. */
  draftCandidates?: WeeklyDraftCandidate[];
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

/** One compilation owner for ordinary previews and registration-only revision comparison. */
function compilePreviewInput(scope: WeeklyPlanningVNextExperimentalScope, ports: WeeklyPlanningVNextExperimentalPorts,
  calendar: WeeklyPlanningVNextCalendar, state: WeeklyPlanningVNextState, projection: WeeklyPlanningVNextProjection) {
  const context = schedulingContext(scope, ports, state);
  // V5 resolves source selection; placement still enforces raw calendar busy time after stop_using.
  // ConstraintSources tests guard the use/stop and unavailable-source controls through this boundary.
  const externalSources = createStableV5ExternalConstraintSources({ ownerId: scope.ownerId,
    plans: calendar.plans, monthEvents: calendar.monthEvents, templates: calendar.scheduleTemplates,
    timetableTermId: calendar.timetableTermId,
    horizon: { startDate: context.planningStartDate, endDate: context.planningEndDate }, timeZone: context.timeZone });
  const estimateCalibration = deriveWeeklyPlanningEstimateCalibration({ plans: calendar.plans, actuals: calendar.actuals });
  return compileWeeklyPlanningVNextSchedulerInput({ state, projection, context, externalSources,
    estimateCalibrationMultiplier: estimateCalibration.multiplier });
}

/**
 * The Stable V5 bound for recovering a failed turn with the renderer (current-contract-v5 "Bounded structured-failure
 * recovery"): every provider dispatch of the interpretation was observed, completed and successful (1-6 dispatches,
 * no provider failure at any point) and only its structured result was rejected. A provider or transport failure
 * (including a timeout), an unknown or out-of-range dispatch count, or an invalidated turn allows no new dispatch.
 */
export function recoveryMayDispatch(interpretation: WeeklyPlanningVNextInterpretation): boolean {
  const calls = interpretation.metrics?.calls;
  // A provider failure anywhere in the invocation counts: the final reason covers the last dispatch and
  // `providerFailures` the earlier ones a fallback carried (focused route -> native reading).
  return !(interpretation.status === 'failed' && interpretation.reason === 'provider_error')
    && (interpretation.metrics?.providerFailures ?? 0) === 0
    && Number.isSafeInteger(calls) && calls >= 1 && calls <= 6;
}

function shownPreview(
  scope: WeeklyPlanningVNextExperimentalScope,
  ports: WeeklyPlanningVNextExperimentalPorts,
  calendar: WeeklyPlanningVNextCalendar,
  state: WeeklyPlanningVNextState,
  projection: WeeklyPlanningVNextProjection,
  authorized: boolean,
  registrationActs: SemanticConversationActV5[],
  currentTurnId: string,
  semanticChanged: boolean,
  previousQuestionSlot: string | undefined,
  declinedAdditionalWork = false,
): { preview: WeeklyPlanningVNextShownPreview | null; unplacedOwnerKeys: string[]; previewBlockedBy: string[];
  draftCandidates?: WeeklyDraftCandidate[]; authorizationRequired?: boolean; registrationCommunication?: WeeklyPlanningFixedEventCommunicationFacts;
  optionalQuestion?: VNextQuestion | null } {
  const compiled = compilePreviewInput(scope, ports, calendar, state, projection);
  if (compiled.status !== 'compiled') return { preview: null, unplacedOwnerKeys: [], previewBlockedBy: [] };
  // V5 projects explicit registrations at their own fixed intervals before ordinary work placement.
  // Consent applies only to movable study work. The mixed/busy-only/save controls in
  // EventRegistration integration prevent registration from becoming work or granting study consent.
  const resolver = createVNextLineageResolver(state.graph);
  const currentGraph = withCurrentVNextReferences(state.graph, id => resolver.leafOf(id) ?? id);
  const registration = projectWeeklyPlanningFixedEventRegistration({
    graph: currentGraph,
    compilation: compiled.compilation, registrationActs, currentTurnId,
  });
  // V5 owns invitation closure and manual-entry guidance. Registration/omission has priority;
  // the compilation guards required questions and movable work before an optional invitation.
  const handoff = registration.candidates.length || registration.unregistered.length ? null : fixedEventOnlyInteractionStatus({
    graph: currentGraph, compilation: compiled.compilation, semanticChanged, previousQuestionSlot,
    declinedAdditionalWork, previousOptionalInvitationClosed: state.optionalInvitationClosed,
    requestedEventRegistration: registrationActs.some(act => act.kind === 'request_event_registration'),
  });
  // V5 ResponseRouting:239 uses this pure dialogue decision after registration/closure routing.
  // V5 owns both eligibility and wording; a required task question never becomes optional here.
  const dialogue = decideWeeklyPlanningStableDialogueV5(compiled.compilation);
  const optionalQuestion = !handoff && !registration.candidates.length && !registration.unregistered.length
    && dialogue.status === 'nothing_to_schedule' ? createVNextOptionalInvitation(state) : null;
  if (!compiled.compilation.input) {
    const codes = compiled.compilation.issues.filter((issue) => issue.blocking).map((issue) => issue.code);
    return { preview: null, unplacedOwnerKeys: compiled.unplacedOwnerKeys,
      previewBlockedBy: compiled.compilation.status === 'empty' ? [] : [...new Set(codes.length ? codes : [compiled.compilation.status])],
      optionalQuestion, registrationCommunication: handoff ? fixedEventCommunicationFacts(handoff) : undefined };
  }
  const work = compiled.compilation.input.movableWorkItems;
  // Work an approved, saved plan already covers is not awaiting anything (shared with Stable V5's routing). Whether
  // new placement may run is the permission alone, as before.
  const awaiting = workNotCoveredBySavedPlans(work, calendar.plans);
  const authorizationRequired = !authorized && awaiting.length > 0;
  const scheduled = (authorized || work.length === 0) && work.length > 0 ? scheduleWeeklyPlanningStableV5Preview({
    input: compiled.compilation.input,
    graph: compiled.placementGraph,
    plans: calendar.plans,
    monthEvents: calendar.monthEvents,
    scheduleTemplates: calendar.scheduleTemplates,
    timetableTermId: calendar.timetableTermId,
    notBefore: { date: scope.clock.currentDate, time: scope.notBeforeTime },
  }) : null;
  if (scheduled && scheduled.status !== 'ready') return { preview: null,
    unplacedOwnerKeys: compiled.unplacedOwnerKeys, previewBlockedBy: scheduled.status === 'empty' ? [] : [scheduled.status] };
  const candidates = [...registration.candidates, ...(scheduled?.status === 'ready' ? scheduled.candidates : [])];
  const registrationCommunication = registration.candidates.length > 0 || registration.unregistered.length > 0
    ? weeklyPlanningFixedEventRegistrationFacts(registration.candidates, [...calendar.plans],
      authorizationRequired ? [...new Set(awaiting.map(item => item.label))] : [], registration.unregistered, candidates.length) : handoff ? fixedEventCommunicationFacts(handoff) : undefined;
  // The existing candidate/display conversion supplies the same approval provenance for both kinds.
  const blocks = createWeeklyPlanningPreviewBlocks(candidates)
    .map(block => createWeeklyPlanningPreviewDisplayBlock(block, scope.ownerId));
  const previewId = blocks[0]?.behaviorMetadata?.previewMetadata?.previewId;
  return { preview: previewId ? { previewId, graphRevision: state.graph.revision, blocks } : null,
    draftCandidates: candidates, unplacedOwnerKeys: compiled.unplacedOwnerKeys, previewBlockedBy: [],
    authorizationRequired, registrationCommunication, optionalQuestion };
}

/** Notices for turns that changed nothing the renderer could explain: a failure, a stale turn, or a blocked preview. */
function systemReply(outcome: WeeklyPlanningVNextExperimentalTurnOutcome, previewBlockedBy: string[]): string {
  if (outcome === 'stale') return '別の操作で会話が更新されました。最新の内容でもう一度送ってください。';
  if (outcome === 'interpretation_failed' || outcome === 'rejected') {
    return 'うまく反映できませんでした。もう一度、言い方を変えて教えてください。';
  }
  return `予定案を作れませんでした（${previewBlockedBy.join(', ')}）。`;
}

function interpretationFailureReply(failure: WeeklyPlanningVNextFailureRecovery,
  preview: WeeklyPlanningVNextShownPreview | null): string {
  const cause = failure.reason === 'provider_error'
    ? 'AIへの接続でエラーが起きました。' : 'AIの返答を確認できませんでした。';
  const retained = preview ? '表示済みの予定案は保持しています。' : 'これまでの条件は保持しています。';
  const unapplied = '今回の内容は計画に反映していません。';
  if (failure.consecutiveCount >= 2) {
    const route = preview
      ? '予定案を確認するか、復旧後に変更を再送できます。'
      : 'これまでの会話を確認し、復旧後に今回の内容を再送できます。';
    return `${cause}続けて失敗しています。${unapplied}${retained}${route}`;
  }
  return `${cause}${unapplied}${retained}復旧後にもう一度送ってください。`;
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
  supplementalContext?: string;
  selectedStarterTarget?: import('../weeklyPlanningVNextV5Boundary').WeeklyPlanningSelectedStarterTargetV5;
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
  let before: WeeklyPlanningVNextProjection = projectWeeklyPlanningVNext(state, pace);
  const presented = read.checkpoint.presentedQuestion;
  // Reconstruct only the saved invitation's identity, not an unshown question. V5's final
  // compilation below owns asking; the stored presentation owns what this reply answers.
  const invitation = !state.optionalInvitationClosed && !before.questions.length ? createVNextOptionalInvitation(state) : null;
  if (invitation && presented?.questionKey === invitation.key && presented.graphRevision === state.graph.revision) {
    before = { ...before, questions: [invitation] };
  }
  // The permission gate treats an answer to a pending question as no request to plan. The optional
  // invitation is not such a question (it never blocks and is only an offer), so an explicit plan request
  // with new work that follows it still authorizes; a required question's answer never does.
  const hadRequiredQuestion = before.questions.some((question) => !question.optionalInvitation);
  const presentationFresh = presented !== null && presented.graphRevision === params.shownRevision;
  const presentedQuestion = presentationFresh && presented.graphRevision === state.graph.revision
    ? before.questions.find((question) => question.key === presented.questionKey) ?? null
    : null;

  const previousQuestionSlot = presentedQuestion && (presentedQuestion.code !== 'missing_schedulable_work'
    || presentedQuestion.optionalInvitation) ? `stable_v5:${presentedQuestion.code}` : undefined;

  // The model reads dates against the horizon the state currently has (a stated planning window moves it).
  const horizon = schedulingContext(scope, ports, state);
  const clock: WeeklyPlanningVNextInterpretationClock = { ...scope.clock,
    planningStartDate: horizon.planningStartDate || scope.clock.planningStartDate,
    planningEndDate: horizon.planningEndDate || scope.clock.planningEndDate,
    defaultPlanningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate } };
  const interpretation = await ports.interpret({
    client: ports.client, state, projection: before, presentedQuestion, userText: params.userText, clock,
    ...(params.supplementalContext === undefined ? {} : { supplementalContext: params.supplementalContext }),
    ...(params.selectedStarterTarget === undefined ? {} : { selectedStarterTarget: params.selectedStarterTarget }),
    observedMemoryPace: pace,
    recentConversation: read.checkpoint.messages,
    // The reply the question was shown in: what the user's words answer (e.g. an ordinal over its options).
    presentedText: presentedQuestion ? presented!.shownText : null,
  });
  const previousFailure = read.checkpoint.failureRecovery;
  const failureRecovery: WeeklyPlanningVNextFailureRecovery | undefined = interpretation.status === 'failed'
    ? { reason: interpretation.reason, consecutiveCount: previousFailure?.reason === interpretation.reason
      ? Math.min(previousFailure.consecutiveCount + 1, Number.MAX_SAFE_INTEGER) : 1 }
    : undefined;

  // The turn was read against `rawBefore`; if another turn saved meanwhile, applying
  // this reading would overwrite it. Nothing is written; the user sends it again.
  const staleTurn = (): WeeklyPlanningVNextExperimentalTurn => ({ outcome: 'stale', graphRevision: read.checkpoint.state.graph.revision,
    readiness: before.readiness, question: presentedQuestion, preview: read.checkpoint.preview, unplacedOwnerKeys: [], previewBlockedBy: [],
    reply: systemReply('stale', []), replySource: 'system', interpretation, appliedDelta: null, errors: [] });
  if (ports.checkpoint.read() !== rawBefore) return staleTurn();

  let outcome: WeeklyPlanningVNextExperimentalTurnOutcome;
  let delta: VNextTurnDelta | null = null;
  let errors: VNextTurnError[] = [];
  let semanticChanged = false;
  let registrationActs: SemanticConversationActV5[] = [];
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
    // For a fact-noop, accepted intent can still make new work approvable. Ask the same V5 gate
    // and preview builder at the current revision; the transaction alone versions any new keys.
    // If facts actually change, its normal revision advance already covers the result.
    const priorAuthorization = delta ? resolveVNextPlanningAuthorization({ state, accepted: true,
      previousStatus: read.checkpoint.preview ? 'draft_ready' : before.questions.length ? 'revision_pending' : 'needs_scope',
      planningIntent: interpretation.planningIntent, hadMachinePendingQuestion: hadRequiredQuestion,
      semanticChanged: false, provisionalTimeboxRequested: delta.defer.some(item => item.allocation === 'provisional_timebox'),
    }) : null;
    const authorizedCandidateKeys = priorAuthorization?.authorized
      ? shownPreview(scope, ports, calendar, state, before, true, [], params.turnId, false, previousQuestionSlot).draftCandidates?.map(candidate => candidate.stableKey) ?? [] : [];

    if (resolution.status === 'conflict') {
      outcome = 'rejected';
    } else if (delta === null) {
      outcome = 'answer_represented';
    } else if (isEmpty(delta) && !interpretation.conversationActs?.length && !authorizedCandidateKeys.length) {
      outcome = 'noop';
    } else {
      const priorCompilation = interpretation.conversationActs?.length ? compilePreviewInput(scope, ports, calendar, state, before) : null;
      const result = applyWeeklyPlanningVNextTurn(state, delta, {
        observedMemoryPace: pace,
        preview: { shownPreviewBlockIds: read.checkpoint.preview?.blocks.map(block => block.id) ?? [], authorizedCandidateKeys,
          ...(interpretation.conversationActs?.length ? { eventRegistration: { acts: interpretation.conversationActs,
            compilation: priorCompilation?.status === 'compiled' ? priorCompilation.compilation : null } } : {}),
        },
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
      if (result.status === 'applied' || result.status === 'noop') registrationActs = result.registrationActs ?? [];
      if (result.status === 'applied') semanticChanged = result.diff.added.length > 0
        || result.diff.superseded.length > 0 || result.diff.removed.length > 0
        || JSON.stringify(state.workRelations) !== JSON.stringify(read.checkpoint.state.workRelations);
      if (result.status === 'rejected') errors = result.errors;
    }
  }

  const accepted = outcome === 'applied' || outcome === 'noop';
  const authorization = resolveVNextPlanningAuthorization({ state, accepted,
    previousStatus: read.checkpoint.preview ? 'draft_ready' : before.questions.length ? 'revision_pending' : 'needs_scope',
    planningIntent: interpretation.status === 'interpreted' ? interpretation.planningIntent : null,
    hadMachinePendingQuestion: hadRequiredQuestion, semanticChanged,
    provisionalTimeboxRequested: delta?.defer.some(item => item.allocation === 'provisional_timebox') ?? false });
  state = authorization.state;
  let projection: WeeklyPlanningVNextProjection = projectWeeklyPlanningVNext(state, observedMemoryPace(state, calendar));
  let question = projection.questions[0] ?? null;
  // A shown preview belongs to its revision: while the revision is current it is
  // exactly what the user saw (and may have approved), so it is not made again.
  const shown = read.checkpoint.preview;
  const made = question || !accepted
    ? { preview: null, unplacedOwnerKeys: [], previewBlockedBy: [] }
    : shownPreview(scope, ports, calendar, state, projection, authorization.authorized, registrationActs, params.turnId, semanticChanged, previousQuestionSlot,
      registrationActs.some(act => act.kind === 'decline_additional_work'));
  const optionalQuestion = 'optionalQuestion' in made ? made.optionalQuestion : null;
  if (!question && (optionalQuestion || !accepted && before.questions[0]?.optionalInvitation)) {
    question = optionalQuestion ?? before.questions[0];
    projection = { ...projection, questions: [question] };
  }
  const authorizationRequired = !question && !(shown && shown.graphRevision === state.graph.revision)
    && 'authorizationRequired' in made && made.authorizationRequired === true;
  const { preview, unplacedOwnerKeys, previewBlockedBy } = !question && shown && shown.graphRevision === state.graph.revision
    ? { preview: shown, unplacedOwnerKeys: made.unplacedOwnerKeys, previewBlockedBy: [] }
    : made;
  // Mirrors V5 CompatibilityState's needs_scope/no-question closure at the application layer,
  // like draftGenerationIntent: one state, one checkpoint commit, no mutation on a rejected turn.
  if (accepted) state = { ...state, optionalInvitationClosed: !question && !preview };
  const previousStreak = read.checkpoint.unansweredQuestionStreak;
  const matchingStreak = question !== null && previousStreak?.questionKey === question.key
    && previousStreak.graphRevision === projection.graphRevision ? previousStreak : undefined;
  const unansweredQuestionStreak: WeeklyPlanningVNextUnansweredQuestionStreak | undefined = question
    && presentedQuestion?.key === question.key && before.graphRevision === projection.graphRevision
    && interpretation.status === 'interpreted' && outcome === 'noop' && delta !== null && isEmpty(delta)
    ? { questionKey: question.key, graphRevision: projection.graphRevision,
      count: Math.min((matchingStreak?.count ?? 0) + 1, Number.MAX_SAFE_INTEGER) }
    : outcome === 'interpretation_failed' || outcome === 'rejected' ? matchingStreak : undefined;
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
      authorizationRequired,
      // Repetition changes presentation only; shown options still bind through the existing answer boundary.
      repeatedQuestionGuidance: question !== null && question.optionalInvitation === undefined
        && (vnextQuestionKeyAllowsProvisionalTimebox(question.key)
          || (question.code === 'remaining_inconsistent' && question.key.startsWith('remaining_inconsistent:'))
          || (question.code === 'same_or_distinct_work' && question.key.startsWith('same_or_distinct_work:'))
          || (question.code === 'effort_inconsistent' && question.key.startsWith('effort_inconsistent:') && question.options.length === 0)
          || (question.code === 'completed_exceeds_total' && question.key.startsWith('completed_exceeds_total:') && question.options.length === 0))
        && unansweredQuestionStreak !== undefined && unansweredQuestionStreak.count >= 3,
      registrationCommunication: 'registrationCommunication' in made ? made.registrationCommunication : undefined,
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
    // current-contract-v5 "Bounded structured-failure recovery": only a rejected structured result may be
    // recovered, never a provider failure or an unknown dispatch history; otherwise the fixed notice.
    const rendered = !recoveryMayDispatch(interpretation) || !canDispatchRecovery() || (stillShown && !evidence) ? null
      : await ports.createRenderer({ canDispatchRecovery }).render({
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
      reply = failureRecovery ? interpretationFailureReply(failureRecovery, preview) : systemReply(outcome, []);
      replySource = 'system';
      shows = 'unchanged';
    }
    if (!canDispatchRecovery()) return staleTurn();
  } else if (previewBlockedBy.length) {
    reply = systemReply(outcome, previewBlockedBy);
    replySource = 'system';
    shows = 'unchanged';
  } else {
    // As Stable V5 (dialogueActionKind): the renderer presents a preview only when this turn made one. A preview kept
    // from an earlier turn stays shown and approvable, but a turn that adds nothing is told as a status, so the
    // reply answers what the user said instead of repeating the approval guidance (N2).
    const rendered = await ports.createRenderer({ canDispatchRecovery }).render(renderBase(question, made.preview ? preview : null));
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
      ...(failureRecovery ? { failureRecovery } : {}),
      ...(unansweredQuestionStreak ? { unansweredQuestionStreak } : {}),
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
    draftCandidates: preview === made.preview ? made.draftCandidates ?? [] : [],
    unplacedOwnerKeys,
    previewBlockedBy,
    reply,
    replySource,
    authorizationRequired,
    authorizationDecision: authorization.decision,
    interpretation,
    appliedDelta: outcome === 'applied' ? delta : null,
    errors,
  };
}
