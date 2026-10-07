import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import { validateWeeklyPlanningStableV5SessionSnapshot } from './application/weeklyPlanningStableV5SessionCodec';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import { createInitialPlanningState } from './weeklyPlanningReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from './testUtils/weeklyPlanningApplicationTestHarness';
import { decodeWeeklyPlanningStatePayload } from './weeklyPlanningStorage';
import {
  getWeeklyPlanningStableV5SessionStorageKeyForTest,
  loadWeeklyPlanningStableV5PersistedSession,
  saveWeeklyPlanningStableV5PersistedSession,
} from './application/weeklyPlanningStableV5SessionStorage';

const OWNER = 'codec-owner';
const WEEK = '2026-10-05';
const CONVERSATION = 'codec-conversation';
const scope = { ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION };
const storageKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK);

function state() {
  return { ...createInitialPlanningState(WEEK), revision: 3, intakeState: createInitialPlanningIntakeState() };
}

const malformedIntakes = [
  ['unknown nested field', { ...createInitialPlanningIntakeState(), unexpectedAuthority: true }],
  ['malformed revision', { ...createInitialPlanningIntakeState(), draftGenerationAuthorizedAtRevision: -1 }],
  ['unsafe revision', { ...createInitialPlanningIntakeState(), draftGenerationAuthorizedAtRevision: Number.MAX_SAFE_INTEGER + 1 }],
  ['array masquerading as enum', { ...createInitialPlanningIntakeState(), status: ['idle'] }],
  ['array masquerading as missing slot', { ...createInitialPlanningIntakeState(), missing: [['planning_period']] }],
  ['unknown enum', { ...createInitialPlanningIntakeState(), status: 'secretly_approved' }],
  ['malformed proposal', { ...createInitialPlanningIntakeState(), learningStrategyProposalRecords: [{ status: 'accepted' }] }],
] as const;

function stableIntake(): PlanningIntakeState {
  return {
    ...createInitialPlanningIntakeState(),
    provisionalTimebox: { version: 'weekly-planning-provisional-timebox-state-v1',
      workloadFactIds: ['workload-1'], minutesPerWorkload: 60, authorizedAtGraphRevision: 0, authorizedAtTurnId: 'turn-1' },
    groundingRecords: [{ id: 'grounding-1', targetFactId: 'window-1',
      interpretationKind: 'relative_date_resolution', status: 'contested', sourceExpression: 'next week',
      startDate: WEEK, endDate: '2026-10-11', proposedAtTurnId: 'turn-1', acceptedAtTurnId: 'turn-2' }],
    repairAgenda: [{ id: 'repair-1', issueFactId: 'issue-1', targetFactId: null,
      domain: 'work_item', code: 'missing_effort', impact: 'high', status: 'deferred',
      createdRevision: 0, sourceTurnId: 'turn-1', reopenBefore: 'preview' }],
    learningStrategyProposalRecords: [{ id: 'proposal-1', kind: 'calibrate_memory_pace',
      taskId: 'task-1', workloadFactId: 'workload-1', scope: 'week', status: 'pending',
      suggestedSessionMinutes: { min: 2.5, max: 2.5 }, selectedSessionMinutes: 2.5,
      capacityStrategy: null, createdRevision: 0, proposedAtTurnId: 'turn-1', decidedAtTurnId: null }],
    lastQuestionContext: { kind: 'missing', targetSlot: 'unit_duration_estimate',
      estimateForWorkloadFactId: 'workload-1', questionBasis: 'completed_workload_total',
      presentation: { version: 1, turnId: 'turn-1', assistantMessageId: 'assistant-1',
        planningStateRevision: 3, graphRevision: 0,
        content: { responseSource: 'deterministic_fallback', currentTurnGrounding: 'none',
          selfRepairNotice: false, groundingContext: { proposed: 0, contested: 1 }, previewPromotionControl: false } } },
  };
}

const malformedExtensions: [string, (intake: Record<string, any>) => void][] = [
  ['unknown timebox version', (intake) => { intake.provisionalTimebox.version = 'future'; }],
  ['unknown timebox field', (intake) => { intake.provisionalTimebox.futureAuthority = true; }],
  ['malformed timebox duration', (intake) => { intake.provisionalTimebox.minutesPerWorkload = 999; }],
  ['unsafe timebox revision', (intake) => { intake.provisionalTimebox.authorizedAtGraphRevision = Number.MAX_SAFE_INTEGER + 1; }],
  ['unknown proposal field', (intake) => { intake.learningStrategyProposalRecords[0].futureAuthority = true; }],
  ['unknown proposal kind', (intake) => { intake.learningStrategyProposalRecords[0].kind = 'automatic_save'; }],
  ['missing proposal identity', (intake) => { delete intake.learningStrategyProposalRecords[0].id; }],
  ['negative proposal revision', (intake) => { intake.learningStrategyProposalRecords[0].createdRevision = -1; }],
  ['unsafe proposal revision', (intake) => { intake.learningStrategyProposalRecords[0].createdRevision = Number.MAX_SAFE_INTEGER + 1; }],
  ['malformed proposal duration', (intake) => { intake.learningStrategyProposalRecords[0].suggestedSessionMinutes.min = '2.5'; }],
  ['inverted proposal duration range', (intake) => { intake.learningStrategyProposalRecords[0].suggestedSessionMinutes.max = 1; }],
  ['malformed capacity strategy', (intake) => { intake.learningStrategyProposalRecords[0].capacityStrategy = { trigger: 'insufficient_capacity' }; }],
  ['malformed grounding date', (intake) => { intake.groundingRecords[0].startDate = '2026-02-30'; }],
  ['unknown grounding field', (intake) => { intake.groundingRecords[0].futureAuthority = true; }],
  ['unknown repair domain', (intake) => { intake.repairAgenda[0].domain = 'automatic_save'; }],
  ['fractional repair revision', (intake) => { intake.repairAgenda[0].createdRevision = 0.5; }],
  ['unknown question field', (intake) => { intake.lastQuestionContext.futureAuthority = true; }],
  ['unknown presentation version', (intake) => { intake.lastQuestionContext.presentation.version = 2; }],
  ['malformed presentation content', (intake) => { intake.lastQuestionContext.presentation.content.selfRepairNotice = 'false'; }],
];

