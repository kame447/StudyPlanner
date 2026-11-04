import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { parseWeeklyPlanningVNextSessionCheckpoint, serializeWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
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
const reading = (delta: VNextTurnDelta, planningIntent: 'discuss' | 'unknown' = 'unknown'): WeeklyPlanningVNextInterpretation => ({
  status: 'interpreted', planningIntent, delta, answer: null,
  metrics: { calls: 1, repairs: 0, latencyMs: 1 },
});

// f27b3a66's Worker checkpoint parser requires exactly these four vnext keys.
function oldWorkerAcceptsCheckpoint(raw: string): boolean {
  const checkpoint: unknown = JSON.parse(raw);
  if (typeof checkpoint !== 'object' || checkpoint === null || !('vnext' in checkpoint)) return false;
  const vnext = checkpoint.vnext;
  if (typeof vnext !== 'object' || vnext === null || Array.isArray(vnext)) return false;
  const expected = ['state', 'presentedQuestion', 'preview', 'messages'];
  const actual = Object.keys(vnext);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

describe('Stage A scenario 3: repeated unanswered question (scripted, offline)', () => {
  it('lets the next utterance reach an old Worker after a repeated question', () => {
    const raw = serializeWeeklyPlanningVNextSessionCheckpoint({
      ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId,
      vnext: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [],
        unansweredQuestionStreak: { questionKey: 'unanswered-question', graphRevision: 0, count: 1 } },
      savedAt: '2026-11-02T09:00:00.000Z',
    })!;
    expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId: scope.ownerId,
      weekStartDate: scope.weekStartDate })).not.toBeNull();
    expect(oldWorkerAcceptsCheckpoint(raw)).toBe(true);
  });

  it('changes the visible method on the third short non-answer while retaining the unsaved facts', async () => {
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

    scripts.push(reading({ ...empty, defer: [{ questionKey: asked.question!.key, allocation: 'provisional_timebox' }] }));
    const provisional = await turn('仮置きで予定を見る');
    expect(provisional.outcome).toBe('applied');
    expect(JSON.parse(raw!).vnext.state.deferrals).toContainEqual(expect.objectContaining({
      questionKey: asked.question!.key, allocation: 'provisional_timebox',
    }));
    expect(provisional.preview).not.toBeNull();
    expect(JSON.parse(raw!).vnext.unansweredQuestionStreak).toBeUndefined();
    expect(saveCalls).toBe(0);
  });
});
