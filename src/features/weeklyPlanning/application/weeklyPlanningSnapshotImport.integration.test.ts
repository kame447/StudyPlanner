import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from '../semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import fc from 'fast-check';
import { createWeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApproval';
import { createWeeklyPlanningTestDraftBlock } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication } from './useWeeklyPlanningApplication';
import { getWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { parseWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionCodec';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { createMemoryStorageHarness } from '../testUtils/weeklyPlanningApplicationTestHarness';
let app: WeeklyPlanningApplication;
let renderer: ReactTestRenderer;
function Harness() {
  app = useWeeklyPlanningApplication({ userId: 'audit-owner', selectedDate: '2026-10-04', plans: [], scheduleTemplates: [], isPlannerDataSnapshotCurrent: () => true, plannerDataAvailability: createReadyPlannerDataAvailability('audit-owner'), saveWeeklyApprovedPlan: vi.fn() });
  return null;
}
afterEach(() => { act(() => renderer?.unmount()); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); vi.unstubAllGlobals(); });
let storage: Storage;
beforeEach(() => {
  storage = createMemoryStorageHarness().storage;
  vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in audit'); }));
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  act(() => { renderer = create(createElement(Harness)); });
});
it('rejects malformed typed snapshots before changing runtime, visible state or storage', () => {
  const snapshot = app.exportConversationSnapshot({ includeEmpty: true })!;
  expect(snapshot).not.toBeNull();
  expect(parseWeeklyPlanningStableV5PersistedSession({ raw: JSON.stringify(snapshot), ownerId: snapshot.ownerId, weekStartDate: snapshot.weekStartDate })).not.toBeNull();
  const before = structuredClone(app.state);
  const runtimeBefore = getWeeklyPlanningStableV5RuntimeSession(snapshot.conversationId);
  const storedBefore = Array.from({ length: storage.length }, (_, index) => [storage.key(index), storage.getItem(storage.key(index)!) ]);
  snapshot.graph.revision = -1;
  snapshot.planningState.messages = [{ id: 'injected-message', role: 'assistant', content: 'audit malformed load', createdAt: '2026-10-04T00:00:00.000Z' }];
  expect(parseWeeklyPlanningStableV5PersistedSession({ raw: JSON.stringify(snapshot), ownerId: snapshot.ownerId, weekStartDate: snapshot.weekStartDate })).toBeNull();
  let loaded: boolean | undefined;
  act(() => { loaded = app.loadConversationSnapshot(snapshot); });
  expect(loaded).toBe(false);
  expect(getWeeklyPlanningStableV5RuntimeSession(snapshot.conversationId)).toEqual(runtimeBefore);
  expect(app.state).toEqual(before);
  expect(Array.from({ length: storage.length }, (_, index) => [storage.key(index), storage.getItem(storage.key(index)!) ])).toEqual(storedBefore);
  expect(app.exportConversationSnapshot({ includeEmpty: true })).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects generated malformed envelopes without side effects or caller-side validation', () => {
  const baseline = app.exportConversationSnapshot({ includeEmpty: true })!;
  const canonical = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(), document: {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss', planningWindow: null,
      tasks: [{ localId: 'task', category: 'non_study', title: 'task', study: null, workloads: [], effortEstimates: [],
        temporalConstraints: [], recurrence: [], sourceText: 'task' }],
      relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
    }, context: { conversationId: baseline.conversationId, turnId: 'source-turn', expectedRevision: 0 },
  });
  if (canonical.status !== 'applied') throw new Error(canonical.errors.join(','));
  baseline.graph = canonical.graph;
  const before = structuredClone(app.state);
  const runtimeBefore = getWeeklyPlanningStableV5RuntimeSession(baseline.conversationId);
  const kinds = ['owner', 'version', 'revision', 'conversation', 'week', 'messages', 'pending', 'root', 'nonfinite'] as const;
  fc.assert(fc.property(fc.constantFrom(...kinds), fc.string({ maxLength: 80 }), fc.integer({ min: 1, max: 1000 }), (kind, text, number) => {
    const candidate = structuredClone(baseline);
    let input: unknown = candidate;
    switch (kind) {
      case 'owner': candidate.ownerId = `other-${text}`; break;
      case 'version': Object.assign(candidate, { version: `unsupported-${text}` }); break;
      case 'revision': candidate.graph.revision = -number; break;
      case 'conversation': candidate.conversationId = ''; break;
      case 'week': candidate.weekStartDate = `invalid-${text}`; break;
      case 'messages': Object.assign(candidate.planningState, { messages: number }); break;
      case 'pending': Object.assign(candidate.planningState, { pendingTurn: { requestId: text } }); break;
      case 'root': input = number % 2 ? null : []; break;
      case 'nonfinite': candidate.graph.factLifecycles[0].terminalRevision = [NaN, Infinity, -Infinity][(number - 1) % 3]; break;
    }
    const storedBefore = Array.from({ length: storage.length }, (_, index) => [storage.key(index), storage.getItem(storage.key(index)!) ]);
    act(() => { expect(app.loadConversationSnapshot(input)).toBe(false); });
    expect(app.state).toEqual(before);
    expect(getWeeklyPlanningStableV5RuntimeSession(baseline.conversationId)).toEqual(runtimeBefore);
    expect(Array.from({ length: storage.length }, (_, index) => [storage.key(index), storage.getItem(storage.key(index)!) ])).toEqual(storedBefore);
  // Stop at the first failing import: a faulty implementation may mutate the live hook.
  }), { seed: 20261004, numRuns: 40, endOnFailure: true, examples: [...kinds.map(kind => [kind, '', 1] as [typeof kinds[number], string, number]), ['nonfinite', '', 2], ['nonfinite', '', 3]] });
  expect(fetch).not.toHaveBeenCalled();
});

