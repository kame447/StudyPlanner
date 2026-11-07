// Local experiment persistence only. The accepted facts stay in the VNext checkpoint; this
// separate UI snapshot holds the existing controller's messages/preview/recovery. Never write
// a V5 slot or manufacture a V5 runtime graph. LocalRuntime integration tests guard rollback.
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import { isPersistedWeeklyPlanningState } from '../../weeklyPlanningStateCodec';
import { weeklyPlanningStableV5StorageKey, parseWeeklyPlanningStableV5PersistedSession } from '../weeklyPlanningVNextV5Boundary';
import type { resolveWeeklyPlanningApprovalRuntime } from '../../application/weeklyPlanningApprovalRuntimeResolver';
import type { PlanningState } from '../../types';
import { parseWeeklyPlanningVNextSessionCheckpoint, serializeWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { readWeeklyPlanningVNextExperimentalSession } from './weeklyPlanningVNextSessionRead';
import { createWeeklyPlanningApplicationRequestId } from '../../application/weeklyPlanningApplicationIdentity';
import { UNKNOWN_ACTUAL_SAVE_RESULT_REPLY } from '../../application/weeklyPlanningActualRecords';

export interface WeeklyPlanningActualSaveAttempt {
  readonly attemptedAt: string;
  readonly records: readonly { readonly id: string; readonly minutes: number }[];
}

function parseActualSaveAttempt(value: unknown): WeeklyPlanningActualSaveAttempt | null {
  if (!value || typeof value !== 'object') return null;
  const attempt = value as Partial<WeeklyPlanningActualSaveAttempt>;
  return typeof attempt.attemptedAt === 'string' && attempt.attemptedAt.length > 0
    && Array.isArray(attempt.records) && attempt.records.length > 0
    && attempt.records.every(record => record && typeof record.id === 'string' && record.id.length > 0
      && Number.isInteger(record.minutes) && record.minutes > 0)
    ? { attemptedAt: attempt.attemptedAt, records: attempt.records.map(record => ({ id: record.id, minutes: record.minutes })) }
    : null;
}

export function createWeeklyPlanningVNextLocalSession(params: {
  ownerId: string;
  weekStartDate: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  chatId?: string;
  /** Explicit null starts a new chat; undefined reads the pre-multi-chat weekly slot. */
  legacyV5Raw?: string | null;
}) {
  const { ownerId, weekStartDate, storage } = params;
  const prefix = `studyplanner.weeklyPlanning.vnext.${ownerId}.${weekStartDate}${params.chatId ? `.${params.chatId}` : ''}`;
  const checkpoint = { read: () => storage.getItem(`${prefix}.core`),
    write: (raw: string) => storage.setItem(`${prefix}.core`, raw), remove: () => storage.removeItem(`${prefix}.core`) };
  const legacyV5Checkpoint = { read: () => {
    const raw = params.legacyV5Raw === undefined
      ? storage.getItem(weeklyPlanningStableV5StorageKey(ownerId, weekStartDate)) : params.legacyV5Raw;
    // Invalid legacy data stays untouched and cannot block a fresh VNext conversation.
    return raw !== null && parseWeeklyPlanningStableV5PersistedSession({ raw, ownerId, weekStartDate }) ? raw : null;
  } };
  const core = () => {
    const raw = checkpoint.read();
    if (raw === null) return null;
    const parsed = parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId, weekStartDate });
    if (!parsed) throw new Error('VNext checkpoint is unreadable; existing bytes were retained.');
    return parsed;
  };
  function load(): { conversationId: string; state: PlanningState } {
    const raw = storage.getItem(`${prefix}.ui`);
    const accepted = core();
    if (raw !== null) {
      const value = JSON.parse(raw);
      const stored = value.payload?.state;
      const state = stored && typeof stored === 'object' ? { ...stored,
        pendingTurn: undefined, pendingApproval: undefined,
        draftBlocks: Array.isArray(stored.draftBlocks) ? stored.draftBlocks.filter((block: { status: string }) => block.status === 'draft') : stored.draftBlocks } : null;
      // Reuse the existing UI codec for V5 placement candidates, with the actual VNext revision.
      // This is a presentation shape check, not a fabricated V5 runtime/checkpoint.
      if (state) { delete state.pendingTurn; delete state.pendingApproval; }
      // The core owns preview authority. A legacy automatic preview invalidated by its reader
      // must not reappear from this UI cache. Keep user-created/edited draft blocks and raw bytes.
      if (state && accepted && !accepted.vnext.preview) state.previewCandidates = [];
      if (!isPersistedWeeklyPlanningState(state, { kind: 'stable_v5_session_v1', ownerId, weekStartDate,
        conversationId: value.conversationId, graphRevision: accepted?.vnext.state.graph.revision ?? 0 })
        || value.ownerId !== ownerId || typeof value.conversationId !== 'string' || !value.conversationId
        || (accepted && accepted.conversationId !== value.conversationId)) throw new Error('VNext UI checkpoint is unreadable; existing bytes were retained.');
      const attempt = parseActualSaveAttempt(value.actualSaveAttempt);
      if (attempt && accepted?.vnext.actualRecords?.some(record => record.status !== 'saved'
        && attempt.records.some(sent => sent.id === record.id && sent.minutes === record.minutes))) {
        const id = `${value.conversationId}:actual-save-result-unknown:${attempt.attemptedAt}`;
        if (!state.messages.some(message => message.id === id)) state.messages = [...state.messages,
          { id, role: 'assistant', content: UNKNOWN_ACTUAL_SAVE_RESULT_REPLY, createdAt: attempt.attemptedAt }];
      }
      return { conversationId: value.conversationId, state };
    }
    const state = createInitialPlanningState(weekStartDate);
    if (accepted) {
      // A crash after core commit can precede UI persistence. Recover presentation from that core,
      // not from V5's state or a guessed graph. Existing preview blocks keep their original metadata.
      state.messages = accepted.vnext.messages.map((message, index) => ({ ...message,
        id: `${accepted.conversationId}:restored:${index}`, createdAt: accepted.savedAt }));
      state.draftBlocks = accepted.vnext.preview?.blocks ?? [];
      return { conversationId: accepted.conversationId, state };
    }
    const legacyRaw = legacyV5Checkpoint.read();
    if (legacyRaw !== null) {
      const legacy = parseWeeklyPlanningStableV5PersistedSession({ raw: legacyRaw, ownerId, weekStartDate })!;
      const scope = { ownerId, weekStartDate, conversationId: legacy.conversationId };
      const migrated = readWeeklyPlanningVNextExperimentalSession(scope, { checkpoint, legacyV5Checkpoint });
      if (migrated.status !== 'ready') throw new Error('V5 migration is unavailable; existing bytes were retained.');
      const next = serializeWeeklyPlanningVNextSessionCheckpoint({ ...scope, vnext: migrated.checkpoint, savedAt: legacy.savedAt });
      if (next === null) throw new Error('V5 migration exceeds the checkpoint limit; existing bytes were retained.');
      checkpoint.write(next);
      // Old previews/questions used a different revision. Keep the conversation visible,
      // while the migrated core derives a fresh question or preview on the next turn.
      state.messages = legacy.planningState.messages;
      state.draftBlocks = legacy.planningState.draftBlocks.filter(block => block.status === 'draft');
      save(legacy.conversationId, state);
      return { conversationId: legacy.conversationId, state };
      }
    return { conversationId: createWeeklyPlanningApplicationRequestId('vnext-conversation'), state };
  }
  function readActualSaveAttempt(conversationId: string): WeeklyPlanningActualSaveAttempt | null {
    const raw = storage.getItem(`${prefix}.ui`);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    return value.ownerId === ownerId && value.conversationId === conversationId
      ? parseActualSaveAttempt(value.actualSaveAttempt) : null;
  }
  function save(conversationId: string, state: PlanningState, attempt?: WeeklyPlanningActualSaveAttempt | null): void {
    const actualSaveAttempt = attempt === undefined ? readActualSaveAttempt(conversationId) : attempt;
    storage.setItem(`${prefix}.ui`, JSON.stringify({ ownerId, conversationId, payload: { version: 2, state },
      ...(actualSaveAttempt ? { actualSaveAttempt } : {}) }));
  }
  function clearActualSaveAttempt(conversationId: string, attemptedAt: string): void {
    const raw = storage.getItem(`${prefix}.ui`);
    if (raw === null) return;
    const value = JSON.parse(raw);
    if (value.ownerId !== ownerId || value.conversationId !== conversationId
      || parseActualSaveAttempt(value.actualSaveAttempt)?.attemptedAt !== attemptedAt) return;
    delete value.actualSaveAttempt;
    storage.setItem(`${prefix}.ui`, JSON.stringify(value));
  }
  const resolveRuntime: typeof resolveWeeklyPlanningApprovalRuntime = ({ blocks, userId }) => {
    const accepted = core();
    const conversationId = blocks[0]?.behaviorMetadata?.previewMetadata?.conversationId;
    if (userId !== ownerId) return { kind: 'owner_mismatch', stableV5: true, runtimeSnapshot: null };
    if (!accepted || accepted.conversationId !== conversationId || !accepted.vnext.preview
      // A same-revision replan keeps IDs; an earlier selected placement is no longer the shown plan (#1034).
      || blocks.some(block => !accepted.vnext.preview!.blocks.some(shown => shown.id === block.id
        && shown.date === block.date && shown.startTime === block.startTime && shown.endTime === block.endTime))) {
      return { kind: 'unavailable', stableV5: true, runtimeSnapshot: null };
    }
    return { kind: 'available', stableV5: true, runtimeSnapshot: { conversationId: accepted.conversationId,
      stateRevision: accepted.vnext.state.graph.revision, proposalRecords: [] } };
  };
  return { load, save, readActualSaveAttempt, clearActualSaveAttempt, checkpoint, legacyV5Checkpoint, resolveRuntime,
    readCheckpoint: core,
    clear: () => { checkpoint.remove(); storage.removeItem(`${prefix}.ui`); } };
}

export type WeeklyPlanningVNextLocalSession = ReturnType<typeof createWeeklyPlanningVNextLocalSession>;
