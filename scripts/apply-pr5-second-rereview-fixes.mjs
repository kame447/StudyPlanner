import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(path, before, after) {
  const content = read(path);
  const index = content.indexOf(before);
  if (index < 0) {
    throw new Error(`Replacement target not found: ${path}\n${before.slice(0, 160)}`);
  }
  if (content.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Replacement target is not unique: ${path}`);
  }
  write(path, content.slice(0, index) + after + content.slice(index + before.length));
}

function insertBeforeLast(path, marker, insertion) {
  const content = read(path);
  const index = content.lastIndexOf(marker);
  if (index < 0) throw new Error(`Final marker not found: ${path}`);
  write(path, content.slice(0, index) + insertion + content.slice(index));
}

const storagePath = 'src/features/weeklyPlanning/weeklyPlanningStorage.ts';
replaceOnce(
  storagePath,
  `function isDraftBlock(value: unknown): value is WeeklyPlanDraftBlock {`,
  `function isBehaviorAwarePreviewMetadata(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'conversationId', 'stateRevision', 'sourceFactRefs', 'usedAssumptionProposalRefs',
      'acceptedAssumptionDependencies', 'taskRef', 'opportunityTags', 'reasoningKey',
    ])) {
    return false;
  }
  return isOptionalString(value.conversationId)
    && isNonNegativeInteger(value.stateRevision)
    && isStringArray(value.sourceFactRefs)
    && isStringArray(value.usedAssumptionProposalRefs)
    && (value.acceptedAssumptionDependencies === undefined
      || (Array.isArray(value.acceptedAssumptionDependencies)
        && value.acceptedAssumptionDependencies.every(isAssumptionDependency)))
    && typeof value.taskRef === 'string'
    && isStringArray(value.opportunityTags)
    && (value.reasoningKey === 'explicit-duration'
      || value.reasoningKey === 'explicit-unit-rate'
      || value.reasoningKey === 'accepted-assumption-duration');
}

