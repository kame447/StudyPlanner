import { describe, expect, it } from 'vitest';
import { createInitialPlanningState } from './weeklyPlanningReducer';
import { createWeeklyPlanningTestDraftBlock } from './testUtils/weeklyPlanningApplicationTestHarness';
import { decodeWeeklyPlanningStatePayload } from './weeklyPlanningStorage';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import {
  largestWeeklyPlanningStableV5Checkpoint,
  parseWeeklyPlanningStableV5PersistedSession,
  prepareWeeklyPlanningStableV5Checkpoint,
} from './application/weeklyPlanningStableV5SessionCodec';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';

const date = '2026-10-12';
const savedAt = '2026-10-12T00:00:00.000Z';
const allocationBreakdown = {
  estimatedMinutes: 60, calibratedMinutes: 60, bufferedMinutes: 66,
  allocatedMinutes: 70, marginMinutes: 10, reasons: ['estimate_margin', 'rounding'] as const,
};
const graph = {
  ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
  tasks: [{ id: 'task', category: 'study' as const, title: 'Reading', createdRevision: 1, source: {
    conversationId: 'allocation', turnId: 'turn', semanticLocalId: 'task', sourceText: 'Reading', origin: 'user' as const,
  } }],
  factLifecycles: [{ factId: 'task', status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null }],
};

function state(breakdown: unknown = allocationBreakdown, stable = false) {
  const draft = createWeeklyPlanningTestDraftBlock({ id: 'draft', userId: 'owner', overrides: {
    date, startTime: '09:00', endTime: '10:10', createdAt: savedAt, updatedAt: savedAt,
  } });
  const candidate: WeeklyDraftCandidate = {
    stableKey: 'preview', date, startTime: '09:00', endTime: '10:10', durationMinutes: 70,
    title: 'Reading', field: 'Reading', year: 0, estimatedMinutes: 70,
    source: 'weekly_exam_prep', approvalStatus: 'unapproved', workItemKey: 'work',
  };
  return {
    ...createInitialPlanningState(date), revision: 1, updatedAt: savedAt,
    draftBlocks: [{ ...draft, ...(breakdown === undefined ? {} : { allocationBreakdown: breakdown }) }],
    previewCandidates: [{ ...candidate, ...(breakdown === undefined ? {} : { allocationBreakdown: breakdown }),
      ...(stable ? { stableV5Metadata: { runtime: 'stable_v5', graphRevision: 1, taskId: 'task', sourceFactRefs: ['task'], planType: 'study' } } : {}),
    }],
  } as ReturnType<typeof createInitialPlanningState>;
}

describe('allocation metadata saved-data boundary', () => {
  it('preserves valid allocation numbers in the existing saved preview format', () => {
    const original = state();
    const restored = decodeWeeklyPlanningStatePayload(JSON.parse(JSON.stringify({ version: 2, state: original })), date);
    expect(restored.draftBlocks[0]?.allocationBreakdown).toEqual(allocationBreakdown);
    expect(restored.previewCandidates?.[0]?.allocationBreakdown).toEqual(allocationBreakdown);
  });

  it('keeps historical saved previews without allocation metadata readable', () => {
    const historical = state(undefined);
    delete historical.draftBlocks[0].allocationBreakdown;
    delete historical.previewCandidates![0].allocationBreakdown;
    expect(decodeWeeklyPlanningStatePayload({ version: 2, state: historical }, date).draftBlocks).toHaveLength(1);
  });

  it('round-trips through the canonical Stable V5 checkpoint writer and reader', () => {
    const planningState = state(allocationBreakdown, true);
    const params = { ownerId: 'owner', weekStartDate: date, conversationId: 'allocation', graph, planningState };
    expect(prepareWeeklyPlanningStableV5Checkpoint(params).status).toBe('ready');
    const checkpoint = largestWeeklyPlanningStableV5Checkpoint({ ...params, savedAt });
    expect(checkpoint).not.toBeNull();
    const restored = parseWeeklyPlanningStableV5PersistedSession({ raw: checkpoint!.raw, ownerId: 'owner', weekStartDate: date });
    expect(restored?.planningState.draftBlocks[0].allocationBreakdown).toEqual(allocationBreakdown);
    expect(restored?.planningState.previewCandidates?.[0].allocationBreakdown).toEqual(allocationBreakdown);
  });

  it.each([
    { ...allocationBreakdown, marginMinutes: -10 },
    { ...allocationBreakdown, estimatedMinutes: '60' },
    { ...allocationBreakdown, bufferedMinutes: Infinity },
    { ...allocationBreakdown, marginMinutes: 70 },
    { ...allocationBreakdown, reasons: ['injected reason'] },
    { ...allocationBreakdown, text: 'unexpected prose' },
  ])('rejects malformed display evidence at both storage boundaries', (invalid) => {
    const restored = decodeWeeklyPlanningStatePayload({ version: 2, state: state(invalid) }, date);
    expect(restored.draftBlocks).toEqual([]);
    const planningState = state(invalid, true);
    expect(prepareWeeklyPlanningStableV5Checkpoint({
      ownerId: 'owner', weekStartDate: date, conversationId: 'allocation', graph, planningState,
    }).status).toBe('invalid');
  });
});
