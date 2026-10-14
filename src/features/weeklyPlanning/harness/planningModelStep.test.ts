import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningTurnExecutionInput } from '../weeklyPlanningTurnExecutionTypes';
import type { WeeklyPlanningStableV5DialogueRenderInput } from '../dialogue/weeklyPlanningStableV5DialogueContracts';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../dialogue/weeklyPlanningStableV5AiDialogueRendererCore';
import { capturePlanningTurnContext } from './planningContextSnapshot';
import { PlanningModelStep } from './planningModelStep';
import { utf8ByteLength } from './codexUtf8Budget';

function input(): WeeklyPlanningTurnExecutionInput {
  return {
    userId: 'alice', conversationId: 'conversation', traceRequestId: 'request-1',
    userText: '今日の予定を相談したい', selectedDate: '2026-10-15',
    messages: [{ id: 'm1', role: 'user', content: '今日は研究を入れない', createdAt: '2026-10-15' }],
    plans: [{ id: 'p', seriesId: 'p', userId: 'alice', title: 'ゼミ', subject: '', date: '2026-10-15',
      startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null, excludedDates: [],
      recurrenceRules: [], type: 'other', memo: '', createdAt: '', updatedAt: '' }],
    scheduleTemplates: [],
  };
}

function renderInput(): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'action-1', currentUserMessage: '今日の予定を考えたい', recentConversation: [],
    planningInformation: { availabilityDeclarations: [{ startTime: '09:00', endTime: '12:00' }] },
    actionKind: 'question', questionCode: 'missing_schedulable_work', requiredLabels: [],
    fallbackText: '返信を作れませんでした。', previewCount: 0,
  };
}

function reply(text: string): string {
  return JSON.stringify({ actionId: 'action-1', actionKind: 'question',
    questionCode: 'missing_schedulable_work', groundingAcknowledgement: null, text });
}

describe('Codex-style turn / sampling snapshot boundary', () => {
  it('captures data without freezing caller objects or freezing live cancellation authority', () => {
    let current = true;
    const source = { ...input(), isCurrentTurn: () => current };
    const captured = capturePlanningTurnContext(source);
    source.userId = 'bob'; source.selectedDate = '2026-10-16';
    source.plans[0].title = 'new data'; source.messages[0].content = 'changed history';
    expect(captured.userId).toBe('alice');
    expect(captured.selectedDate).toBe('2026-10-15');
    expect(captured.plans[0].title).toBe('ゼミ');
    expect(captured.messages[0].content).toBe('今日は研究を入れない');
    expect(() => { captured.plans[0].title = 'illegal mutation'; }).toThrow();
    expect(captured.isCurrentTurn).toBe(source.isCurrentTurn);
    current = false;
    expect(captured.isCurrentTurn?.()).toBe(false);
  });

  it('keeps the exact captured prompt across transport mutation and a repair attempt', () => {
    const source = { label: '研究', decision: { actionId: 'a' } };
    const step = new PlanningModelStep(source);
    const prompt = step.prompt(value => [{ role: 'user', content: JSON.stringify(value) }]);
    source.label = '変更'; source.decision.actionId = 'b';
    const sent = prompt.messages();
    sent[0].content = 'transport mutation';
    const retry = prompt.withMessage({ role: 'user', content: 'repair wording, not the decision' });
    expect(JSON.parse(retry.messages()[0].content)).toEqual({ label: '研究', decision: { actionId: 'a' } });
    expect(prompt.messages()).toHaveLength(1);
    expect(retry.messages()).toHaveLength(2);
    expect(prompt.requestBytes).toBe(utf8ByteLength(JSON.stringify(prompt.messages())));
    expect(step.input).toEqual({ label: '研究', decision: { actionId: 'a' } });
  });

  it('uses captured renderer identity and time evidence after the caller changes mid-request', async () => {
    const source = renderInput();
    let finish!: (value: string) => void;
    const renderer = createWeeklyPlanningStableV5DialogueRendererCore({
      createChatCompletion: () => new Promise<string>(resolve => { finish = resolve; }),
    });
    const pending = renderer.render(source);
    source.actionId = 'different-action';
    source.planningInformation!.availabilityDeclarations = [{ startTime: '10:00' }];
    finish(reply('9:00以外には何を進めたいですか？'));
    await expect(pending).resolves.toMatchObject({ status: 'rendered' });
  });

  it('does not let a late context change legalize an unsupported model claim', async () => {
    const source = renderInput();
    let finish!: (value: string) => void;
    const renderer = createWeeklyPlanningStableV5DialogueRendererCore({
      createChatCompletion: () => new Promise<string>(resolve => { finish = resolve; }),
    });
    const pending = renderer.render(source);
    source.planningInformation!.availabilityDeclarations = [{ startTime: '10:00' }];
    finish(reply('10:00以外には何を進めたいですか？'));
    await expect(pending).resolves.toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
});
