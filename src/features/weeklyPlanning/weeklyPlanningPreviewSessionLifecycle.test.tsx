import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NaturalLanguageAssistant } from '../../components/NaturalLanguageAssistant';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
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
  value: { localStorage: localStorageMock, sessionStorage: localStorageMock },
});

const NOW = '2026-07-16T00:00:00.000Z';
const WEEK_START = '2026-07-13';

function previewCandidate(): WeeklyDraftCandidate {
  return {
    stableKey: 'preview-english-1',
    date: '2026-07-16',
    startTime: '19:00',
    endTime: '20:00',
    durationMinutes: 60,
    title: '英語ワーク',
    field: '英語',
    year: 1,
    estimatedMinutes: 60,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: '英語:1',
  };
}

describe('weekly planning preview session lifecycle', () => {
  beforeEach(() => storedValues.clear());

  it('restores a preview committed after the modal was unmounted', () => {
    const initial = createInitialPlanningState(WEEK_START);
    const pending = {
      requestId: 'turn-1',
      weekStartDate: WEEK_START,
      baseRevision: initial.revision,
      startedAt: NOW,
    };
    const begun = weeklyPlanningReducer(initial, {
      type: 'begin_turn',
      pending,
      userMessage: {
        id: 'user-1',
        role: 'user',
        content: 'この条件で作成',
        createdAt: NOW,
      },
    });

    // No component is mounted while this asynchronous result is committed.
    const committed = weeklyPlanningReducer(begun, {
      type: 'commit_turn',
      pending,
      intakeState: createInitialPlanningIntakeState(),
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: '仮予定を作成します。',
        createdAt: NOW,
      },
      draftCandidates: [previewCandidate()],
    });
    saveWeeklyPlanningState('user-1', committed);

    const reopened = loadWeeklyPlanningState('user-1', WEEK_START);
    expect(reopened.previewCandidates).toEqual([previewCandidate()]);

    const html = renderToStaticMarkup(
      <NaturalLanguageAssistant
        selectedDate="2026-07-16"
        userId="user-1"
        plans={[]}
        onApplyDraft={vi.fn(async () => undefined)}
        weeklyDraftBlocks={[]}
        weeklyPlanningPreviewCandidates={reopened.previewCandidates}
        weeklyPlanningMessages={reopened.messages}
        weeklyPlanningIntakeState={reopened.intakeState ?? null}
        weeklyPlanningWeekStartDate={reopened.weekStartDate}
        weeklyPlanningRevision={reopened.revision}
        onSubmitWeeklyPlanningTurn={vi.fn(async () => ({ accepted: true, draftCandidates: [] }))}
        onAppendWeeklyPlanningMessage={vi.fn()}
        onResetWeeklyPlanningSession={vi.fn()}
        onCreateWeeklyDraftBlocks={vi.fn()}
        onRemoveWeeklyPlanningPreviewCandidate={vi.fn()}
        embedded
      />,
    );

    expect(html).toContain('英語ワーク');
    expect(html).toContain('この内容で仮予定にする');
  });
});
