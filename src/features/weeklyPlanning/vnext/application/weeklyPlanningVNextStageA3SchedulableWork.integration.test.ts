import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import {
  submitWeeklyPlanningVNextExperimentalTurn,
  readWeeklyPlanningVNextExperimentalSession,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from './weeklyPlanningVNextExperimentalSession';

// Stage A scenario 3 for a required missing_schedulable_work question: a task is known, but no
// amount, time or fixed slot. The third short non-answer must change the method (here: the
// provisional placement the provider schema already accepts for this question), not ask the
// same question a third time. Independent of the effort-estimate case in StageA3.
const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'stage-a-owner', weekStartDate: '2026-11-02', conversationId: 'stage-a-scenario-3-schedulable',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08',
    timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
  notBeforeTime: '09:00',
};
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = (delta: VNextTurnDelta, planningIntent: 'discuss' | 'unknown' = 'unknown'): WeeklyPlanningVNextInterpretation => ({
  status: 'interpreted', planningIntent, delta, answer: null,
  metrics: { calls: 1, repairs: 0, latencyMs: 1 },
});

describe('Stage A scenario 3: repeated unanswered missing_schedulable_work (scripted, offline)', () => {
  it('offers the accepted provisional placement on the third non-answer and applies it through the provider', async () => {
    const scripts = [reading({ ...empty, add: [
      { kind: 'task', localId: 'reading', category: 'study', title: '英語の音読' },
    ] }, 'discuss'), reading(empty), reading(empty), reading(empty)];
    let raw: string | null = null;
    let saveCalls = 0;
    const ports: WeeklyPlanningVNextExperimentalPorts = {
      client: {} as OpenAiCompatibleClient,
      interpret: async () => {
        const next = scripts.shift();
        if (!next) throw new Error('script exhausted');
        return next;
      },
      checkpoint: { read: () => raw, write: (value: string) => { raw = value; } },
      legacyV5Checkpoint: { read: () => null },
      approvalLedger: { read: () => null, write: () => { throw new Error('unexpected approval'); } },
      plans: {
        findExistingPlanId: async () => undefined,
        saveBlock: async () => { saveCalls += 1; throw new Error('unexpected save'); },
      },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      // Echo presentation decisions only, so an unchanged question yields an identical reply.
      createRenderer: () => ({ render: async (input) => ({ status: 'rendered', rawResponse: '',
        text: JSON.stringify({ goal: input.communication?.goal ?? null, actionKind: input.actionKind,
          questionCode: input.questionCode, questionIntent: input.questionIntent,
          requiredLabels: input.requiredLabels, previewCount: input.previewCount }) }) }),
      now: () => '2026-11-02T09:00:00.000Z',
    };
    let sequence = 0;
    const shown = () => (raw === null ? null : (JSON.parse(raw).vnext.presentedQuestion?.graphRevision ?? null));
    const turn = (userText: string, turnPorts = ports) => submitWeeklyPlanningVNextExperimentalTurn({
      scope, ports: turnPorts, turnId: `turn-${++sequence}`, userText, shownRevision: shown() });

    const asked = await turn('今週は英語の音読をやりたい');
    expect(asked.question).toMatchObject({ code: 'missing_schedulable_work' });
    expect(asked.question!.optionalInvitation).toBeUndefined();
    const retainedState = JSON.parse(raw!).vnext.state;

    const first = await turn('うーん');
    const second = await turn('わからない');
    const third = await turn('そうですね');
    expect(JSON.parse(raw!).vnext.unansweredQuestionStreak).toMatchObject({ questionKey: asked.question!.key, count: 3 });
    expect(first.question?.key).toBe(asked.question!.key);
    expect(second.question?.key).toBe(asked.question!.key);
    expect(first.reply).toBe(second.reply);
    // Past input and the unsaved state are kept; nothing is saved; another owner cannot read it.
    expect(JSON.parse(raw!).vnext.state).toEqual(retainedState);
    expect(saveCalls).toBe(0);
    expect(readWeeklyPlanningVNextExperimentalSession({ ...scope, ownerId: 'another-owner' }, ports).status).toBe('unreadable');

    // The third reply changes method instead of repeating the same presentation.
    expect(third.reply).not.toBe(second.reply);
    const provisionalChoice = '所要時間はまだ分からないので、仮置きで予定を組んで見せて';
    expect(JSON.parse(third.reply).requiredLabels).toContain(provisionalChoice);

    // Selecting that label goes through the real provider interpreter and its postvalidation.
    let providerCalls = 0;
    const providerPorts: WeeklyPlanningVNextExperimentalPorts = { ...ports,
      interpret: createWeeklyPlanningVNextProviderInterpreter(),
      client: { async createChatCompletion(request) {
        providerCalls += 1;
        const context = JSON.parse(request.messages[1].content);
        expect(context.userText).toBe(provisionalChoice);
        expect(context.presentedQuestion?.key).toBe(asked.question!.key);
        return JSON.stringify({ planningIntent: 'unknown', conversationActs: [], answer: null,
          delta: { ...empty, defer: [{ questionKey: asked.question!.key, allocation: 'provisional_timebox' }] } });
      } },
    };
    const provisional = await turn(provisionalChoice, providerPorts);
    expect(providerCalls).toBe(1);
    expect(provisional.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 1, repairs: 0 } });
    expect(provisional.outcome).toBe('applied');
    expect(JSON.parse(raw!).vnext.state.deferrals).toContainEqual(expect.objectContaining({
      questionKey: asked.question!.key, allocation: 'provisional_timebox' }));
    expect(JSON.parse(raw!).vnext.state.graph.workloads).toEqual([]);
    expect(provisional.preview).not.toBeNull();
    expect(JSON.parse(raw!).vnext.unansweredQuestionStreak).toBeUndefined();
    expect(saveCalls).toBe(0);
  });
});
