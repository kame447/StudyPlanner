import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import { executeWeeklyPlanningTurn } from './weeklyPlanningTurnExecutor';
import type { WeeklyPlanningTurnExecutionResult } from './weeklyPlanningTurnExecutionTypes';

/*
 * Interaction architecture: when the renderer cannot produce a valid reply, the user sees the
 * short interaction emergency wording composed from the typed communication context - never
 * the routing's fixed status/preview sentences. Legacy keeps its application text.
 */

const runtimeMock = vi.hoisted(() => vi.fn());
const rendererMock = vi.hoisted(() => vi.fn());
const failureMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.test/v1', model: 'model', apiKey: 'key' }),
}));
vi.mock('./application/weeklyPlanningStableV5InstrumentedRuntimeExecutor', () => ({
  executeWeeklyPlanningStableV5RuntimeTurn: runtimeMock,
}));
vi.mock('./semantic/weeklyPlanningStableV5FailureDiagnostics', () => ({
  takeWeeklyPlanningStableV5FailureDiagnostics: failureMock,
}));
vi.mock('./trace/weeklyPlanningStableV5DebugTrace', () => ({
  recordWeeklyPlanningStableV5DebugTrace: vi.fn(),
}));
vi.mock('./dialogue/weeklyPlanningStableV5AiDialogueRenderer', () => ({
  createAiWeeklyPlanningStableV5DialogueRenderer: () => ({ render: rendererMock }),
}));

const INTERNAL_PROCESS_WORDING = /予定条件|安全に|反映していません|確認中の質問|保留中|構造化|正規化|処理|容量不足/u;

function graph() {
  const value = createEmptyWeeklyPlanningFactGraphV5();
  value.revision = 3;
  return value;
}

function questionState(code: string) {
  return {
    ...createInitialPlanningIntakeState(),
    status: 'revision_pending' as const,
    questions: ['q'],
    lastQuestionContext: { kind: 'missing' as const, targetSlot: `stable_v5:${code}`, intent: code },
  };
}

const facts = {
  statusReason: null,
  upcomingQuestionCodes: [],
  planningDetailsNotApplied: false,
  previewDisclosure: null,
};

async function run(result: Partial<WeeklyPlanningTurnExecutionResult>, architecture: 'legacy_v5' | 'interaction_v1' = 'interaction_v1') {
  runtimeMock.mockResolvedValue({
    state: createInitialPlanningIntakeState(),
    draftCandidates: [],
    stableV5Graph: graph(),
    ...result,
  });
  return executeWeeklyPlanningTurn({
    messages: [], userText: 'ok', selectedDate: '2026-10-07', userId: 'user-1',
    plans: [], scheduleTemplates: [], conversationId: 'conversation-1', traceRequestId: 'request-9',
    conversationArchitecture: architecture,
  });
}

describe('interaction emergency wording replaces routing sentences when the renderer fails', () => {
  beforeEach(() => {
    runtimeMock.mockReset(); rendererMock.mockReset(); failureMock.mockReset();
    failureMock.mockReturnValue(null);
    rendererMock.mockResolvedValue({ status: 'fallback', reason: 'invalid_json', rawResponse: 'x' });
  });

  it('ready-to-create status', async () => {
    const result = await run({
      message: '条件を整理できました。仮予定を作る場合は「この条件で予定を作って」と送ってください。',
      interactionOutcome: { kind: 'apply', consultationDeferred: false },
      communicationFacts: { ...facts, statusReason: 'ready_to_create_preview' },
    });
    expect(result.responseSource).toBe('deterministic_fallback');
    expect(result.message).not.toContain('条件を整理できました');
    expect(result.message).toContain('仮予定を作って');
    expect(result.message).not.toMatch(INTERNAL_PROCESS_WORDING);
    expect(rendererMock).toHaveBeenCalledWith(expect.objectContaining({
      communication: expect.objectContaining({ goal: 'report_status', statusReason: 'ready_to_create_preview' }),
    }));
  });

  it('unchanged preview status', async () => {
    const result = await run({
      state: { ...createInitialPlanningIntakeState(), status: 'draft_ready' },
      message: '仮予定候補は変更していません。内容を修正する場合は条件を入力してください。問題なければ下の「この内容で仮予定にする」ボタンを押してください。',
      preserveExistingPreview: true,
      interactionOutcome: { kind: 'apply', consultationDeferred: false },
      communicationFacts: { ...facts, statusReason: 'preview_unchanged' },
    });
    expect(result.message).not.toContain('変更していません');
    expect(result.message).toContain('この内容で仮予定にする');
    expect(result.message).not.toMatch(INTERNAL_PROCESS_WORDING);
  });

  it('new preview with work that did not fit', async () => {
    const result = await run({
      state: { ...createInitialPlanningIntakeState(), status: 'draft_ready' },
      message: '空き時間内で指定された優先順位に沿って2件の仮予定候補を作りました。英語の一部は容量不足のため候補に入れていません。',
      draftCandidates: [{ id: 'c1' }, { id: 'c2' }] as never,
      interactionOutcome: { kind: 'apply', consultationDeferred: false },
      communicationFacts: { ...facts, previewDisclosure: { omittedWork: [{ label: '英語', extent: 'all' }] } },
    });
    expect(result.message).toContain('2件');
    expect(result.message).toContain('英語');
    expect(result.message).toContain('この内容で仮予定にする');
    expect(result.message).not.toMatch(INTERNAL_PROCESS_WORDING);
  });

  it('a rendered preview reply is followed by the application\'s own omitted-work statement', async () => {
    const reply = '数学を中心に2件の候補を作りました。よければ下の「この内容で仮予定にする」を押してください。';
    rendererMock.mockResolvedValue({ status: 'rendered', text: reply, rawResponse: '{}' });
    for (const extent of ['all', 'part'] as const) {
      const result = await run({
        state: { ...createInitialPlanningIntakeState(), status: 'draft_ready' },
        message: '',
        draftCandidates: [{ id: 'c1' }, { id: 'c2' }] as never,
        interactionOutcome: { kind: 'apply', consultationDeferred: false },
        communicationFacts: { ...facts, previewDisclosure: { omittedWork: [{ label: '英語', extent }] } },
      });
      expect(result.responseSource).toBe('ai');
      expect(result.message.startsWith(reply)).toBe(true);
      expect(result.message.slice(reply.length)).toContain('英語');
      expect(result.message).not.toMatch(INTERNAL_PROCESS_WORDING);
    }
  });

  it('capacity shortfall question', async () => {
    const result = await run({
      state: questionState('insufficient_capacity'),
      message: '指定された期間と空き時間には、すべての作業を安全に配置できませんでした。期間を広げるか、作業量または利用できる時間を調整してください。',
      interactionOutcome: { kind: 'apply', consultationDeferred: false },
      communicationFacts: facts,
    });
    expect(result.message).not.toContain('安全に配置');
    expect(result.message).toContain('入りきりませんでした');
  });

  it('a status without a typed reason never repeats the routing sentence', async () => {
    const result = await run({
      message: '条件を整理できました。仮予定を作る場合は「この条件で予定を作って」と送ってください。',
      interactionOutcome: { kind: 'apply', consultationDeferred: false },
      communicationFacts: facts,
    });
    expect(result.responseSource).toBe('deterministic_fallback');
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).not.toContain('条件を整理できました');
    expect(result.message).not.toMatch(INTERNAL_PROCESS_WORDING);
  });

  it('aside keeps the held question out of the reply', async () => {
    const result = await run({
      state: questionState('missing_effort_estimate'),
      message: '数学は1問あたりどれくらい時間がかかりますか？',
      interactionOutcome: { kind: 'aside', consultationDeferred: false },
      communicationFacts: facts,
    });
    expect(result.message).not.toContain('1問あたり');
    expect(result.message).not.toMatch(INTERNAL_PROCESS_WORDING);
    expect(result.questionPresentationContent).toBeUndefined();
  });
});

