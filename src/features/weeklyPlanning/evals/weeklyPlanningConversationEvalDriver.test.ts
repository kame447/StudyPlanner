import { describe, expect, it } from 'vitest';
import {
  conversationEvalProgressSignature,
  driveConversationUntilPreview,
  renderConversationEvalTranscript,
  type ConversationEvalAdapter,
  type ConversationEvalStateSnapshot,
  type ConversationEvalSubmissionSnapshot,
} from './weeklyPlanningConversationEvalDriver';

function state(params: {
  code?: string | null;
  targetFactId?: string | null;
  actionId?: string | null;
  graphRevision: number;
  previewCount?: number;
}): ConversationEvalStateSnapshot {
  return {
    machineQuestion: {
      code: params.code ?? null,
      targetFactId: params.targetFactId ?? null,
      actionId: params.actionId ?? null,
    },
    graphRevision: params.graphRevision,
    previewCount: params.previewCount ?? 0,
  };
}

class FakeAdapter implements ConversationEvalAdapter {
  private current: ConversationEvalStateSnapshot;
  readonly submitted: Array<{ userText: string; label: string }> = [];

  constructor(
    initial: ConversationEvalStateSnapshot,
    private readonly transition: (
      current: ConversationEvalStateSnapshot,
      userText: string,
      label: string,
      turnIndex: number,
    ) => ConversationEvalStateSnapshot,
  ) {
    this.current = initial;
  }

  snapshot(): ConversationEvalStateSnapshot {
    return structuredClone(this.current);
  }

  async submit(
    userText: string,
    label: string,
  ): Promise<ConversationEvalSubmissionSnapshot> {
    this.submitted.push({ userText, label });
    const turnIndex = this.submitted.length;
    this.current = this.transition(this.current, userText, label, turnIndex);
    return {
      ...structuredClone(this.current),
      accepted: true,
      turnIndex,
      label,
      userText,
      assistantText: `assistant-${turnIndex}`,
      failureCode: null,
    };
  }
}

describe('weekly planning conversation eval driver', () => {
  it('answers machine questions and authorizes preview without reading assistant text', async () => {
    const adapter = new FakeAdapter(
      state({
        code: 'missing_schedulable_work',
        targetFactId: 'task-target',
        actionId: 'action-1',
        graphRevision: 1,
      }),
      (_current, _userText, label, turnIndex) => {
        if (turnIndex === 1) {
          expect(label).toBe('answer:missing_schedulable_work');
          return state({
            code: 'missing_effort_estimate',
            targetFactId: 'workload-target',
            actionId: 'action-2',
            graphRevision: 2,
          });
        }
        if (turnIndex === 2) {
          expect(label).toBe('answer:missing_effort_estimate');
          return state({ graphRevision: 3 });
        }
        expect(label).toBe('authorize-preview');
        return state({ graphRevision: 4, previewCount: 2 });
      },
    );

    const result = await driveConversationUntilPreview(adapter, {
      authorizationText: 'この条件で予定を作って',
      answerQuestion({ question }) {
        if (question.code === 'missing_schedulable_work') {
          return '英語を2時間やりたいです';
        }
        if (question.code === 'missing_effort_estimate') {
          return '合計2時間です';
        }
        throw new Error(`Unexpected question: ${question.code}`);
      },
    });

    expect(result.finalState.previewCount).toBe(2);
    expect(result.authorizationSent).toBe(true);
    expect(adapter.submitted).toEqual([
      {
        userText: '英語を2時間やりたいです',
        label: 'answer:missing_schedulable_work',
      },
      {
        userText: '合計2時間です',
        label: 'answer:missing_effort_estimate',
      },
      {
        userText: 'この条件で予定を作って',
        label: 'authorize-preview',
      },
    ]);
  });

  it('stops when the same machine state repeats without progress', async () => {
    const unchanged = state({
      code: 'missing_effort_estimate',
      targetFactId: 'workload-target',
      actionId: 'action-1',
      graphRevision: 3,
    });
    const adapter = new FakeAdapter(unchanged, () => unchanged);

    await expect(driveConversationUntilPreview(adapter, {
      authorizationText: 'この条件で予定を作って',
      answerQuestion: () => '3時間です',
    })).rejects.toThrow('Conversation made no progress');
    expect(adapter.submitted).toHaveLength(1);
  });

  it('stops when only revision advances while the same answer is repeated', async () => {
    const adapter = new FakeAdapter(
      state({
        code: 'missing_effort_estimate',
        targetFactId: 'workload-target',
        actionId: 'action-1',
        graphRevision: 3,
      }),
      (current) => ({
        ...current,
        graphRevision: (current.graphRevision ?? 0) + 1,
      }),
    );

    await expect(driveConversationUntilPreview(adapter, {
      authorizationText: 'この条件で予定を作って',
      answerQuestion: () => '3ページです',
    })).rejects.toThrow('repeated the same answer for the same question target');
    expect(adapter.submitted).toHaveLength(1);
  });

  it('allows a changed repair answer for the same question target', async () => {
    const adapter = new FakeAdapter(
      state({
        code: 'missing_effort_estimate',
        targetFactId: 'workload-target',
        actionId: 'action-1',
        graphRevision: 3,
      }),
      (current, _userText, _label, turnIndex) => turnIndex === 1
        ? { ...current, graphRevision: 4 }
        : state({ graphRevision: 5, previewCount: 1 }),
    );

    const result = await driveConversationUntilPreview(adapter, {
      authorizationText: 'この条件で予定を作って',
      answerQuestion: ({ submittedTurns }) => submittedTurns.length === 0
        ? '3ページです'
        : '3時間です',
    });

    expect(result.finalState.previewCount).toBe(1);
    expect(adapter.submitted.map((turn) => turn.userText)).toEqual([
      '3ページです',
      '3時間です',
    ]);
  });

  it('includes target identity and revision in the progress signature', () => {
    const first = state({
      code: 'missing_effort_estimate',
      targetFactId: 'workload-1',
      actionId: 'action-1',
      graphRevision: 2,
    });
    const second = state({
      code: 'missing_effort_estimate',
      targetFactId: 'workload-2',
      actionId: 'action-1',
      graphRevision: 2,
    });
    expect(conversationEvalProgressSignature(first))
      .not.toBe(conversationEvalProgressSignature(second));
  });

  it('renders a human-readable transcript without an AI judge', () => {
    const transcript = renderConversationEvalTranscript({
      scenarioId: 'repair-case',
      description: '誤回答から修復する。',
      status: 'failed',
      turns: [{
        index: 1,
        label: 'intentional-wrong-unit',
        userText: '3ページです',
        assistantText: 'ページ数ではなく、所要時間を教えてください。',
        machineQuestion: {
          code: 'missing_effort_estimate',
          targetFactId: 'workload-1',
          actionId: 'action-1',
        },
        graphRevision: 3,
        previewCount: 0,
      }],
      checks: { questionTargetPreserved: true },
      failure: 'preview not created',
    });

    expect(transcript).toContain('ユーザー: 3ページです');
    expect(transcript).toContain('アプリ: ページ数ではなく');
    expect(transcript).toContain('question=missing_effort_estimate');
    expect(transcript).toContain('target=workload-1');
    expect(transcript).toContain('PASS: questionTargetPreserved');
    expect(transcript).toContain('preview not created');
  });
});