function isDraftBlock(value: unknown): value is WeeklyPlanDraftBlock {`,
);
replaceOnce(
  storagePath,
  `    && value.approvalStatus === 'unapproved'
    && typeof value.workItemKey === 'string'
    && (value.behaviorMetadata === undefined || isBehaviorMetadata(value.behaviorMetadata));`,
  `    && value.approvalStatus === 'unapproved'
    && typeof value.workItemKey === 'string'
    && (value.behaviorMetadata === undefined
      || isBehaviorAwarePreviewMetadata(value.behaviorMetadata));`,
);

const scopePath = 'src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts';
replaceOnce(
  scopePath,
  `  if (/夏休み/.test(normalizedText)) {
    return {
      type: 'set_pending_planning_range',
      pending: {
        scope: { kind: 'named_future_period', label: '夏休み' },
        sourceText: text,
      },
      sourceText: text,
      confidence: 'high',
    };
  }`,
  `  if (/夏休み/.test(normalizedText)) {
    const durationDays = hasOneWeekDuration(normalizedText) ? 7 : undefined;
    return {
      type: 'set_pending_planning_range',
      pending: {
        scope: { kind: 'named_future_period', label: '夏休み' },
        ...(durationDays ? { durationDays } : {}),
        sourceText: text,
      },
      sourceText: text,
      confidence: 'high',
    };
  }`,
);
replaceOnce(
  scopePath,
  `  if (pending) {
    if (!pending.durationDays) return undefined;
    const weekdayIndex = parseWeekdayStart(normalizedText);
    const startDate = weekdayIndex === undefined
      ? parseExplicitDate(normalizedText, context)
      : resolveWeekdayInScope(weekdayIndex, pending.scope);
    return startDate
      ? rangeFromStartDate({
          startDate,
          durationDays: pending.durationDays,
          sourceText: text,
        })
      : undefined;
  }`,
  `  if (pending) {
    const durationDays = hasOneWeekDuration(normalizedText) ? 7 : pending.durationDays;
    const explicitDate = parseExplicitDate(normalizedText, context);
    const weekdayIndex = parseWeekdayStart(normalizedText);
    const startDate = explicitDate ?? (weekdayIndex === undefined
      ? undefined
      : resolveWeekdayInScope(weekdayIndex, pending.scope));
    return startDate && durationDays
      ? rangeFromStartDate({
          startDate,
          durationDays,
          sourceText: text,
        })
      : undefined;
  }`,
);

const validatorPath = 'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts';
replaceOnce(
  validatorPath,
  `    if (command.type === 'set_planning_range' && summary.pendingPlanningRange) {
      if (command.range.confidence !== 'explicit') {
        addRejected(result, candidate, 'pending-range-clarification');
        return;
      }

      const pendingStartDate = summary.pendingPlanningRange.startDate;
      const pendingEndDate = summary.pendingPlanningRange.endDate;
      const rangeStartDate = command.range.startDateTime?.slice(0, 10);
      const isWithinPendingWindow = Boolean(
        pendingStartDate
        && pendingEndDate
        && rangeStartDate
        && rangeStartDate >= pendingStartDate
        && rangeStartDate <= pendingEndDate,
      );

      if (!isWithinPendingWindow) {
        result.acceptedWithConfirmation.push(command);
        return;
      }
    }`,
  `    if (command.type === 'set_planning_range' && summary.pendingPlanningRange) {
      const rangeStartDate = command.range.startDateTime?.slice(0, 10);
      const rangeEndDate = command.range.endDateTime?.slice(0, 10);
      if (command.range.confidence !== 'explicit' || !rangeStartDate || !rangeEndDate) {
        addRejected(result, candidate, 'pending-range-clarification');
        return;
      }

      const pendingStartDate = summary.pendingPlanningRange.startDate;
      const pendingEndDate = summary.pendingPlanningRange.endDate;
      if (pendingStartDate && pendingEndDate) {
        const isWithinPendingWindow = rangeStartDate >= pendingStartDate
          && rangeStartDate <= pendingEndDate;
        if (!isWithinPendingWindow) {
          result.acceptedWithConfirmation.push(command);
          return;
        }
      }
    }`,
);

const contractTestPath = 'src/features/weeklyPlanning/intake/weeklyPlanningPendingRangeCommandContract.test.ts';
replaceOnce(
  contractTestPath,
  `import type { SetPendingPlanningRangeCommand } from './weeklyPlanningCommandTypes';`,
  `import type { SetPendingPlanningRangeCommand } from './weeklyPlanningCommandTypes';
import {
  parseSetPendingPlanningRangeCommand,
  parseSetPlanningRangeCommand,
} from './weeklyPlanningScopeParsing';`,
);
insertBeforeLast(
  contractTestPath,
  `});`,
  `
  it('keeps the one-week duration from a named future period and resolves a later date', () => {
    const context = {
      selectedDate: '2026-07-16',
      currentDateTime: '2026-07-16T12:00:00',
    };
    const pending = parseSetPendingPlanningRangeCommand(
      '夏休みの一週間で計画を立てたい',
      context,
    );
    expect(pending?.pending).toMatchObject({
      scope: { kind: 'named_future_period', label: '夏休み' },
      durationDays: 7,
    });

    const resolved = parseSetPlanningRangeCommand(
      '8月1日から',
      context,
      pending?.pending,
    );
    expect(resolved?.range).toMatchObject({
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      calendarDayCount: 7,
      confidence: 'explicit',
    });
  });

  it('uses a date and duration supplied together to resolve an unresolved named future period', () => {
    const resolved = parseSetPlanningRangeCommand(
      '8月1日から一週間',
      { selectedDate: '2026-07-16', currentDateTime: '2026-07-16T12:00:00' },
      {
        scope: { kind: 'named_future_period', label: '夏休み' },
        sourceText: '夏休みに計画を立てたい',
      },
    );
    expect(resolved?.range).toMatchObject({
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      calendarDayCount: 7,
    });
  });