describe('legacy keeps its application text on renderer failure', () => {
  beforeEach(() => {
    runtimeMock.mockReset(); rendererMock.mockReset(); failureMock.mockReset();
    failureMock.mockReturnValue(null);
    rendererMock.mockResolvedValue({ status: 'fallback', reason: 'invalid_json', rawResponse: 'x' });
  });

  it('shows the pre-#488 status sentence and sends no communication context', async () => {
    const message = '条件を整理できました。仮予定を作る場合は「この条件で予定を作って」と送ってください。';
    const result = await run({ message }, 'legacy_v5');
    expect(result.message).toBe(message);
    expect(rendererMock).toHaveBeenCalledWith(expect.not.objectContaining({ communication: expect.anything() }));
  });
});

describe('interaction failure turns', () => {
  const recorded = (status: 'normalization_rejected' | 'provider_failure') => ({
    status,
    attemptCount: 2,
    repairAttempted: status !== 'provider_failure',
    validationErrorCategories: [],
    canonicalizationErrorCategories: [],
    canonicalizationErrors: [],
    providerErrorCategory: status === 'provider_failure' ? 'provider_error' as const : null,
    traceCode: `fixture-${status}`,
  });

  beforeEach(() => {
    runtimeMock.mockReset(); rendererMock.mockReset(); failureMock.mockReset();
  });

  it('renders a semantic failure from its typed recovery goal', async () => {
    failureMock.mockReturnValue(recorded('normalization_rejected'));
    rendererMock.mockResolvedValue({ status: 'fallback', reason: 'invalid_json', rawResponse: 'x' });
    const result = await run({
      message: '',
      interactionOutcome: { kind: 'recover', failure: 'semantic', representedQuestion: false },
      communicationFacts: facts,
    });
    expect(rendererMock).toHaveBeenCalledWith(expect.objectContaining({
      communication: expect.objectContaining({ goal: 'clarify_turn', askQuestion: false }),
    }));
    expect(result.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.failure?.userMessage).toBe(result.message);
    expect(result.message).not.toMatch(INTERNAL_PROCESS_WORDING);
    expect(result.message).not.toMatch(/送って|送り直|言い換え/u);
  });

  it('never shows an empty or technical reply when rendering the recovery itself breaks', async () => {
    failureMock.mockReturnValue(recorded('normalization_rejected'));
    rendererMock.mockRejectedValue(new Error('renderer exploded'));
    const result = await run({
      message: '',
      interactionOutcome: { kind: 'recover', failure: 'semantic', representedQuestion: false },
      communicationFacts: facts,
    });
    expect(result.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).not.toContain('exploded');
    expect(result.message).not.toMatch(INTERNAL_PROCESS_WORDING);
  });

  it('does not call the renderer after a provider failure', async () => {
    failureMock.mockReturnValue(recorded('provider_failure'));
    const message = 'すみません、通信がうまくいかなかったようです。お手数ですが、もう一度送ってもらえますか？';
    const result = await run({
      message,
      interactionOutcome: { kind: 'recover', failure: 'provider', representedQuestion: false },
      communicationFacts: facts,
    });
    expect(rendererMock).not.toHaveBeenCalled();
    expect(result.failure?.code).toBe('stable_v5_provider_failure');
    expect(result.message).toBe(message);
    expect(result.responseSource).toBe('system');
  });
});
