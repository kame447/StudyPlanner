import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { routeWeeklyPlanningEntryMock, generateSuggestionsMock } = vi.hoisted(() => ({
  routeWeeklyPlanningEntryMock: vi.fn(),
  generateSuggestionsMock: vi.fn(),
}));

vi.mock('../features/weeklyPlanning/entry/weeklyPlanningEntryRouter', () => ({
  routeWeeklyPlanningEntry: routeWeeklyPlanningEntryMock,
}));

vi.mock('../services/naturalLanguagePlanner', () => ({
  generateNaturalLanguageSuggestions: generateSuggestionsMock,
  getPlannerAiRuntimeInfo: () => ({
    providerLabel: 'Luna',
    fallbackLabel: 'Luna',
  }),
}));

import { NaturalLanguageAssistant } from './NaturalLanguageAssistant';

function entryTrace(decision: 'chat' | 'weekly_planning' | 'ambiguous') {
  return {
    decision,
    requestBytes: 512,
    request: {
      messages: [
        { role: 'system' as const, content: 'route by meaning' },
        { role: 'user' as const, content: '{"currentUserText":"input"}' },
      ],
      temperature: 0 as const,
      responseFormat: {
        type: 'json_schema' as const,
        json_schema: { name: 'entry_route', schema: {}, strict: true },
      },
      purpose: 'weekly_planning_interpreter' as const,
      maxCompletionTokens: 40,
    },
    responseLength: 30,
    rawResponse: `{"decision":"${decision}"}`,
  };
}

function renderAssistant() {
  const onSubmitWeeklyPlanningTurn = vi.fn(async () => ({
    accepted: true,
    draftCandidates: [],
  }));
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <NaturalLanguageAssistant
        selectedDate="2026-08-17"
        userId="user-1"
        plans={[]}
        materials={[]}
        subjects={[]}
        onApplyDraft={async () => undefined}
        weeklyDraftBlocks={[]}
        weeklyPlanningPreviewCandidates={[]}
        weeklyPlanningMessages={[]}
        weeklyPlanningIntakeState={null}
        weeklyPlanningWeekStartDate="2026-08-17"
        weeklyPlanningRevision={0}
        onSubmitWeeklyPlanningTurn={onSubmitWeeklyPlanningTurn}
        onCancelWeeklyPlanningTurn={() => true}
        onClearWeeklyPlanningConversation={() => true}
        onAppendWeeklyPlanningMessage={() => undefined}
        onResetWeeklyPlanningSession={() => undefined}
        onCreateWeeklyDraftBlocks={() => undefined}
        onRemoveWeeklyDraftBlock={() => undefined}
        onClearWeeklyDraftBlocks={() => undefined}
        onApproveWeeklyDraftBlocks={async () => undefined}
        embedded
      />,
    );
  });
  return { renderer, onSubmitWeeklyPlanningTurn };
}

function chatTextarea(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({
    placeholder: '例: 明日18時から20時で英語の勉強を追加',
  });
}

function analyzeButton(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('button').find(
    (button) => button.children.join('') === '叩き台を作る',
  );
}

describe('NaturalLanguageAssistant semantic entry routing', () => {
  beforeEach(() => {
    routeWeeklyPlanningEntryMock.mockReset();
    generateSuggestionsMock.mockReset();
    generateSuggestionsMock.mockResolvedValue([]);
  });

  it('enters Stable V5 with the original vague weekly request and trace instead of requiring a magic phrase', async () => {
    const trace = entryTrace('weekly_planning');
    routeWeeklyPlanningEntryMock.mockResolvedValue({
      decision: 'weekly_planning',
      trace,
    });
    const { renderer, onSubmitWeeklyPlanningTurn } = renderAssistant();

    act(() => chatTextarea(renderer).props.onChange({
      target: { value: '来週の勉強予定を立てたい' },
    }));
    await act(async () => {
      analyzeButton(renderer)?.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSubmitWeeklyPlanningTurn).toHaveBeenCalledWith(
      '来週の勉強予定を立てたい',
      { entryRoutingTrace: trace },
    );
    expect(generateSuggestionsMock).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({
      placeholder: '例: 来週、計算理論と英語を少しずつ進めたい',
    })).toBeDefined();
  });

  it('keeps a one-plan request in the existing chat suggestion pipeline', async () => {
    routeWeeklyPlanningEntryMock.mockResolvedValue({
      decision: 'chat',
      trace: entryTrace('chat'),
    });
    const { renderer, onSubmitWeeklyPlanningTurn } = renderAssistant();

    act(() => chatTextarea(renderer).props.onChange({
      target: { value: '来週火曜19時に英語を1時間追加して' },
    }));
    await act(async () => {
      analyzeButton(renderer)?.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(generateSuggestionsMock).toHaveBeenCalledWith(expect.objectContaining({
      text: '来週火曜19時に英語を1時間追加して',
    }));
    expect(onSubmitWeeklyPlanningTurn).not.toHaveBeenCalled();
  });

  it('makes an ambiguous route explicit without mutating either planning pipeline', async () => {
    routeWeeklyPlanningEntryMock.mockResolvedValue({
      decision: 'ambiguous',
      trace: entryTrace('ambiguous'),
    });
    const { renderer, onSubmitWeeklyPlanningTurn } = renderAssistant();

    act(() => chatTextarea(renderer).props.onChange({
      target: { value: '英語の予定を立てたい' },
    }));
    await act(async () => {
      analyzeButton(renderer)?.props.onClick();
      await Promise.resolve();
    });

    expect(renderer.root.findAllByProps({ className: 'inline-error' })[0]
      ?.children.join('')).toContain('1件の予定と週間計画のどちらにも読めます');
    expect(generateSuggestionsMock).not.toHaveBeenCalled();
    expect(onSubmitWeeklyPlanningTurn).not.toHaveBeenCalled();
  });
});