`,
);

const pipelineTestPath = 'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts';
replaceOnce(
  pipelineTestPath,
  `  it('keeps named future periods unresolved until an explicit range is supplied', async () => {
    const pending = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'summer break plan',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([
        pendingRangeCandidate({
          scope: { kind: 'named_future_period', label: 'summer break' },
          sourceText: 'summer break plan',
        }),
      ]),
    });

    expect(pending.state.pendingPlanningRange?.scope.startDate).toBeUndefined();
    expect(pending.state.pendingPlanningRange?.scope.endDate).toBeUndefined();

    const unresolved = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: pending.state,
      userText: 'August 1',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([
        planningRangeCandidate('explicit'),
      ]),
    });

    expect(unresolved.interpreterDiagnostics?.acceptedWithConfirmation).toEqual([
      expect.objectContaining({ type: 'set_planning_range' }),
    ]);
    expect(unresolved.state.range).toBeUndefined();
    expect(unresolved.state.pendingPlanningRange).toBeDefined();
  });`,
  `  it('resolves a named future period when the provider supplies a complete explicit range', async () => {
    const pending = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      userText: 'summer break plan',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([
        pendingRangeCandidate({
          scope: { kind: 'named_future_period', label: 'summer break' },
          sourceText: 'summer break plan',
        }),
      ]),
    });

    expect(pending.state.pendingPlanningRange?.scope.startDate).toBeUndefined();
    expect(pending.state.pendingPlanningRange?.scope.endDate).toBeUndefined();

    const resolved = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultPipelineInput,
      previousState: pending.state,
      userText: 'August 1 for one week',
      planningStartDate: '2026-07-10',
      currentDateTime: '2026-07-10T15:30:00',
      interpreter: fakeInterpreter([{
        command: {
          type: 'set_planning_range',
          range: {
            startDateTime: '2026-08-01T00:00:00',
            endDateTime: '2026-08-07T24:00:00',
            sourceText: 'August 1 for one week',
            calendarDayCount: 7,
            confidence: 'explicit',
          },
          sourceText: 'August 1 for one week',
          confidence: 'high',
        },
        origin: 'ai_interpreter',
        needsConfirmation: false,
      }]),
    });

    expect(resolved.interpreterDiagnostics?.acceptedWithConfirmation).toEqual([]);
    expect(resolved.interpreterDiagnostics?.accepted).toEqual([
      expect.objectContaining({ type: 'set_planning_range' }),
    ]);
    expect(resolved.state.pendingPlanningRange).toBeUndefined();
    expect(resolved.state.range).toMatchObject({
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      calendarDayCount: 7,
    });
  });`,
);

const storageTestPath = 'src/features/weeklyPlanning/weeklyPlanningStorageValidation.test.ts';
replaceOnce(
  storageTestPath,
  `import type { WeeklyPlanDraftBlock } from './types';`,
  `import type { BehaviorAwarePreviewMetadata } from './planning/weeklyPlanningBehaviorAwarePreviewBridge';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanDraftBlock } from './types';`,
);
replaceOnce(
  storageTestPath,
  `function storeV2(state: unknown): void {`,
  `function behaviorAwarePreviewCandidate(): WeeklyDraftCandidate & {
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
      opportunityTags: ['available_evening'],
      reasoningKey: 'explicit-duration',
    },
  };
}