it('accepts valid expanded recovery through compact validation and isolates imported mutable objects', () => {
  const snapshot = app.exportConversationSnapshot({ includeEmpty: true })!;
  const blocks = Array.from({ length: 5 }, (_, index) => createWeeklyPlanningTestDraftBlock({
    id: `snapshot-block-${index}`, userId: 'audit-owner', overrides: { memo: 'x'.repeat(250_000) },
  }));
  const operation = createWeeklyDraftApprovalOperation({ userId: 'audit-owner', blocks,
    metadata: { previewId: 'snapshot-preview', stateRevision: 0, assumptionDependencies: [],
      approvalEligibility: 'eligible', stale: false, authorizedUserId: 'audit-owner' }, now: snapshot.savedAt });
  operation.status = 'partially_saved';
  operation.items.forEach((item, index) => { item.status = index ? 'failed' : 'saved'; if (!index) item.savedPlanId = 'saved-a'; });
  snapshot.planningState.draftBlocks = structuredClone(blocks.slice(1));
  snapshot.planningState.approvalRecovery = { version: 1, weekStartDate: snapshot.weekStartDate, operation, blocks };
  expect(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength).toBeGreaterThan(2 * 1024 * 1024);
  act(() => { expect(app.loadConversationSnapshot(snapshot)).toBe(true); });
  expect(app.state.draftBlocks).toHaveLength(4);
  expect(app.state.approvalRecovery?.operation.approvalOperationId).toBe(operation.approvalOperationId);
  snapshot.planningState.draftBlocks[0].title = 'mutated by caller';
  snapshot.graph.revision = -1;
  expect(app.state.draftBlocks[0].title).not.toBe('mutated by caller');
  expect(getWeeklyPlanningStableV5RuntimeSession(snapshot.conversationId)?.graph.revision).toBe(0);
  expect(app.exportConversationSnapshot({ includeEmpty: true })).not.toBeNull();
  const beforeSizeCheck = app.state;
  const oversized = app.exportConversationSnapshot({ includeEmpty: true })!;
  oversized.planningState.approvalRecovery = undefined;
  oversized.planningState.draftBlocks = [{ ...blocks[0], memo: 'x'.repeat(2 * 1024 * 1024) }];
  act(() => { expect(app.loadConversationSnapshot(oversized)).toBe(false); });
  expect(app.state).toBe(beforeSizeCheck);
});
