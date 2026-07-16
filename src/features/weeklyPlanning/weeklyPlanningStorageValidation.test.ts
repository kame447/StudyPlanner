import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { BehaviorAwarePreviewMetadata } from './planning/weeklyPlanningBehaviorAwarePreviewBridge';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanDraftBlock } from './types';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';
import { loadWeeklyPlanningState, saveWeeklyPlanningState } from './weeklyPlanningStorage';

const storedValues = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => { storedValues.set(key, value); },
  removeItem: (key: string) => { storedValues.delete(key); },
  clear: () => { storedValues.clear(); },
  key: (index: number) => Array.from(storedValues.keys())[index] ?? null,
  get length() { return storedValues.size; },
} as Storage;

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: localStorageMock },
});

const USER_ID = 'user';
const WEEK_START = '2026-07-13';
const NOW = '2026-07-16T00:00:00.000Z';
const STORAGE_KEY = `studyplanner.weeklyPlanning.${USER_ID}.${WEEK_START}`;

function validDraftBlock(): WeeklyPlanDraftBlock {
  return {
    id: 'draft-1',
    userId: USER_ID,
    date: '2026-07-16',
    startTime: '19:00',
    endTime: '20:00',
    title: '英語ワーク',
    subject: '英語',
    type: 'study',
    label: '英語',
    source: 'ai',
    status: 'draft',
    userEdited: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function behaviorAwarePreviewCandidate(): WeeklyDraftCandidate & {
  behaviorMetadata: BehaviorAwarePreviewMetadata;
} {
  return {
    stableKey: 'behavior-preview-1',
    date: '2026-07-16',
    startTime: '19:00',
    endTime: '20:00',
    durationMinutes: 60,
    title: 'レポート作成',
    field: '情報学',
    year: 0,
    estimatedMinutes: 60,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: 'task:report',
    behaviorMetadata: {
      conversationId: 'conversation-1',
      stateRevision: 3,
      sourceFactRefs: ['task:report'],
      usedAssumptionProposalRefs: [],
      taskRef: 'task:report',
      opportunityTags: ['long_contiguous_window'],
      reasoningKey: 'explicit-duration',
    },
  };
}

function storeV2(state: unknown): void {
  storedValues.set(STORAGE_KEY, JSON.stringify({ version: 2, state }));
}

function expectRejectedSession(): void {
  const loaded = loadWeeklyPlanningState(USER_ID, WEEK_START);
  expect(loaded.revision).toBe(0);
  expect(loaded.intakeState).toBeUndefined();
  expect(loaded.draftBlocks).toEqual([]);
  expect(loaded.previewCandidates).toEqual([]);
}

describe('weekly planning storage validation', () => {
  beforeEach(() => storedValues.clear());

  it('rejects a future storage version instead of interpreting an unknown shape', () => {
    storedValues.set(STORAGE_KEY, JSON.stringify({
      version: 999,
      state: {
        weekStartDate: WEEK_START,
        revision: 20,
        mode: 'awaiting_approval',
        draftBlocks: [],
        messages: [{ role: 'unknown' }],
        updatedAt: 'future',
      },
    }));

    expectRejectedSession();
  });

  it.each([
    ['null task', { tasks: [null] }],
    ['numeric progress', { progress: [1] }],
    ['empty constraint object', { constraints: [{}] }],
    ['invalid priority union', { priorityPolicy: { kind: 'invalid' } }],
  ])('rejects malformed nested intake state: %s', (_label, patch) => {
    const state = {
      ...createInitialPlanningState(WEEK_START),
      revision: 1,
      intakeState: {
        ...createInitialPlanningIntakeState(),
        ...patch,
      },
    };
    storeV2(state);

    expectRejectedSession();
  });

  it('rejects malformed draft fields and behavior metadata as a whole session', () => {
    const baseState = createInitialPlanningState(WEEK_START);
    const baseDraft = validDraftBlock();
    const malformedDrafts = [
      { ...baseDraft, type: 'invalid' },
      { ...baseDraft, materialId: 123 },
      { ...baseDraft, behaviorMetadata: { stateRevision: 'invalid' } },
    ];

    malformedDrafts.forEach((draft) => {
      storedValues.clear();
      storeV2({
        ...baseState,
        revision: 1,
        mode: 'awaiting_approval',
        draftBlocks: [draft],
      });
      expectRejectedSession();
    });
  });

  it('rejects malformed preview candidates as a whole session', () => {
    storeV2({
      ...createInitialPlanningState(WEEK_START),
      revision: 1,
      mode: 'draft_created',
      previewCandidates: [{
        stableKey: 'candidate-1',
        date: '2026-07-16',
        startTime: '19:00',
        endTime: '20:00',
        durationMinutes: 60,
        title: '英語ワーク',
        field: '英語',
        year: 1,
        estimatedMinutes: 60,
        source: 'invalid',
        approvalStatus: 'unapproved',
        workItemKey: '英語:1',
      }],
    });

    expectRejectedSession();
  });

  it('round-trips a valid behavior-aware preview with its conversation and intake state', () => {
    const state = {
      ...createInitialPlanningState(WEEK_START),
      revision: 3,
      mode: 'draft_created' as const,
      previewCandidates: [behaviorAwarePreviewCandidate()],
      messages: [{
        id: 'message-1',
        role: 'assistant' as const,
        content: '仮予定を作成しました。',
        createdAt: NOW,
      }],
      intakeState: {
        ...createInitialPlanningIntakeState(),
        sourceTurns: ['レポートを1時間進めたい'],
      },
    };

    saveWeeklyPlanningState(USER_ID, state);
    const loaded = loadWeeklyPlanningState(USER_ID, WEEK_START);

    expect(loaded.revision).toBe(3);
    expect(loaded.messages).toEqual(state.messages);
    expect(loaded.intakeState?.sourceTurns).toEqual(['レポートを1時間進めたい']);
    expect(loaded.previewCandidates).toEqual([behaviorAwarePreviewCandidate()]);
  });

  it('restores a named future period whose duration is still unresolved', () => {
    const intakeState = {
      ...createInitialPlanningIntakeState(),
      pendingPlanningRange: {
        scope: { kind: 'named_future_period' as const, label: '夏休み' },
        sourceText: '夏休みの予定',
      },
    };
    storeV2({
      ...createInitialPlanningState(WEEK_START),
      revision: 1,
      intakeState,
    });

    const loaded = loadWeeklyPlanningState(USER_ID, WEEK_START);
    expect(loaded.revision).toBe(1);
    expect(loaded.intakeState?.pendingPlanningRange).toEqual(
      intakeState.pendingPlanningRange,
    );
  });

  it.each(['v2', 'legacy'])('removes session-local proposal records while loading %s data', (format) => {
    const intakeState = {
      ...createInitialPlanningIntakeState(),
      sourceTurns: ['保存済みturn'],
      assumptionProposalRecords: [{ proposalId: 'stale-proposal' }] as never,
    };
    const state = {
      ...createInitialPlanningState(WEEK_START),
      revision: 2,
      intakeState,
      pendingTurn: {
        requestId: 'stale-request',
        weekStartDate: WEEK_START,
        baseRevision: 1,
        startedAt: NOW,
      },
      pendingApproval: {
        requestId: 'stale-approval',
        weekStartDate: WEEK_START,
        baseRevision: 1,
        blockIds: ['draft-1'],
        startedAt: NOW,
      },
    };
    storedValues.set(
      STORAGE_KEY,
      JSON.stringify(format === 'v2' ? { version: 2, state } : state),
    );

    const loaded = loadWeeklyPlanningState(USER_ID, WEEK_START);
    expect(loaded.revision).toBe(2);
    expect(loaded.intakeState?.sourceTurns).toEqual(['保存済みturn']);
    expect(loaded.intakeState?.assumptionProposalRecords).toBeUndefined();
    expect(loaded.pendingTurn).toBeUndefined();
    expect(loaded.pendingApproval).toBeUndefined();
  });

  it('never persists in-flight request ownership', () => {
    const initial = createInitialPlanningState(WEEK_START);
    const pending = {
      requestId: 'request-1',
      weekStartDate: WEEK_START,
      baseRevision: initial.revision,
      startedAt: NOW,
    };
    const state = weeklyPlanningReducer(initial, {
      type: 'begin_turn',
      pending,
      userMessage: {
        id: 'message-1',
        role: 'user',
        content: '今週の予定を作りたい',
        createdAt: pending.startedAt,
      },
    });

    saveWeeklyPlanningState(USER_ID, state);
    const raw = storedValues.get(STORAGE_KEY);
    expect(raw).toBeDefined();
    expect(raw).not.toContain('pendingTurn');
    expect(loadWeeklyPlanningState(USER_ID, WEEK_START).pendingTurn).toBeUndefined();
  });
});
