import { beforeAll, describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { parseWeeklyPlanningVNextSessionCheckpoint, serializeWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { parseWeeklyPlanningVNextSessionCheckpoint as parseOldCheckpoint } from './weeklyPlanningVNextSessionCheckpoint.f27b3a66.fixture';
import { parseWeeklyPlanningVNextSessionCheckpoint as parseExpandCheckpoint } from './weeklyPlanningVNextSessionCheckpoint.8413f709.fixture';
import {
  submitWeeklyPlanningVNextExperimentalTurn,
  readWeeklyPlanningVNextExperimentalSession,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'stage-a-owner', weekStartDate: '2026-11-02', conversationId: 'stage-a-scenario-3',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08',
    timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
  notBeforeTime: '09:00',
};
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = (delta: VNextTurnDelta, planningIntent: 'discuss' | 'unknown' | 'create_plan' = 'unknown'): WeeklyPlanningVNextInterpretation => ({
  status: 'interpreted', planningIntent, delta, answer: null,
  metrics: { calls: 1, repairs: 0, latencyMs: 1 },
});

describe('Stage A scenario 3: repeated unanswered question (scripted, offline)', () => {
  describe('expand-first checkpoint compatibility after a repeated question', () => {
    let raw: string;

    beforeAll(() => {
      raw = serializeWeeklyPlanningVNextSessionCheckpoint({
        ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId,
        vnext: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [],
          unansweredQuestionStreak: { questionKey: 'unanswered-question', graphRevision: 0, count: 1 } },
        savedAt: '2026-11-02T09:00:00.000Z',
      })!;
      expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId: scope.ownerId,
        weekStartDate: scope.weekStartDate })).not.toBeNull();
    });

    it('records that the f27b3a66 parser rejects the extended checkpoint', () => {
      expect(parseOldCheckpoint({ raw, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate })).toBeNull();
    });

    it('accepts the same checkpoint with the expand parser shared by Pages and Worker', () => {
      // Release gate: #991 must be live on both Pages and Worker before #985/#987 ship.
      expect(parseExpandCheckpoint({ raw, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate })).not.toBeNull();
    });
  });

  it.each(['provisional_timebox', 'estimate_minutes'] as const)('changes the third unanswered question and continues via %s', async continuation => {
    const scripts = [reading({ ...empty, add: [
      { kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' },
      { kind: 'workload', localId: 'total', taskRef: { localId: 'slides' }, componentRef: null,
        quantityRole: 'scope_total', amount: 20, unitCode: 'page', unitLabel: '枚',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
      { kind: 'workload', localId: 'done', taskRef: { localId: 'slides' }, componentRef: null,
        quantityRole: 'completed', amount: 12, unitCode: 'page', unitLabel: '枚',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
    ] }, 'discuss'), reading(empty), reading(empty), reading(empty)];
    let raw: string | null = null;
    let saveCalls = 0;
    const slot = { read: () => raw, write: (value: string) => { raw = value; } };
    const ports: WeeklyPlanningVNextExperimentalPorts = {
      client: {} as OpenAiCompatibleClient,
      interpret: async () => {
        const next = scripts.shift();
        if (!next) throw new Error('script exhausted');
        return next;
      },
      checkpoint: slot,
      legacyV5Checkpoint: { read: () => null },
      approvalLedger: { read: () => null, write: () => { throw new Error('unexpected approval'); } },
      plans: {
        findExistingPlanId: async () => undefined,
        saveBlock: async () => { saveCalls += 1; throw new Error('unexpected save'); },
      },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      // Echo only presentation decisions, not user text or recent conversation. An unchanged
      // question therefore yields the same visible reply; a narrowed choice or preview changes it.
      createRenderer: () => ({ render: async (input) => ({ status: 'rendered', rawResponse: '',
        text: JSON.stringify({ goal: input.communication?.goal ?? null, actionKind: input.actionKind,
          questionCode: input.questionCode, questionIntent: input.questionIntent,
          requiredLabels: input.requiredLabels, previewCount: input.previewCount }) }) }),
      now: () => '2026-11-02T09:00:00.000Z',
    };
    let sequence = 0;
    const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({ scope, ports,
      turnId: `turn-${++sequence}`, userText,
      shownRevision: raw === null ? null : (JSON.parse(raw).vnext.presentedQuestion?.graphRevision ?? null),
    });

    const asked = await turn('ゼミ資料は20枚で12枚できた');
    expect(asked.question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 8 } });
    const retainedState = JSON.parse(raw!).vnext.state;

    const first = await turn('全部');
    expect(JSON.parse(raw!).vnext.unansweredQuestionStreak).toMatchObject({
      questionKey: asked.question!.key, graphRevision: asked.graphRevision, count: 1,
    });
    scripts.unshift({ status: 'failed', reason: 'provider_error', errors: [],
      metrics: { calls: 1, repairs: 0, latencyMs: 1 } });
    expect((await turn('接続を待っています')).outcome).toBe('interpretation_failed');
    expect(JSON.parse(raw!).vnext.unansweredQuestionStreak?.count).toBe(1);
    const second = await turn('ない');
    expect(JSON.parse(raw!).vnext.unansweredQuestionStreak?.count).toBe(2);
    expect(readWeeklyPlanningVNextExperimentalSession({ ...scope, ownerId: 'another-owner' }, ports).status).toBe('unreadable');
    const reloadedPorts = { ...ports, checkpoint: { read: () => raw, write: (value: string) => { raw = value; } } };
    const third = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: reloadedPorts,
      turnId: `turn-${++sequence}`, userText: 'そういうこと',
      shownRevision: JSON.parse(raw!).vnext.presentedQuestion?.graphRevision ?? null });
    expect(JSON.parse(raw!).vnext.unansweredQuestionStreak?.count).toBe(3);
    expect(first.question?.key).toBe(asked.question?.key);
    expect(second.question?.key).toBe(asked.question?.key);
    expect(first.reply).toBe(second.reply);
    expect(JSON.parse(raw!).vnext.state).toEqual(retainedState);
    expect(saveCalls).toBe(0);
    // A retained-state tentative preview or a narrowed question is acceptable. Repeating the
    // same question and presentation for the third time is not.
    const narrowedQuestion = third.question !== null && third.reply !== second.reply
      && (third.question.key === asked.question?.key || third.question.options.length > 0);
    expect(third.preview !== null || narrowedQuestion).toBe(true);

    const shownLabels: string[] = JSON.parse(third.reply).requiredLabels;
    const provisionalChoice = '所要時間はまだ分からないので、仮置きで予定を組んで見せて';
    expect(shownLabels).toContain(provisionalChoice);
    expect(provisionalChoice).toContain('所要時間はまだ分からない');
    expect(provisionalChoice).toContain('仮置きで予定を組んで');
    const selectedAnswer = continuation === 'provisional_timebox' ? provisionalChoice : '残りは全部で80分です';
    let providerCalls = 0;
    const providerPorts: WeeklyPlanningVNextExperimentalPorts = { ...ports,
      interpret: createWeeklyPlanningVNextProviderInterpreter(),
      client: { async createChatCompletion(request) {
        providerCalls += 1;
        expect(JSON.stringify(request.responseFormat)).toContain('effort is unknown or must not become an estimate');
        expect(JSON.stringify(request.responseFormat)).toContain('provisionally placing the work anyway');
        const context = JSON.parse(request.messages[1].content);
        expect(context.userText).toBe(selectedAnswer);
        expect(context.presentedQuestion?.key).toBe(context.openQuestions[0].key);
        if (continuation === 'estimate_minutes') return JSON.stringify({ planningIntent: 'unknown', conversationActs: [],
          answer: { kind: 'estimate_minutes', optionId: null, minutes: 80, per: 'whole_work' }, delta: empty });
        return JSON.stringify({ planningIntent: 'unknown', conversationActs: [], answer: null,
          delta: { ...empty, defer: [{ questionKey: context.openQuestions[0].key,
            allocation: 'provisional_timebox' }] } });
      } },
    };
    const provisional = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: providerPorts,
      turnId: `turn-${++sequence}`, userText: selectedAnswer,
      shownRevision: JSON.parse(raw!).vnext.presentedQuestion?.graphRevision ?? null });
    expect(providerCalls).toBe(1);
    if (continuation === 'estimate_minutes') {
      expect(provisional.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 1, repairs: 0 } });
      expect(provisional.outcome).toBe('applied');
      expect(provisional.question).toBeNull();
      expect(provisional.preview).toBeNull();
      const checkpoint = JSON.parse(raw!).vnext;
      expect(checkpoint.unansweredQuestionStreak).toBeUndefined();
      expect(checkpoint.state.deferrals).toEqual([]);
      expect(checkpoint.state.graph.workloads).toEqual(retainedState.graph.workloads);
      expect(checkpoint.state.graph.effortEstimates).toEqual([expect.objectContaining({ kind: 'total_duration', minutes: 80 })]);
      const planned = await submitWeeklyPlanningVNextExperimentalTurn({ scope,
        ports: { ...ports, interpret: async () => reading(empty, 'create_plan') },
        turnId: `turn-${++sequence}`, userText: 'この条件で今週の予定を作って', shownRevision: null });
      expect(planned.preview).not.toBeNull();
      const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
      // Scheduling policy retains the stated 80-minute estimate and allocates 90 minutes
      // after the ordinary estimate margin and upward rounding (SchedulingParity).
      expect(planned.preview!.blocks.reduce((total, block) => total + clockMinutes(block.endTime) - clockMinutes(block.startTime), 0)).toBe(90);
      expect(planned.preview!.blocks.reduce((total, block) => total + block.allocationBreakdown!.estimatedMinutes, 0)).toBeCloseTo(80);
      expect(planned.preview!.blocks.every(block => block.date >= '2026-11-02' && block.date <= '2026-11-08')).toBe(true);
      expect(saveCalls).toBe(0);
      return;
    }
    expect(provisional.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 1, repairs: 0 },
      delta: { defer: [{ questionKey: asked.question!.key, allocation: 'provisional_timebox' }] } });
    expect(provisional.outcome).toBe('applied');
    expect(JSON.parse(raw!).vnext.state.deferrals).toContainEqual(expect.objectContaining({
      questionKey: asked.question!.key, allocation: 'provisional_timebox',
    }));
    expect(provisional.preview).not.toBeNull();
    expect(JSON.parse(raw!).vnext.unansweredQuestionStreak).toBeUndefined();
    expect(saveCalls).toBe(0);
  });
});