function storeV2(state: unknown): void {`,
);
insertBeforeLast(
  storageTestPath,
  `  it('restores a named future period whose duration is still unresolved', () => {`,
  `  it('round-trips a valid behavior-aware preview with its conversation and intake state', () => {
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

`,
);
replaceOnce(
  storageTestPath,
  `      pendingTurn: {
        requestId: 'stale-request',
        weekStartDate: WEEK_START,
        baseRevision: 1,
        startedAt: NOW,
      },
    };`,
  `      pendingTurn: {
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
    };`,
);

const lifecyclePath = 'src/features/weeklyPlanning/weeklyPlanningPreviewSessionLifecycle.test.tsx';
write(lifecyclePath, `import {
  createRef,
  forwardRef,
  useImperativeHandle,
  useState,
} from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NaturalLanguageAssistant } from '../../components/NaturalLanguageAssistant';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { BehaviorAwarePreviewMetadata } from './planning/weeklyPlanningBehaviorAwarePreviewBridge';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type {
  PlanningState,
  WeeklyPlanningPendingTurn,
} from './types';
import { useWeeklyPlanningState } from './useWeeklyPlanningState';

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
  value: { localStorage: localStorageMock, sessionStorage: localStorageMock },
});

const NOW = '2026-07-16T00:00:00.000Z';
const SELECTED_DATE = '2026-07-16';
const WEEK_START = '2026-07-13';
const USER_ID = 'user-1';

type BehaviorAwareCandidate = WeeklyDraftCandidate & {
  behaviorMetadata: BehaviorAwarePreviewMetadata;
};

function previewCandidate(): BehaviorAwareCandidate {
  return {
    stableKey: 'preview-report-1',
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
      stateRevision: 2,
      sourceFactRefs: ['task:report'],
      usedAssumptionProposalRefs: [],
      taskRef: 'task:report',
      opportunityTags: ['available_evening'],
      reasoningKey: 'explicit-duration',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

interface TurnResult {
  state: PlanningIntakeState;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
}

interface SessionOwnerHandle {
  submit(text: string): Promise<void>;
  setModalOpen(open: boolean): void;
  getState(): PlanningState;
}

const SessionOwnerHarness = forwardRef<SessionOwnerHandle, {
  turnResult: Promise<TurnResult>;
}>(function SessionOwnerHarness({ turnResult }, ref) {
  const [modalOpen, setModalOpen] = useState(true);
  const {
    planningState,
    dispatchPlanningAction,
    getPlanningState,
  } = useWeeklyPlanningState(USER_ID, SELECTED_DATE);

  async function submit(text: string): Promise<void> {
    const snapshot = getPlanningState();
    const pending: WeeklyPlanningPendingTurn = {
      requestId: 'turn-1',
      weekStartDate: snapshot.weekStartDate,
      baseRevision: snapshot.revision,
      startedAt: NOW,
    };
    const begun = dispatchPlanningAction({
      type: 'begin_turn',
      pending,
      userMessage: {
        id: 'user-1',
        role: 'user',
        content: text,
        createdAt: NOW,
      },
    });
    if (begun.pendingTurn?.requestId !== pending.requestId) return;

    const result = await turnResult;
    dispatchPlanningAction({
      type: 'commit_turn',
      pending,
      intakeState: result.state,
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: result.message,
        createdAt: NOW,
      },
      draftCandidates: result.draftCandidates,
    });
  }

  useImperativeHandle(ref, () => ({
    submit,
    setModalOpen,
    getState: getPlanningState,
  }));

  if (!modalOpen) return null;

  return (
    <NaturalLanguageAssistant
      selectedDate={SELECTED_DATE}
      userId={USER_ID}
      plans={[]}
      onApplyDraft={vi.fn(async () => undefined)}
      weeklyDraftBlocks={planningState.draftBlocks}
      weeklyPlanningPreviewCandidates={planningState.previewCandidates}
      weeklyPlanningMessages={planningState.messages}
      weeklyPlanningIntakeState={planningState.intakeState ?? null}
      weeklyPlanningWeekStartDate={planningState.weekStartDate}
      weeklyPlanningRevision={planningState.revision}
      weeklyPlanningPendingTurn={planningState.pendingTurn}
      weeklyPlanningPendingApproval={planningState.pendingApproval}
      onSubmitWeeklyPlanningTurn={async (text) => {
        await submit(text);
        const latest = getPlanningState();
        return {
          accepted: latest.pendingTurn === undefined,
          draftCandidates: latest.previewCandidates ?? [],
        };
      }}
      onAppendWeeklyPlanningMessage={(message) => {
        dispatchPlanningAction({ type: 'append_message', message });
      }}
      onResetWeeklyPlanningSession={() => {
        dispatchPlanningAction({ type: 'reset_session' });
      }}
      onCreateWeeklyDraftBlocks={(blocks) => {
        dispatchPlanningAction({ type: 'add_draft_blocks', blocks });
      }}
      onRemoveWeeklyPlanningPreviewCandidate={(candidateId) => {
        dispatchPlanningAction({ type: 'remove_preview_candidate', candidateId });
      }}
      onClearWeeklyDraftBlocks={() => {
        dispatchPlanningAction({ type: 'clear_draft_blocks' });
      }}
      embedded
    />
  );
});

describe('weekly planning preview session lifecycle', () => {
  beforeEach(() => storedValues.clear());

  it('commits an App-owned Promise result while the modal child is unmounted and restores it on remount', async () => {
    const turn = deferred<TurnResult>();
    const ownerRef = createRef<SessionOwnerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <SessionOwnerHarness ref={ownerRef} turnResult={turn.promise} />,
      );
    });

    let submission!: Promise<void>;
    await act(async () => {
      submission = ownerRef.current!.submit('レポートを1時間進めたい');
      await Promise.resolve();
    });
    expect(ownerRef.current!.getState().pendingTurn).toBeDefined();

    act(() => ownerRef.current!.setModalOpen(false));
    expect(renderer.toJSON()).toBeNull();

    await act(async () => {
      turn.resolve({
        state: {
          ...createInitialPlanningIntakeState(),
          sourceTurns: ['レポートを1時間進めたい'],
        },
        message: '仮予定を作成しました。',
        draftCandidates: [previewCandidate()],
      });
      await submission;
    });

    expect(ownerRef.current!.getState().pendingTurn).toBeUndefined();
    expect(ownerRef.current!.getState().previewCandidates).toEqual([previewCandidate()]);

    act(() => ownerRef.current!.setModalOpen(true));
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('レポート作成');
    expect(rendered).toContain('この内容で仮予定にする');

    act(() => renderer.unmount());
  });
});
`);

console.log('Applied PR #5 second re-review fixes.');
