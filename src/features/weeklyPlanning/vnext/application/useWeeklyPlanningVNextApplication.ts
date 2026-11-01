import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { weeklyPlanningReducer, createInitialPlanningState } from '../../weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession, inferWeeklyPlanningControllerRequestSequence, cancelWeeklyPlanningControlledTurn, clearWeeklyPlanningControlledConversation } from '../../weeklyPlanningTurnController';
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
import { createAiPlanningChatSessionWithStore } from '../../chat/aiPlanningChatSession';
import { hasStoredAiPlanningChatIndex, readAiPlanningChatSnapshotRaw, saveAiPlanningChatSearchText } from '../../chat/aiPlanningChatStore';
import { createWeeklyPlanningVNextLocalSession, type WeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
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

/** Production composition with one VNext checkpoint per owned chat. The same controller and reducer own
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
    try { loaded = hasStoredAiPlanningChatIndex(ownerId)
      ? { state: createInitialPlanningState(week), conversationId: 'uninitialized-vnext' } : local.load(); } catch { ready = false; loaded = { state: createInitialPlanningState(week), conversationId: 'unreadable-vnext' }; }
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
  interface Snapshot {
    ownerId: string;
    weekStartDate: string;
    conversationId: string;
    planningState: PlanningState;
    savedAt: string;
    local: WeeklyPlanningVNextLocalSession;
  }
  function localFor(chatId: string, weekStartDate: string) {
    return createWeeklyPlanningVNextLocalSession({ ownerId, weekStartDate, storage: services.storage, chatId,
      legacyV5Raw: readAiPlanningChatSnapshotRaw(ownerId, chatId, services.storage) });
  }
  function install(snapshot: Snapshot) {
    runtime.local = snapshot.local; runtime.state = snapshot.planningState; runtime.ready = true;
    runtime.session = createWeeklyPlanningControllerSession(ownerId, snapshot.weekStartDate, snapshot.conversationId);
    runtime.session.requestSequence = Math.max(snapshot.planningState.conversationRequestSequence ?? 0,
      inferWeeklyPlanningControllerRequestSequence(snapshot.planningState.messages, snapshot.conversationId));
    redraw(value => value + 1);
  }
  const chat = useMemo(() => createAiPlanningChatSessionWithStore<Snapshot>(ownerId, {
    isCurrent: () => active.current === runtime,
    isBusy: () => Boolean(runtime.state.pendingTurn || runtime.state.pendingApproval),
    isApplicationStateReady: () => runtime.ready,
    exportSnapshot: includeEmpty => {
      const state = runtime.state;
      if (!runtime.ready || state.pendingTurn || state.pendingApproval
        || (!includeEmpty && !state.messages.length && !state.draftBlocks.length && !runtime.local.checkpoint.read())) return null;
      return { ownerId, weekStartDate: state.weekStartDate, conversationId: runtime.session.conversationId,
        planningState: state, savedAt: services.now(), local: runtime.local };
    },
    prepareImport: snapshot => () => install(snapshot),
    prepareNew: record => {
      if (!runtime.ready || runtime.state.pendingTurn || runtime.state.pendingApproval) return null;
      const weekStartDate = runtime.state.weekStartDate;
      const local = createWeeklyPlanningVNextLocalSession({ ownerId, weekStartDate, storage: services.storage,
        chatId: record.id, legacyV5Raw: null });
      const loaded = local.load();
      return () => install({ ownerId, weekStartDate, conversationId: loaded.conversationId,
        planningState: loaded.state, savedAt: services.now(), local });
    },
    changed: () => redraw(value => value + 1),
  }, {
    load: (_owner, record) => {
      if (!record.weekStartDate) return null;
      try {
        const local = localFor(record.id, record.weekStartDate);
        const loaded = local.load();
        return { ownerId, weekStartDate: record.weekStartDate, conversationId: loaded.conversationId,
          planningState: loaded.state, savedAt: services.now(), local };
      } catch { return null; }
    },
    save: (_owner, chatId, snapshot) => {
      try {
        const destination = localFor(chatId, snapshot.weekStartDate);
        const core = snapshot.local.checkpoint.read();
        if (core !== null) destination.checkpoint.write(core);
        else destination.checkpoint.remove();
        destination.save(snapshot.conversationId, snapshot.planningState);
        saveAiPlanningChatSearchText(ownerId, chatId, snapshot.planningState.messages);
        if (runtime.session.conversationId === snapshot.conversationId) runtime.local = destination;
        return true;
      } catch { return false; }
    },
    remove: (_owner, chatId) => {
      // Explicit chat deletion removes only VNext bytes. Legacy V5 snapshots stay read-only.
      const record = chat.index.chats.find(item => item.id === chatId);
      if (record?.weekStartDate) localFor(chatId, record.weekStartDate).clear();
    },
  }), [runtime, ownerId, services]);
  useLayoutEffect(() => { if (chat.initialize().status === 'saved') chat.checkpoint(); }, [chat]);
  const local = runtime.local;
  const gateway = useMemo(() => createWeeklyPlanningVNextRuntimeGateway({ session: local,
    ports: turn => {
      const client = services.client();
      return { client, interpret: services.interpret({ ownerId, conversationId: turn.pending.conversationId }),
        checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
        // This composition uses the ordinary approval application below, never the session's save entry.
        approvalLedger: { read: () => null, write: () => { throw new Error('Approval belongs to the existing application.'); } },
        plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('Approval belongs to the existing application.'); } },
        calendar: () => ({ plans: turn.plans, actuals: turn.actuals ?? [], monthEvents: turn.monthEvents ?? [],
          scheduleTemplates: turn.scheduleTemplates, timetableTermId: turn.timetableTermId }),
        createRenderer: options => services.createRenderer(client, options), now: services.now };
    } }), [local, services, ownerId]);
  const turnServices = { ...weeklyPlanningTurnApplicationServices, ...gateway,
    outcomeLifecycle: createWeeklyPlanningTurnOutcomeLifecycle({ saveOwnedState: (_owner, state) => {
      if (!current()) return false;
      runtime.local.save(runtime.session.conversationId, state); return true;
    } }) };
  const plannerReady = () => Boolean(input.userId && current() && !chat.requiresInitialization
    && isPlannerDataReadyForOwner(input.plannerDataAvailability, input.userId) && input.isPlannerDataSnapshotCurrent());
  function binding() {
    return current() && !chat.requiresInitialization && !runtime.state.pendingTurn && !runtime.state.pendingApproval
      ? { ownerId, chatId: chat.index.activeChatId, conversationId: runtime.session.conversationId,
        weekStartDate: runtime.state.weekStartDate, revision: runtime.state.revision } : null;
  }
  const pendingDraftBlocks = runtime.state.draftBlocks.filter(block => block.status === 'draft');
  return { registeredTargetsAvailable: true, chat, state: runtime.state, pendingDraftBlocks,
    approvalAvailability: classifyWeeklyPlanningApprovalAvailability({ blocks: pendingDraftBlocks, userId: ownerId, resolveRuntime: runtime.local.resolveRuntime }),
    canEditDraftBlocks: current() && !runtime.state.pendingTurn && !runtime.state.pendingApproval && !runtime.state.approvalRecovery,
    plannerDataReady: plannerReady(),
    prepareTurn: async () => plannerReady() && committedInput.current === input ? { ready: true } : { ready: false, reason: 'request-changed' },
    getModuleRecoveryBinding: binding,
    checkpointForModuleReload: () => {
      const captured = binding(); const state = runtime.state;
      return captured && chat.checkpoint().status === 'saved' ? { binding: captured, isCurrent: () => current() && runtime.state === state } : null;
    },
    submitTurn: async (userText, supplementalContext, selectedStarterTarget, machineBoundAnswer) => {
      if (!plannerReady() || committedInput.current !== input || runtime.state.approvalRecovery) return { accepted: false, draftCandidates: [] };
      const result = await submitWeeklyPlanningApplicationTurn({ ...input, userId: ownerId, ownerId,
        session: runtime.session, userText, supplementalContext, selectedStarterTarget, machineBoundAnswer,
        weekStartsOn, getState, dispatch, now: services.now,
        isPlannerDataSnapshotCurrent: plannerReady, isApplicationCurrent: current }, turnServices);
      if (current()) chat.checkpoint();
      return result;
    },
    cancelTurn: () => cancelWeeklyPlanningControlledTurn({ getState, dispatch }),
    clearConversation: () => clearWeeklyPlanningControlledConversation({ getState, dispatch }),
    appendMessage: message => { dispatch({ type: 'append_message', message }); },
    resetSession: () => { if (!runtime.state.pendingTurn && !runtime.state.pendingApproval) chat.create(); },
    startConversation: () => { chat.create(); },
    // Production UI uses the chat session ports above, not V5-shaped snapshot export/import.
    exportConversationSnapshot: () => null, loadConversationSnapshot: () => false,
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
