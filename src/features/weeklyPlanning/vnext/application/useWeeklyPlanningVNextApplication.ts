import { useWeeklyPlanningConversationSync, type ConversationSyncDependencies } from '../sync/useWeeklyPlanningConversationSync';
import { isFirebaseEnabled } from '../../../../lib/firebaseConfig';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { weeklyPlanningReducer, createInitialPlanningState } from '../../weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession, inferWeeklyPlanningControllerRequestSequence, cancelWeeklyPlanningControlledTurn, clearWeeklyPlanningControlledConversation } from '../../weeklyPlanningTurnController';
import { submitWeeklyPlanningApplicationTurnWithServices, weeklyPlanningTurnApplicationBaseServices } from '../../application/weeklyPlanningTurnApplicationCore';
import { createWeeklyPlanningTurnOutcomeLifecycle } from '../../application/weeklyPlanningTurnOutcomeLifecycle';
import { approveWeeklyPlanningDraftBlocks } from '../../application/weeklyPlanningApprovalApplication';
import { classifyWeeklyPlanningApprovalAvailability } from '../../application/weeklyPlanningApprovalAvailability';
import { loadWeeklyPlanningApprovalOperations, saveWeeklyPlanningApprovalOperations } from '../../application/weeklyPlanningApprovalLedgerStorage';
import { startOfWeeklyPlanningWeek } from '../../personalization/weeklyPlanningWeek';
import { useWeeklyPlanningPersonalization } from '../../personalization/WeeklyPlanningPersonalizationContext';
import { isPlannerDataReadyForOwner } from '../../../../domain/plannerDataReadAuthority';
import type { WeeklyPlanningAction, PlanningState } from '../../types';
import { createAiPlanningChatSessionWithStore } from '../../chat/aiPlanningChatSession';
import { hasStoredAiPlanningChatIndex, readAiPlanningChatSnapshotRaw, saveAiPlanningChatSearchText } from '../../chat/aiPlanningChatStore';
import { createWeeklyPlanningVNextLocalSession, type WeeklyPlanningVNextLocalSession, type WeeklyPlanningActualSaveAttempt } from './weeklyPlanningVNextLocalSession';
import { createWeeklyPlanningVNextRuntimeGateway, readWeeklyPlanningVNextDurableReceipt } from './weeklyPlanningVNextRuntimeGateway';
import { durableWeeklyPlanningEnabled, cancelDurableWeeklyTurn } from '../../application/weeklyPlanningDurableTurnClient';
import { durableReceiptTurnParams, recoverDurableWeeklyTurn } from '../../application/weeklyPlanningDurableRecovery';
import type { WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';
import { loadWeeklyPlanningVNextRuntimeModule } from './weeklyPlanningVNextRuntimeLoader';
import { prepareWeeklyPlanningTurn, admitPreparedWeeklyPlanningTurn } from '../../application/weeklyPlanningTurnPreparation';
import { formatActualSaveReadbackReply, formatUnknownActualSaveReadbackReply, resolvePendingActualRecordsAgainstSaved,
  selectPendingActualRecords, toActualRecordsToSave, ACTUAL_SAVE_RETRY_BLOCKED_REPLY, ACTUAL_SAVE_RETRY_FAILED_REPLY,
  ACTUAL_SAVE_RETRY_SAVED_REPLY, type WeeklyPlanningActualRecord } from '../../application/weeklyPlanningActualRecords';
import { ActualSaveReadbackUnknownError } from '../../../../domain/actualSaveReadback';
import { PlannerMutationScopeExpiredError } from '../../../../lib/plannerMutationScopeExpiredError';
import type { ActualSaveIntentRecord, ActualSaveReadbackClassification } from '../weeklyPlanningVNextActualSaveReadback';
import { createWeeklyPlanningApplicationRequestId } from '../../application/weeklyPlanningApplicationIdentity';

export interface WeeklyPlanningVNextLocalApplicationServices {
  conversationSync?: (ownerId: string, alive: () => boolean) => Promise<ConversationSyncDependencies | null>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Loads the heavy runtime behind `client`, `interpret` and `createRenderer` before they are called. */
  preload?: () => Promise<void>;
  client: () => WeeklyPlanningVNextExperimentalPorts['client'];
  interpret: (scope: { ownerId: string; conversationId: string }) => WeeklyPlanningVNextExperimentalPorts['interpret'];
  createRenderer: (client: WeeklyPlanningVNextExperimentalPorts['client'], options: { canDispatchRecovery: () => boolean }) => ReturnType<WeeklyPlanningVNextExperimentalPorts['createRenderer']>;
  readActualSave?: (ownerId: string, attempted: readonly ActualSaveIntentRecord[]) => Promise<ActualSaveReadbackClassification>;
  now: () => string;
}

function localServices(): WeeklyPlanningVNextLocalApplicationServices {
  // The runtime (provider, interpreter, renderer, client) is a lazy chunk; the entry keeps the hook only.
  let runtime: Awaited<ReturnType<typeof loadWeeklyPlanningVNextRuntimeModule>>['weeklyPlanningVNextRuntimeFactories'] | undefined;
  const loaded = () => { if (!runtime) throw new Error('The VNext runtime is not loaded.'); return runtime; };
  // Resolve storage per operation so an absent or throwing localStorage (private mode, blocked
  // site data) surfaces inside the hook's guarded reads and writes, as it does for V5's stores.
  // In local-only mode there is no remote conversation authority. Do not advertise
  // a temporary sync-checking state: its asynchronous disabling render could revoke
  // a legitimate turn while the existing VNext runtime is preparing it.
  const sync = isFirebaseEnabled() ? { conversationSync: async (ownerId: string, alive: () => boolean) => {
    const { createConversationSyncBrowser } = await import('../sync/weeklyPlanningConversationSyncBrowser');
    return createConversationSyncBrowser(ownerId, alive);
  } } : {};
  return { ...sync, storage: { getItem: key => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: key => window.localStorage.removeItem(key) },
    preload: async () => { runtime = (await loadWeeklyPlanningVNextRuntimeModule()).weeklyPlanningVNextRuntimeFactories; },
    client: () => loaded().client(),
    interpret: scope => loaded().interpret(scope),
    createRenderer: (client, options) => loaded().createRenderer(client, options),
    readActualSave: async (ownerId, attempted) => {
      const [{ getFirebaseAuth, getFirestoreDb }, { readAndClassifyActualSaveFromServer }] = await Promise.all([
        import('../../../../lib/firebaseClient'), import('../weeklyPlanningVNextActualSaveServerReadback')]);
      const firebaseAuth = getFirebaseAuth(), firestoreDb = getFirestoreDb();
      if (!firebaseAuth || !firestoreDb) throw new ActualSaveReadbackUnknownError('auth_mismatch');
      return readAndClassifyActualSaveFromServer({ firebaseAuth, firestoreDb, ownerId, attempted });
    },
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
  const lastSelectedWeek = useRef(week);
  useLayoutEffect(() => { lastSelectedWeek.current = week; }, [week]);
  const baseServices = useMemo(() => providedServices ?? localServices(), [providedServices]);
  const cloud = useWeeklyPlanningConversationSync(ownerId, baseServices);
  const services = useMemo(() => cloud.storage ? { ...baseServices, storage: cloud.storage } : baseServices,
    [baseServices, cloud.storage, cloud.epoch]);
  const [revision, redraw] = useState(0);
  const recoveringDurableRequest = useRef<string | null>(null);
  // A confirmation click is the only save authority for study records; the in-flight flag prevents a
  // second click while the first batch is still running (#973).
  const actualRecordsInFlight = useRef(false);
  const actualSyncPreflight = useRef(false);
  const actualReadbackInFlight = useRef(false);
  const savingActualRecordIds = useRef<ReadonlySet<string>>(new Set());
  const [savedActualMinutes, setSavedActualMinutes] = useState<ReadonlyMap<string, number>>(() => new Map());
  const readbackCandidate = useRef<{ local: WeeklyPlanningVNextLocalSession; conversationId: string;
    weekStartDate: string; attempt: WeeklyPlanningActualSaveAttempt } | null>(null);
  const retryEligible = useRef<typeof readbackCandidate.current>(null);
  const readbackSeen = useRef<Set<string>>(new Set());
  const runtime = useMemo(() => {
    const local = createWeeklyPlanningVNextLocalSession({ ownerId, weekStartDate: week, storage: services.storage });
    let loaded: ReturnType<typeof local.load>;
    let ready = true;
    try { loaded = hasStoredAiPlanningChatIndex(ownerId)
      ? { state: createInitialPlanningState(week), conversationId: 'uninitialized-vnext' } : local.load(); } catch { ready = false; loaded = { state: createInitialPlanningState(week), conversationId: 'unreadable-vnext' }; }
    return { local, ready, state: loaded.state, followSelectedWeek: lastSelectedWeek.current !== week,
      session: createWeeklyPlanningControllerSession(ownerId, week, loaded.conversationId),
      operations: loadWeeklyPlanningApprovalOperations(ownerId) };
  }, [ownerId, week, services]);
  const active = useRef<typeof runtime | null>(null);
  const committedInput = useRef<typeof input | null>(null);
  useLayoutEffect(() => {
    active.current = runtime; committedInput.current = input;
    return () => { if (active.current === runtime) active.current = null; committedInput.current = null; };
  }, [runtime, input]);
  const current = () => active.current === runtime && runtime.ready && cloud.permitsEditing();
  const getState = () => runtime.state;
  function dispatch(action: WeeklyPlanningAction): PlanningState {
    if (!current()) return runtime.state;
    const next = weeklyPlanningReducer(runtime.state, action);
    if (next !== runtime.state) {
      // An in-flight turn or approval is never persisted: a reload then returns to the last committed
      // state, which is exactly what a saved durable receipt resumes from.
      const persisted = !next.pendingTurn && !next.pendingApproval;
      // A turn's commit is atomic with its write: when it throws, the controller rolls the staged
      // checkpoint back and the turn is not accepted (pinned by the LocalRuntime commit-failure test).
      if (persisted && action.type === 'commit_turn') runtime.local.save(runtime.session.conversationId, next);
      // Any other change is the user's own: as in V5, the reducer's result is the live state whether or
      // not it could be written. A failed write is reported through the chat session (dirty plus a
      // blocked result: the existing retry banner and unload warning), and a later successful retry
      // persists this live state.
      runtime.state = next;
      redraw(value => value + 1);
      if (persisted && action.type !== 'commit_turn') {
        try { runtime.local.save(runtime.session.conversationId, next); }
        catch { chat.checkpoint(); }
      }
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
  function captureReadback() {
    readbackCandidate.current = null;
    retryEligible.current = null;
    try {
      const attempt = runtime.local.readActualSaveAttempt(runtime.session.conversationId);
      if (attempt) readbackCandidate.current = { local: runtime.local, conversationId: runtime.session.conversationId,
        weekStartDate: runtime.state.weekStartDate, attempt };
    } catch { /* An unreadable UI snapshot cannot authorize a readback. */ }
  }
  function install(snapshot: Snapshot) {
    runtime.local = snapshot.local; runtime.state = snapshot.planningState; runtime.ready = true;
    runtime.session = createWeeklyPlanningControllerSession(ownerId, snapshot.weekStartDate, snapshot.conversationId);
    runtime.session.requestSequence = Math.max(snapshot.planningState.conversationRequestSequence ?? 0,
      inferWeeklyPlanningControllerRequestSequence(snapshot.planningState.messages, snapshot.conversationId));
    captureReadback();
    redraw(value => value + 1);
  }
  const chat = useMemo(() => createAiPlanningChatSessionWithStore<Snapshot>(ownerId, {
    isCurrent: () => active.current === runtime,
    isBusy: () => Boolean(runtime.state.pendingTurn || runtime.state.pendingApproval),
    canNavigate: () => cloud.permitsEditing() && !actualRecordsInFlight.current && !actualReadbackInFlight.current,
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
      // Opening this runtime follows the selected week (as V5's per-week slot does); selecting
      // another chat later restores that chat's own last week.
      const preferred = runtime.session.conversationId === 'uninitialized-vnext' ? week : record.weekStartDate;
      const target = cloud.storage && !runtime.followSelectedWeek && !services.storage.getItem(`studyplanner.weeklyPlanning.vnext.${ownerId}.${preferred}.${record.id}.ui`)
        ? record.weekStartDate : preferred;
      try {
        const local = localFor(record.id, target);
        const loaded = local.load();
        return { ownerId, weekStartDate: target, conversationId: loaded.conversationId,
          planningState: loaded.state, savedAt: services.now(), local };
      } catch { return null; }
    },
    save: (_owner, chatId, snapshot) => {
      try {
        const destination = localFor(chatId, snapshot.weekStartDate);
        const core = snapshot.local.checkpoint.read();
        if (core !== null) destination.checkpoint.write(core);
        else destination.checkpoint.remove();
        destination.save(snapshot.conversationId, snapshot.planningState,
          snapshot.local.readActualSaveAttempt(snapshot.conversationId));
        saveAiPlanningChatSearchText(ownerId, chatId, snapshot.planningState.messages);
        if (runtime.session.conversationId === snapshot.conversationId) runtime.local = destination;
        return true;
      } catch { return false; }
    },
    remove: (_owner, chatId) => {
      // Explicit chat deletion removes only VNext bytes. Legacy V5 snapshots stay read-only.
      const record = chat.index.chats.find(item => item.id === chatId);
      if (record?.weekStartDate) localFor(chatId, record.weekStartDate).clear();
      cloud.deleted(chatId);
    },
  }), [runtime, ownerId, services]);
  useLayoutEffect(() => {
    cloud.bind({ busy: () => Boolean(runtime.state.pendingTurn || runtime.state.pendingApproval
      || actualRecordsInFlight.current || actualReadbackInFlight.current) }, services.storage);
  }, [cloud, runtime, services]);
  useLayoutEffect(() => {
    // A migrated account must hydrate its IndexedDB replica before the old localStorage cache can act.
    if (!cloud.storage && !cloud.permitsEditing()) return;
    if (chat.initialize().status === 'saved') chat.checkpoint(); captureReadback();
  }, [chat, cloud, cloud.storage]);
  useEffect(() => { void cloud.observe(); }, [cloud, runtime, revision, runtime.state]);
  useEffect(() => {
    const candidate = readbackCandidate.current;
    if (!candidate || !services.readActualSave || !input.userId || !current() || runtime.local !== candidate.local) return;
    readbackCandidate.current = null;
    retryEligible.current = null;
    if (input.userId.trim() !== ownerId) return;
    const key = `${ownerId}:${candidate.conversationId}:${candidate.attempt.attemptedAt}`;
    if (readbackSeen.current.has(key)) return;
    readbackSeen.current.add(key);
    actualReadbackInFlight.current = true;
    const stillCurrent = () => {
      if (!current() || runtime.local !== candidate.local || runtime.session.conversationId !== candidate.conversationId
        || committedInput.current?.userId?.trim() !== ownerId || runtime.state.pendingTurn || runtime.state.pendingApproval) return false;
      try {
        const saved = candidate.local.readActualSaveAttempt(candidate.conversationId);
        return saved?.attemptedAt === candidate.attempt.attemptedAt
          && JSON.stringify(saved.records) === JSON.stringify(candidate.attempt.records);
      } catch { return false; }
    };
    const tell = (kind: string, content: string) => {
      if (!stillCurrent()) return;
      const id = `${candidate.conversationId}:actual-save-readback:${candidate.attempt.attemptedAt}:${kind}`;
      if (!runtime.state.messages.some(message => message.id === id)) {
        dispatch({ type: 'append_message', message: { id, role: 'assistant', content, createdAt: services.now() } });
      }
    };
    const run = async () => {
      try {
        const stored = candidate.local.readCheckpoint()?.vnext.actualRecords ?? [];
        const attempted: ActualSaveIntentRecord[] = [];
        for (const sent of candidate.attempt.records) {
          // A later minute correction does not change the identity or the value sent by this attempt.
          const record = stored.find(item => item.id === sent.id);
          if (!record) throw new ActualSaveReadbackUnknownError('read_failed');
          attempted.push({ id: sent.id, minutes: sent.minutes,
            occurrenceDate: record.occurrenceDate, subject: record.subject });
        }
        const result = await services.readActualSave!(ownerId, attempted);
        if (!stillCurrent()) return;
        const latest = candidate.local.readCheckpoint()?.vnext.actualRecords ?? [];
        if (attempted.some(sent => !latest.some(record => record.id === sent.id))) {
          throw new ActualSaveReadbackUnknownError('read_failed');
        }
        if (result.confirmedIds.length) {
          const { markWeeklyPlanningVNextActualRecordsSaved } = await loadWeeklyPlanningVNextRuntimeModule();
          if (!stillCurrent()) return;
          const beforeMark = candidate.local.readCheckpoint()?.vnext.actualRecords ?? [];
          if (attempted.some(sent => !beforeMark.some(record => record.id === sent.id))) {
            throw new ActualSaveReadbackUnknownError('read_failed');
          }
          // The server confirmed the old values; a newer correction still needs its own approval and save.
          const unchangedConfirmedIds = result.confirmedIds.filter(id => attempted.some(sent => sent.id === id
            && beforeMark.some(record => record.id === id && record.minutes === sent.minutes)));
          const marked = markWeeklyPlanningVNextActualRecordsSaved(
            { ownerId, weekStartDate: candidate.weekStartDate, conversationId: candidate.conversationId },
            { checkpoint: candidate.local.checkpoint, legacyV5Checkpoint: candidate.local.legacyV5Checkpoint, now: services.now },
            unchangedConfirmedIds,
          );
          if (marked.status === 'unreadable') throw new ActualSaveReadbackUnknownError('read_failed');
        }
        const reply = formatActualSaveReadbackReply(attempted, result.confirmedIds, result.conflictingIds);
        tell(`${result.status}:${result.confirmedIds.join(',')}:${result.conflictingIds.join(',')}`, reply);
        if (result.status === 'not_saved' && stillCurrent()) retryEligible.current = candidate;
        if (result.status === 'saved') candidate.local.clearActualSaveAttempt(candidate.conversationId, candidate.attempt.attemptedAt);
        redraw(value => value + 1);
      } catch (error) {
        retryEligible.current = null;
        const reason = error instanceof ActualSaveReadbackUnknownError ? error.reason : 'read_failed';
        tell(`unknown:${reason}`, formatUnknownActualSaveReadbackReply(reason));
      } finally { actualReadbackInFlight.current = false; }
    };
    void run();
  }, [chat, revision, services, input.userId]);
  // Same unsaved-chat warning as V5: a failed checkpoint write leaves the live state as the only copy.
  useEffect(() => {
    if ((!chat.dirty && !cloud.unpersisted) || typeof window === 'undefined' || !window.addEventListener) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [chat, revision, cloud, cloud.unpersisted]);
  // A chat checkpoint, import or new chat replaces runtime.local; the gateway always uses the live one.
  const liveSession = useMemo(() => ({ get checkpoint() { return runtime.local.checkpoint; },
    get legacyV5Checkpoint() { return runtime.local.legacyV5Checkpoint; } }), [runtime]);
  const gateway = useMemo(() => createWeeklyPlanningVNextRuntimeGateway({ session: liveSession,
    savingActualRecordIds: () => savingActualRecordIds.current,
    ports: async turn => {
      await services.preload?.();
      const local = runtime.local;
      const client = services.client();
      return { client, interpret: services.interpret({ ownerId, conversationId: turn.pending.conversationId }),
        checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
        // This composition uses the ordinary approval application below, never the session's save entry.
        approvalLedger: { read: () => null, write: () => { throw new Error('Approval belongs to the existing application.'); } },
        plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('Approval belongs to the existing application.'); } },
        calendar: () => ({ plans: turn.plans, actuals: turn.actuals ?? [], monthEvents: turn.monthEvents ?? [],
          scheduleTemplates: turn.scheduleTemplates, timetableTermId: turn.timetableTermId }),
        createRenderer: options => services.createRenderer(client, options), now: services.now };
    } }), [liveSession, runtime, services, ownerId]);
  const turnServices = { ...weeklyPlanningTurnApplicationBaseServices, ...gateway,
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
  // A reply that finished while the app was away is read back by its saved request identity, never re-run.
  // Each chat has its own receipt conversation and checkpoint slot, so it resumes only into its own chat.
  useEffect(() => {
    if (!durableWeeklyPlanningEnabled() || !input.userId || chat.requiresInitialization || !current()) return;
    const receipt = readWeeklyPlanningVNextDurableReceipt(input.userId);
    const state = runtime.state;
    recoverDurableWeeklyTurn({
      core: 'vnext', ownerId, conversationId: runtime.session.conversationId, state, recovering: recoveringDurableRequest, receipt,
      plannerDataReady: plannerReady(),
      persistedRevision: () => {
        try {
          const saved = runtime.local.load();
          return saved.conversationId === receipt?.pending.conversationId ? saved.state.revision : undefined;
        } catch { return undefined; }
      },
      chatSaved: () => chat.checkpoint().status === 'saved',
      resubmit: stable => submitWeeklyPlanningApplicationTurnWithServices({ ...input, ...durableReceiptTurnParams(stable),
        userId: ownerId, ownerId, session: runtime.session, getState, dispatch, now: services.now,
        isPlannerDataSnapshotCurrent: plannerReady, isApplicationCurrent: current }, turnServices).then(result => {
        // Like a submitted turn, a recovered one commits its accepted state into the owning chat's record.
        if (current()) chat.checkpoint();
        return result;
      }),
    });
  }, [chat, runtime, revision, runtime.state, runtime.session.conversationId, input.userId, input.plannerDataAvailability]);
  const pendingDraftBlocks = runtime.state.draftBlocks.filter(block => block.status === 'draft');
  // The study records live in the conversation's checkpoint (I2), next to the facts they were read apart from. An
  // unreadable checkpoint offers none here; the chat's own retry state already reports that condition.
  const pendingActualRecords = useMemo(() => {
    let stored: WeeklyPlanningActualRecord[] | undefined;
    try { stored = runtime.local.readCheckpoint()?.vnext.actualRecords; } catch { stored = undefined; }
    // Already-saved documents (the planner's loaded actuals, by id) decide whether a record is a new save, a no-op or a replacement.
    const savedMinutes = new Map<string, number>();
    let unresolvedIds: ReadonlySet<string> = new Set();
    try { unresolvedIds = new Set(runtime.local.readActualSaveAttempt(runtime.session.conversationId)?.records.map(record => record.id)); }
    catch { /* An unreadable UI snapshot cannot certify optimistic rows. */ }
    for (const actual of input.actuals ?? []) if (!savingActualRecordIds.current.has(actual.id)
      && !unresolvedIds.has(actual.id) && 'actualDurationMinutes' in actual && actual.actualDurationMinutes) savedMinutes.set(actual.id, actual.actualDurationMinutes);
    return resolvePendingActualRecordsAgainstSaved(selectPendingActualRecords(stored)
      .filter(record => savedActualMinutes.get(record.id) !== record.minutes), savedMinutes);
    // `revision` changes after every committed turn and every mark.
  }, [runtime, runtime.state, revision, savedActualMinutes, input.actuals]);
  const approveActualRecords = async () => {
    const records = pendingActualRecords;
    // Nothing to save, an owner that is not signed in, or a save already running: never write (no owner mismatch writes).
    if (records.length === 0 || actualRecordsInFlight.current || actualReadbackInFlight.current || actualSyncPreflight.current
      || !input.userId || !input.saveWeeklyActualRecords || !current()) return;
    if (cloud.storage && runtime.local.readActualSaveAttempt(runtime.session.conversationId) === null) {
      const beforeSync = runtime.state;
      actualSyncPreflight.current = true;
      try { if (!await cloud.beforeApproval() || !current() || runtime.state !== beforeSync) return; }
      finally { actualSyncPreflight.current = false; }
    }
    const saveLocal = runtime.local;
    const saveConversationId = runtime.session.conversationId;
    const saveWeekStartDate = runtime.state.weekStartDate;
    const priorAttempt = saveLocal.readActualSaveAttempt(saveConversationId);
    const retry = priorAttempt !== null;
    const sameRetry = () => {
      if (!priorAttempt || !services.readActualSave || !current() || runtime.local !== saveLocal
        || runtime.session.conversationId !== saveConversationId || input.userId?.trim() !== ownerId
        || committedInput.current?.userId?.trim() !== ownerId) return false;
      const permitted = retryEligible.current;
      if (!permitted || permitted.local !== saveLocal || permitted.conversationId !== saveConversationId
        || permitted.attempt.attemptedAt !== priorAttempt.attemptedAt
        || JSON.stringify(permitted.attempt.records) !== JSON.stringify(priorAttempt.records)) return false;
      try {
        const live = saveLocal.readActualSaveAttempt(saveConversationId);
        const stored = saveLocal.readCheckpoint()?.vnext.actualRecords ?? [];
        return live?.attemptedAt === priorAttempt.attemptedAt
          && JSON.stringify(live.records) === JSON.stringify(priorAttempt.records)
          && records.length === priorAttempt.records.length
          && records.every((record, index) => record.id === priorAttempt.records[index].id
            && stored.some(item => item.id === record.id && item.minutes === record.minutes
              && item.occurrenceDate === record.occurrenceDate && item.subject === record.subject && item.status !== 'saved'));
      } catch { return false; }
    };
    if (retry && !sameRetry()) return;
    const correctedRetry = priorAttempt !== null && records.some((record, index) => record.minutes !== priorAttempt.records[index].minutes);
    const attemptedAt = correctedRetry ? services.now() : priorAttempt?.attemptedAt ?? services.now();
    if (!retry) {
      retryEligible.current = null;
      // A first confirmation captures the exact batch in the browser UI slot, outside the Worker checkpoint.
      saveLocal.save(saveConversationId, runtime.state, { attemptedAt,
        records: records.map(({ id, minutes }) => ({ id, minutes })) });
    }
    const reportRetry = (content: string) => {
      if (current() && runtime.local === saveLocal && runtime.session.conversationId === saveConversationId
        && committedInput.current?.userId?.trim() === ownerId) {
        dispatch({ type: 'append_message', message: { id: createWeeklyPlanningApplicationRequestId('actual-save-retry'),
          role: 'assistant', content, createdAt: services.now() } });
      }
    };
    // The exact attempt must be durable before a server write can begin.
    if (cloud.storage) {
      actualRecordsInFlight.current = true;
      try { await cloud.persist(); }
      catch (error) { actualRecordsInFlight.current = false; throw error; }
      if (!current() || runtime.local !== saveLocal) { actualRecordsInFlight.current = false; return; }
    }
    actualRecordsInFlight.current = true;
    savingActualRecordIds.current = new Set(records.map(record => record.id));
    redraw(value => value + 1);
    try {
      if (retry) {
        let checked: ActualSaveReadbackClassification;
        try { checked = await services.readActualSave!(ownerId, toActualRecordsToSave(records)); }
        catch (error) {
          retryEligible.current = null;
          const reason = error instanceof ActualSaveReadbackUnknownError ? error.reason : 'read_failed';
          reportRetry(formatUnknownActualSaveReadbackReply(reason));
          return;
        }
        if (!sameRetry()) { retryEligible.current = null; return; }
        if (checked.status !== 'not_saved') {
          retryEligible.current = null;
          reportRetry(ACTUAL_SAVE_RETRY_BLOCKED_REPLY);
          return;
        }
        retryEligible.current = null;
        if (correctedRetry) {
          // The old batch is confirmed absent; retain the corrected values actually being sent if this acknowledgement is lost.
          saveLocal.save(saveConversationId, runtime.state, { attemptedAt,
            records: records.map(({ id, minutes }) => ({ id, minutes })) });
        }
      }
      try { await input.saveWeeklyActualRecords(ownerId, toActualRecordsToSave(records)); }
      catch (error) {
        if (retry) reportRetry(ACTUAL_SAVE_RETRY_FAILED_REPLY);
        // A scope that expired while the batch ran does not prove nothing was written (the server may have
        // committed): keep the attempt so a reload reads the server back. Other rejections are refusals.
        else if (!(error instanceof PlannerMutationScopeExpiredError)) saveLocal.clearActualSaveAttempt(saveConversationId, attemptedAt);
        throw error;
      }
      // A turn may have corrected a value while the batch was in flight. Only the values that this
      // batch actually wrote may acquire the saved mark; a correction remains pending.
      let latest: WeeklyPlanningActualRecord[] = [];
      try { latest = saveLocal.readCheckpoint()?.vnext.actualRecords ?? []; } catch { /* a committed batch remains committed */ }
      const ids = records.filter(record => latest.some(item => item.id === record.id && item.minutes === record.minutes)).map(record => record.id);
      if (current() && runtime.local === saveLocal) setSavedActualMinutes(previous => new Map([...previous,
        ...records.filter(record => ids.includes(record.id)).map(record => [record.id, record.minutes] as const)]));
      // The persisted mark (I2) keeps a reload from offering the same records again. The saved batch is already
      // committed, so a mark that cannot be written is not reported as a failed save: the in-memory minutes above hide
      // the records for this session and their deterministic ids make any later re-save an overwrite, not a duplicate.
      // Loaded lazily: the session code is not part of the entry chunk. A mark that cannot be written (module load or storage)
      // is not a failed save, so it never reaches the user as one.
      let marked = false;
      try {
        const { markWeeklyPlanningVNextActualRecordsSaved } = await loadWeeklyPlanningVNextRuntimeModule();
        const result = markWeeklyPlanningVNextActualRecordsSaved(
          { ownerId, weekStartDate: saveWeekStartDate, conversationId: saveConversationId },
          { checkpoint: saveLocal.checkpoint, legacyV5Checkpoint: saveLocal.legacyV5Checkpoint, now: services.now },
          ids,
        );
        marked = result.status !== 'unreadable';
      } catch { /* the in-memory minutes above hide the saved values for this session */ }
      // If the server acknowledged a retry but the local mark failed, retain its intent for the next server readback.
      if (!retry || marked) saveLocal.clearActualSaveAttempt(saveConversationId, attemptedAt);
      if (retry) reportRetry(ACTUAL_SAVE_RETRY_SAVED_REPLY);
      if (current() && runtime.local === saveLocal) chat.checkpoint();
    } finally {
      actualRecordsInFlight.current = false;
      savingActualRecordIds.current = new Set();
      redraw(value => value + 1);
    }
  };
  // The preparation sequence is shared with the V5 hook; only these accessors are this core's.
  const preparationPorts = {
    isPlannerDataCurrent: () => Boolean(input.userId && isPlannerDataReadyForOwner(input.plannerDataAvailability, input.userId)
      && input.isPlannerDataSnapshotCurrent()),
    binding,
    isRequestCurrent: () => current() && committedInput.current === input,
    stateIdentity: () => runtime.state,
    indexIdentity: () => chat.index,
    preflight: loadWeeklyPlanningVNextRuntimeModule,
  };
  const prepareTurn = () => prepareWeeklyPlanningTurn(preparationPorts);
  return { registeredTargetsAvailable: true, conversationSync: cloud.ui, chat, state: runtime.state, pendingDraftBlocks,
    approvalAvailability: cloud.permitsEditing()
      ? classifyWeeklyPlanningApprovalAvailability({ blocks: pendingDraftBlocks, userId: ownerId, resolveRuntime: runtime.local.resolveRuntime })
      : { kind: 'recompute_required', reason: 'state_revision_mismatch', message: '同期状態を確認してから承認してください。' },
    canEditDraftBlocks: current() && !runtime.state.pendingTurn && !runtime.state.pendingApproval && !runtime.state.approvalRecovery,
    plannerDataReady: plannerReady(),
    prepareTurn,
    getModuleRecoveryBinding: binding,
    checkpointForModuleReload: () => {
      const captured = binding(); const state = runtime.state;
      return captured && chat.checkpoint().status === 'saved' ? { binding: captured, isCurrent: () => current() && runtime.state === state } : null;
    },
    submitTurn: async (userText, supplementalContext, selectedStarterTarget, machineBoundAnswer) => {
      if (cloud.storage) { try { await cloud.persist(); } catch { return { accepted: false, draftCandidates: [] }; } }
      const start = { state: runtime.state, index: chat.index, binding: binding() };
      if (!input.userId || !current() || chat.requiresInitialization || runtime.state.approvalRecovery) return { accepted: false, draftCandidates: [] };
      // The same preparation and admission as V5: stale planner data is reported as such, the lazy runtime
      // loads before any OCR or provider call, and nothing may have moved while that awaited.
      const admission = admitPreparedWeeklyPlanningTurn({ preparation: await prepareTurn(), ports: preparationPorts, start });
      if (!admission.admitted) return admission.result;
      // Save the same selected conversation before accepting remote work, including its first turn (as V5 does): its
      // conversation id must survive a reload for the receipt. A failed save is the chat's own retry/blocked state.
      if (durableWeeklyPlanningEnabled() && chat.checkpoint().status !== 'saved') return { accepted: false, draftCandidates: [] };
      const result = await submitWeeklyPlanningApplicationTurnWithServices({ ...input, userId: ownerId, ownerId,
        session: runtime.session, userText, supplementalContext, selectedStarterTarget, machineBoundAnswer,
        weekStartsOn, getState, dispatch, now: services.now,
        isPlannerDataSnapshotCurrent: plannerReady, isApplicationCurrent: current }, turnServices);
      if (current()) {
        chat.checkpoint();
        try { await cloud.persist(); } catch { /* Live reply remains visible with the unsaved warning. */ }
      }
      return result;
    },
    cancelTurn: () => {
      const pending = runtime.state.pendingTurn;
      const cancelled = cancelWeeklyPlanningControlledTurn({ getState, dispatch });
      if (cancelled && pending && input.userId && durableWeeklyPlanningEnabled()) {
        recoveringDurableRequest.current = pending.requestId;
        void cancelDurableWeeklyTurn(ownerId, pending.requestId, undefined, 'vnext').finally(() => {
          if (recoveringDurableRequest.current === pending.requestId) recoveringDurableRequest.current = null;
        });
      }
      return cancelled;
    },
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
    pendingActualRecords,
    approveActualRecords,
    approveDraftBlocks: async () => {
      const beforeSync = runtime.state;
      if (cloud.storage) {
        // Recovery reconciles the original approval operation. Its local-only receipt cannot be a cloud sync prerequisite.
        if (beforeSync.approvalRecovery) await cloud.persist();
        else if (!await cloud.beforeApproval()) return;
        if (!current() || runtime.state !== beforeSync) return;
      }
      await approveWeeklyPlanningDraftBlocks({ ...input, userId: ownerId,
      featureSessionId: runtime.session.conversationId, plans: input.plans, getState, dispatch,
      resolveRuntime: runtime.local.resolveRuntime, approvalOperations: runtime.operations,
      onOperationCompleted: operation => {
        runtime.operations = [...runtime.operations.filter(item => item.approvalOperationId !== operation.approvalOperationId), operation];
        saveWeeklyPlanningApprovalOperations(ownerId, runtime.operations);
      } });
      try {
        await cloud.persist();
        // The completed recovery is cloud-eligible again; persist has already consumed its local dirty marker.
        if (beforeSync.approvalRecovery) await cloud.refresh();
      } catch { /* Saving a Plan and synchronizing its UI receipt are distinct. */ }
    },
  };
}