describe('persisted planning state validation authority', () => {
  let storage: ReturnType<typeof createMemoryStorageHarness>;
  let restoreWindow: () => void;
  beforeEach(() => {
    storage = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storage.storage);
  });
  afterEach(() => restoreWindow());

  it.each(malformedIntakes)('rejects %s through the actual Stable V5 storage reader', (_name, intakeState) => {
    expect(saveWeeklyPlanningStableV5PersistedSession({ ...scope, graph: createEmptyWeeklyPlanningFactGraphV5(), planningState: state() })).toBe(true);
    const envelope = JSON.parse(storage.storage.getItem(storageKey)!);
    envelope.planningState.intakeState = intakeState;
    storage.storage.setItem(storageKey, JSON.stringify(envelope));
    expect(loadWeeklyPlanningStableV5PersistedSession(scope)).toBeNull();
    expect(storage.storage.getItem(storageKey)).toBeNull();
  });

  it.each(malformedIntakes)('rejects %s through the compatibility reader', (_name, intakeState) => {
    const decoded = decodeWeeklyPlanningStatePayload({ version: 2, state: { ...state(), intakeState } }, WEEK);
    expect(decoded.revision).toBe(0);
    expect(decoded.intakeState).toBeUndefined();
  });

  it('preserves a valid intake through both versioned readers and the unversioned legacy reader', () => {
    const planningState = state();
    expect(saveWeeklyPlanningStableV5PersistedSession({ ...scope, graph: createEmptyWeeklyPlanningFactGraphV5(), planningState })).toBe(true);
    expect(loadWeeklyPlanningStableV5PersistedSession(scope)?.planningState.intakeState).toEqual(planningState.intakeState);
    expect(decodeWeeklyPlanningStatePayload({ version: 2, state: planningState }, WEEK).intakeState).toEqual(planningState.intakeState);
    expect(decodeWeeklyPlanningStatePayload(planningState, WEEK).intakeState).toEqual(planningState.intakeState);
  });

  it('round-trips current Stable extensions, fractional proposal minutes and historical grounding decisions', () => {
    const planningState = { ...state(), intakeState: stableIntake() };
    expect(saveWeeklyPlanningStableV5PersistedSession({ ...scope, graph: createEmptyWeeklyPlanningFactGraphV5(), planningState })).toBe(true);
    const restored = loadWeeklyPlanningStableV5PersistedSession(scope);
    expect(restored?.planningState.intakeState).toEqual(planningState.intakeState);
    expect(validateWeeklyPlanningStableV5SessionSnapshot(restored, OWNER)?.planningState.intakeState).toEqual(planningState.intakeState);
  });

  it.each(malformedExtensions)('rejects %s without partially restoring or overwriting a valid checkpoint', (_name, mutate) => {
    const planningState = { ...state(), intakeState: stableIntake() };
    expect(saveWeeklyPlanningStableV5PersistedSession({ ...scope, graph: createEmptyWeeklyPlanningFactGraphV5(), planningState })).toBe(true);
    const previousRaw = storage.storage.getItem(storageKey)!;
    const envelope = JSON.parse(previousRaw);
    mutate(envelope.planningState.intakeState);
    expect(saveWeeklyPlanningStableV5PersistedSession({ ...scope, graph: envelope.graph, planningState: envelope.planningState })).toBe(false);
    expect(storage.storage.getItem(storageKey)).toBe(previousRaw);
    expect(validateWeeklyPlanningStableV5SessionSnapshot(envelope, OWNER)).toBeNull();
    storage.storage.setItem(storageKey, JSON.stringify(envelope));
    expect(loadWeeklyPlanningStableV5PersistedSession(scope)).toBeNull();
    expect(storage.storage.getItem(storageKey)).toBeNull();
  });

  it('keeps the compatibility envelope restricted to its existing wire format', () => {
    // Stable-only records require the graph/session envelope; this change does not migrate compat V2.
    expect(decodeWeeklyPlanningStatePayload({ version: 2, state: { ...state(), intakeState: stableIntake() } }, WEEK).revision).toBe(0);
  });

});
