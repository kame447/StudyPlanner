import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { weeklyPlanningReducer, createInitialPlanningState } from '../../weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession, cancelWeeklyPlanningControlledTurn, clearWeeklyPlanningControlledConversation } from '../../weeklyPlanningTurnController';
import { submitWeeklyPlanningApplicationTurn, weeklyPlanningTurnApplicationServices } from '../../application/weeklyPlanningTurnApplication';
import { createWeeklyPlanningTurnOutcomeLifecycle } from '../../application/weeklyPlanningTurnOutcomeLifecycle';
import { approveWeeklyPlanningDraftBlocks } from '../../application/weeklyPlanningApprovalApplication';
import { classifyWeeklyPlanningApprovalAvailability } from '../../application/weeklyPlanningApprovalAvailability';
import { loadWeeklyPlanningApprovalOperations, saveWeeklyPlanningApprovalOperations } from '../../application/weeklyPlanningApprovalLedgerStorage';
import { startOfWeeklyPlanningWeek } from '../../personalization/weeklyPlanningWeek';
import { useWeeklyPlanningPersonalization } from '../../personalization/WeeklyPlanningPersonalizationContext';
import { isPlannerDataReadyForOwner } from '../../../../domain/plannerDataReadAuthority';
import { createOpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClient';
import { getAiConfig, getCloudflareAiProxyUrl } from '../../../../lib/aiConfig';
import type { WeeklyPlanningAction, PlanningState } from '../../types';
import type { AiPlanningChatSession, AiPlanningChatResult } from '../../chat/aiPlanningChatSession';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { createWeeklyPlanningVNextRuntimeGateway } from './weeklyPlanningVNextRuntimeGateway';
import type { WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextFocusedInterpreter } from './weeklyPlanningVNextFocusedInterpreter';
import { createWeeklyPlanningVNextOptionChoiceInterpreter, createWeeklyPlanningVNextOptionChoicePort } from './weeklyPlanningVNextOptionChoice';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../weeklyPlanningVNextV5Boundary';

export interface WeeklyPlanningVNextLocalApplicationServices {
  storage: Storage;
  client: () => WeeklyPlanningVNextExperimentalPorts['client'];
  interpret: (scope: { ownerId: string; conversationId: string }) => WeeklyPlanningVNextExperimentalPorts['interpret'];
  createRenderer: (client: WeeklyPlanningVNextExperimentalPorts['client'], options: { canDispatchRecovery: () => boolean }) => ReturnType<WeeklyPlanningVNextExperimentalPorts['createRenderer']>;
  now: () => string;
}

/** Frozen VNext dev calibration (luna-holdout-fallback-a25c9899); no V5 settings or retuning.
 * The native reader remains the complete fallback for both narrow Jev purposes.
 */
function localServices(): WeeklyPlanningVNextLocalApplicationServices {
  return { storage: window.localStorage,
    client: () => {
      if (!getCloudflareAiProxyUrl()) throw new Error('The local VNext experiment requires the authenticated Worker proxy.');
      return createOpenAiCompatibleClient({ ...getAiConfig(), provider: 'openai' });
    },
    interpret: scope => createWeeklyPlanningVNextOptionChoiceInterpreter({ scope,
      fullReading: createWeeklyPlanningVNextFocusedInterpreter({ fullReading: createWeeklyPlanningVNextProviderInterpreter() }),
      choice: createWeeklyPlanningVNextOptionChoicePort({
        policy: { id: 'vnext-frozen-dev', calibrationEvidenceId: 'vnext-dev-frozen-a25c9899', rules: [
          { menuKind: 'leaves', optionCount: 3, depth: 0, minimumTopProbability: 0.91, minimumMargin: 0.82 },
          { menuKind: 'leaves', optionCount: 4, depth: 0, minimumTopProbability: 0.59, minimumMargin: 0.20 },
        ] },
        client: { semanticPolicy: { calibrationEvidenceId: 'vnext-dev-frozen-a25c9899', maximumConditionChange: 0.36, maximumIndependentMeaning: 0.69 } },
      }) }),
    createRenderer: (client, options) => createWeeklyPlanningStableV5DialogueRendererCore(client, options),
    now: () => new Date().toISOString() };
}

/** Local-only composition, one conversation per owner/week. The same controller and reducer own
 * visible turns; the VNext session owns accepted facts; the existing approval application owns
 * saving and the shared ledger. Never hydrate/export a pretend V5 runtime graph for this state.
 * LocalRuntime integration guards turn → preview → approval, reload, cancellation and rollback.
 */
export function useWeeklyPlanningVNextApplication(
  input: UseWeeklyPlanningApplicationInput,
  providedServices?: WeeklyPlanningVNextLocalApplicationServices,
): WeeklyPlanningApplication {
  const { weekStartsOn } = useWeeklyPlanningPersonalization();
  const ownerId = input.userId?.trim() || 'anonymous';
  const week = startOfWeeklyPlanningWeek(input.selectedDate, weekStartsOn);
  const services = useMemo(() => providedServices ?? localServices(), [providedServices]);
  const [, redraw] = useState(0);
  const runtime = useMemo(() => {
    const local = createWeeklyPlanningVNextLocalSession({ ownerId, weekStartDate: week, storage: services.storage });
    let loaded: ReturnType<typeof local.load>;
    let ready = true;
    try { loaded = local.load(); } catch { ready = false; loaded = { state: createInitialPlanningState(week), conversationId: 'unreadable-vnext' }; }
    return { local, ready, state: loaded.state,
      session: createWeeklyPlanningControllerSession(ownerId, week, loaded.conversationId),
      operations: loadWeeklyPlanningApprovalOperations(ownerId) };
  }, [ownerId, week, services]);
  const active = useRef<typeof runtime | null>(null);
  const committedInput = useRef<typeof input | null>(null);
  useLayoutEffect(() => {
    active.current = runtime; committedInput.current = input;
    return () => { if (active.current === runtime) active.current = null; committedInput.current = null; };
  }, [runtime, input]);
  const current = () => active.current === runtime && runtime.ready;
  const getState = () => runtime.state;
  function dispatch(action: WeeklyPlanningAction): PlanningState {
    if (!current()) return runtime.state;
    const next = weeklyPlanningReducer(runtime.state, action);
    if (next !== runtime.state) {
      runtime.local.save(runtime.session.conversationId, next);
      runtime.state = next;
      redraw(value => value + 1);
    }
    return next;
  }
  const gateway = useMemo(() => createWeeklyPlanningVNextRuntimeGateway({ session: runtime.local,
    ports: turn => {
      const client = services.client();
      return { client, interpret: services.interpret({ ownerId, conversationId: turn.pending.conversationId }),
        checkpoint: runtime.local.checkpoint, legacyV5Checkpoint: runtime.local.legacyV5Checkpoint,
        // This composition uses the ordinary approval application below, never the session's save entry.
        approvalLedger: { read: () => null, write: () => { throw new Error('Approval belongs to the existing application.'); } },
        plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('Approval belongs to the existing application.'); } },
        calendar: () => ({ plans: turn.plans, actuals: turn.actuals ?? [], monthEvents: turn.monthEvents ?? [],
          scheduleTemplates: turn.scheduleTemplates, timetableTermId: turn.timetableTermId }),
        createRenderer: options => services.createRenderer(client, options), now: services.now };
    } }), [runtime, services, ownerId]);
  const turnServices = { ...weeklyPlanningTurnApplicationServices, ...gateway,
    outcomeLifecycle: createWeeklyPlanningTurnOutcomeLifecycle({ saveOwnedState: (_owner, state) => {
      if (!current()) return false;
      runtime.local.save(runtime.session.conversationId, state); return true;
    } }) };
  const plannerReady = () => Boolean(input.userId && current() && isPlannerDataReadyForOwner(input.plannerDataAvailability, input.userId)
    && input.isPlannerDataSnapshotCurrent());
  const checkpoint = (): AiPlanningChatResult => {
    if (!current()) return { status: 'blocked', reason: 'initialization-unavailable' };
    try { runtime.local.save(runtime.session.conversationId, runtime.state); return { status: 'saved' }; }
    catch { return { status: 'blocked', reason: 'snapshot-write-failed' }; }
  };
  const unavailable = (): AiPlanningChatResult => ({ status: 'blocked', reason: 'target-unavailable' });
  const chat = useMemo<AiPlanningChatSession>(() => ({
    get index() { return { version: 1 as const, activeChatId: runtime.session.conversationId,
      chats: [{ id: runtime.session.conversationId, title: '今週の計画', createdAt: runtime.state.updatedAt,
        updatedAt: runtime.state.updatedAt, weekStartDate: week }] }; },
    get requiresInitialization() { return !runtime.ready; },
    get result() { return null; }, dirty: false, canStartWithoutRestoring: false,
    initialize: checkpoint, checkpoint, retry: checkpoint, startWithoutRestoring: unavailable,
    select: id => id === runtime.session.conversationId ? checkpoint() : unavailable(), create: unavailable, remove: unavailable,
  }), [runtime, week]);
  function binding() {
    return current() && !runtime.state.pendingTurn && !runtime.state.pendingApproval
      ? { ownerId, chatId: runtime.session.conversationId, conversationId: runtime.session.conversationId,
        weekStartDate: week, revision: runtime.state.revision } : null;
  }
  const pendingDraftBlocks = runtime.state.draftBlocks.filter(block => block.status === 'draft');
  return { conversationNavigation: 'single', registeredTargetsAvailable: false, chat, state: runtime.state, pendingDraftBlocks,
    approvalAvailability: classifyWeeklyPlanningApprovalAvailability({ blocks: pendingDraftBlocks, userId: ownerId, resolveRuntime: runtime.local.resolveRuntime }),
    canEditDraftBlocks: current() && !runtime.state.pendingTurn && !runtime.state.pendingApproval && !runtime.state.approvalRecovery,
    plannerDataReady: Boolean(input.userId && runtime.ready && isPlannerDataReadyForOwner(input.plannerDataAvailability, input.userId)
      && input.isPlannerDataSnapshotCurrent()),
    prepareTurn: async () => plannerReady() && committedInput.current === input ? { ready: true } : { ready: false, reason: 'request-changed' },
    getModuleRecoveryBinding: binding,
    checkpointForModuleReload: () => {
      const captured = binding(); const state = runtime.state;
      return captured && checkpoint().status === 'saved' ? { binding: captured, isCurrent: () => current() && runtime.state === state } : null;
    },
    submitTurn: async (userText, supplementalContext, selectedStarterTarget, machineBoundAnswer) => {
      if (selectedStarterTarget) throw new Error('教材や登録項目の選択はこの実験モードでは未対応です。対象を文章で入力してください。');
      if (!plannerReady() || committedInput.current !== input || runtime.state.approvalRecovery) return { accepted: false, draftCandidates: [] };
      return submitWeeklyPlanningApplicationTurn({ ...input, userId: ownerId, ownerId,
        session: runtime.session, userText, supplementalContext, selectedStarterTarget, machineBoundAnswer,
        weekStartsOn, getState, dispatch, now: services.now,
        isPlannerDataSnapshotCurrent: plannerReady, isApplicationCurrent: current }, turnServices);
    },
    cancelTurn: () => cancelWeeklyPlanningControlledTurn({ getState, dispatch }),
    clearConversation: () => clearWeeklyPlanningControlledConversation({ getState, dispatch }),
    appendMessage: message => { dispatch({ type: 'append_message', message }); },
    // The local experiment has one conversation. Starting another is intentionally not a V5 chat import.
    resetSession: () => {}, startConversation: () => {}, exportConversationSnapshot: () => null, loadConversationSnapshot: () => false,
    createDraftBlocks: blocks => { const before = runtime.state; return dispatch({ type: 'add_draft_blocks', blocks }) !== before; },
    removePreviewCandidate: candidateId => { dispatch({ type: 'remove_preview_candidate', candidateId }); },
    removeDraftBlock: blockId => { dispatch({ type: 'remove_draft_block', blockId }); },
    clearDraftBlocks: () => { dispatch({ type: 'clear_draft_blocks' }); },
    approveDraftBlocks: () => approveWeeklyPlanningDraftBlocks({ ...input, userId: ownerId,
      featureSessionId: runtime.session.conversationId, plans: input.plans, getState, dispatch,
      resolveRuntime: runtime.local.resolveRuntime, approvalOperations: runtime.operations,
      onOperationCompleted: operation => {
        runtime.operations = [...runtime.operations.filter(item => item.approvalOperationId !== operation.approvalOperationId), operation];
        saveWeeklyPlanningApprovalOperations(ownerId, runtime.operations);
      } }),
  };
}
