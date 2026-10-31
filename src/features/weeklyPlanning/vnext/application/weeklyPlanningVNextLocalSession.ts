// Local experiment persistence only. The accepted facts stay in the VNext checkpoint; this
// separate UI snapshot holds the existing controller's messages/preview/recovery. Never write
// a V5 slot or manufacture a V5 runtime graph. LocalRuntime integration tests guard rollback.
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import { isPersistedWeeklyPlanningState } from '../../weeklyPlanningStateCodec';
import { getWeeklyPlanningStableV5StorageSnapshot } from '../weeklyPlanningVNextV5Boundary';
import type { resolveWeeklyPlanningApprovalRuntime } from '../../application/weeklyPlanningApprovalRuntimeResolver';
import type { PlanningState } from '../../types';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { createWeeklyPlanningApplicationRequestId } from '../../application/weeklyPlanningApplicationIdentity';

export function createWeeklyPlanningVNextLocalSession(params: {
  ownerId: string;
  weekStartDate: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}) {
  const { ownerId, weekStartDate, storage } = params;
  const prefix = `studyplanner.weeklyPlanning.vnext.${ownerId}.${weekStartDate}`;
  const checkpoint = { read: () => storage.getItem(`${prefix}.core`),
    write: (raw: string) => storage.setItem(`${prefix}.core`, raw), remove: () => storage.removeItem(`${prefix}.core`) };
  const legacyV5Checkpoint = { read: () => storage.getItem(getWeeklyPlanningStableV5StorageSnapshot(ownerId, weekStartDate).key) };
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
      if (!isPersistedWeeklyPlanningState(state, { kind: 'stable_v5_session_v1', ownerId, weekStartDate,
        conversationId: value.conversationId, graphRevision: accepted?.vnext.state.graph.revision ?? 0 })
        || value.ownerId !== ownerId || typeof value.conversationId !== 'string' || !value.conversationId
        || (accepted && accepted.conversationId !== value.conversationId)) throw new Error('VNext UI checkpoint is unreadable; existing bytes were retained.');
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
    // The existing migration port requires the legacy conversation identity, but only reads its bytes.
    let conversationId: string | undefined;
    if (legacyRaw !== null) {
      const value: unknown = JSON.parse(legacyRaw);
      if (typeof value === 'object' && value !== null && 'conversationId' in value && typeof value.conversationId === 'string') {
        conversationId = value.conversationId;
      }
    }
    return { conversationId: conversationId ?? createWeeklyPlanningApplicationRequestId('vnext-conversation'), state };
  }
  function save(conversationId: string, state: PlanningState): void {
    storage.setItem(`${prefix}.ui`, JSON.stringify({ ownerId, conversationId, payload: { version: 2, state } }));
  }
  const resolveRuntime: typeof resolveWeeklyPlanningApprovalRuntime = ({ blocks, userId }) => {
    const accepted = core();
    const conversationId = blocks[0]?.behaviorMetadata?.previewMetadata?.conversationId;
    if (userId !== ownerId) return { kind: 'owner_mismatch', stableV5: true, runtimeSnapshot: null };
    if (!accepted || accepted.conversationId !== conversationId || !accepted.vnext.preview
      || blocks.some(block => !accepted.vnext.preview!.blocks.some(shown => shown.id === block.id))) {
      return { kind: 'unavailable', stableV5: true, runtimeSnapshot: null };
    }
    return { kind: 'available', stableV5: true, runtimeSnapshot: { conversationId: accepted.conversationId,
      stateRevision: accepted.vnext.state.graph.revision, proposalRecords: [] } };
  };
  return { load, save, checkpoint, legacyV5Checkpoint, resolveRuntime,
    readCheckpoint: core,
    clear: () => { checkpoint.remove(); storage.removeItem(`${prefix}.ui`); } };
}

export type WeeklyPlanningVNextLocalSession = ReturnType<typeof createWeeklyPlanningVNextLocalSession>;
