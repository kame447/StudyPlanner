import { describe, expect, it, vi } from 'vitest';
import { bindWeeklyPlanningQuestionPresentation } from '../intake/weeklyPlanningQuestionPresentation';
import type { PlanningIntakeState, WeeklyPlanningQuestionPresentationContent } from '../intake/weeklyPlanningIntakeTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  decodeWeeklyPlanningMachineBoundEffortAnswerV5,
  formatWeeklyPlanningMachineBoundEffortAnswerV5,
  type WeeklyPlanningMachineBoundEffortAnswerV5,
} from '../semantic/weeklyPlanningMachineBoundAnswerV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import type { PlanningState, WeeklyPlanningMessage } from '../types';
import { buildMachineBoundEffortAnswerOptions } from '../ui/machineBoundEffortAnswerOptions';
import {
  resolveWeeklyPlanningMachineBoundEffortQuestionV5,
  verifyWeeklyPlanningMachineBoundEffortAnswerV5,
} from './weeklyPlanningStableV5MachineBoundAnswer';
import { executeWeeklyPlanningStableV5SemanticTurnCore } from './weeklyPlanningStableV5SemanticTurnCore';

const UNACCOMPANIED: WeeklyPlanningQuestionPresentationContent = {
  responseSource: 'ai', currentTurnGrounding: 'none', selfRepairNotice: false,
  groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false,
};
const messages: WeeklyPlanningMessage[] = [
  { id: 'c:turn:1:user', role: 'user', content: '数学20問', createdAt: '2026-10-17T00:00:00Z' },
  { id: 'c:turn:1:assistant', role: 'assistant', content: '1問あたり何分？', createdAt: '2026-10-17T00:00:01Z' },
];

function questionState(params: {
  context?: Partial<NonNullable<PlanningIntakeState['lastQuestionContext']>>;
  content?: WeeklyPlanningQuestionPresentationContent;
} = {}): PlanningIntakeState {
  return bindWeeklyPlanningQuestionPresentation({
    state: { lastQuestionContext: { kind: 'missing', targetSlot: 'stable_v5:missing_effort_estimate',
      topicId: 'work', intent: 'duration_per_unit', ...params.context } } as PlanningIntakeState,
    turnId: 'c:turn:1', assistantMessageId: 'c:turn:1:assistant', planningStateRevision: 2, graphRevision: 1,
    content: params.content ?? UNACCOMPANIED,
  });
}

function resolve(state: PlanningIntakeState, overrides: { inputStateRevision?: number; graphRevision?: number } = {}) {
  return resolveWeeklyPlanningMachineBoundEffortQuestionV5({ previousState: state, messages,
    inputStateRevision: overrides.inputStateRevision ?? 2, graphRevision: overrides.graphRevision ?? 1 });
}

function planningState(intakeState: PlanningIntakeState): PlanningState {
  return { weekStartDate: '2026-10-19', revision: 2, mode: 'conversation', draftBlocks: [], messages,
    intakeState, updatedAt: '2026-10-17T00:00:01Z' } as unknown as PlanningState;
}

const answer: WeeklyPlanningMachineBoundEffortAnswerV5 = {
  version: 1, kind: 'effort_duration', assistantMessageId: 'c:turn:1:assistant', questionActionId: null,
  targetFactId: 'work', graphRevision: 1, effortMeasurement: 'duration_per_unit', minutes: 5,
};

describe('#735 typed machine-bound effort answer contract', () => {
  it('decodes only the exact closed payload', () => {
    expect(decodeWeeklyPlanningMachineBoundEffortAnswerV5(answer)).toEqual(answer);
    expect(decodeWeeklyPlanningMachineBoundEffortAnswerV5({ ...answer, minutes: 4 })).toBeNull();
    expect(decodeWeeklyPlanningMachineBoundEffortAnswerV5({ ...answer, minutes: 30, effortMeasurement: 'session_duration' })).toBeNull();
    expect(decodeWeeklyPlanningMachineBoundEffortAnswerV5({ ...answer, extra: true })).toBeNull();
    expect(decodeWeeklyPlanningMachineBoundEffortAnswerV5({ ...answer, graphRevision: -1 })).toBeNull();
    expect(decodeWeeklyPlanningMachineBoundEffortAnswerV5({ ...answer, assistantMessageId: '' })).toBeNull();
  });

  it('formats the typed value as presentation only', () => {
    expect(formatWeeklyPlanningMachineBoundEffortAnswerV5(answer)).toBe('1つあたり約5分');
    expect(formatWeeklyPlanningMachineBoundEffortAnswerV5({ effortMeasurement: 'total_duration', minutes: 90 })).toBe('全体で約1時間30分');
    expect(formatWeeklyPlanningMachineBoundEffortAnswerV5({ effortMeasurement: 'total_duration', minutes: 120 })).toBe('全体で約2時間');
  });

  it('binds only a fresh, directly presented, single-target effort question', () => {
    expect(resolve(questionState())).toEqual({ assistantMessageId: 'c:turn:1:assistant', questionActionId: null,
      targetFactId: 'work', graphRevision: 1, effortMeasurement: 'duration_per_unit' });
    expect(resolve(questionState(), { inputStateRevision: 3 })).toBeNull();
    expect(resolve(questionState(), { graphRevision: 2 })).toBeNull();
    expect(resolve(questionState({ context: { intent: 'session_duration' } }))).toBeNull();
    expect(resolve(questionState({ context: { targetSlot: 'stable_v5:quantity_role_unresolved' } }))).toBeNull();
    expect(resolve(questionState({ context: { estimateForWorkloadFactId: 'other' } }))).toBeNull();
    expect(resolve(questionState({ context: { questionBasis: 'completed_workload_total' } }))).toBeNull();
    expect(resolve(questionState({ content: { ...UNACCOMPANIED, groundingContext: { proposed: 0, contested: 1 } } }))).toBeNull();
    expect(resolve(questionState({ content: { ...UNACCOMPANIED, previewPromotionControl: true } }))).toBeNull();
  });

  it('never offers or accepts chips for a D5/C5-captured question', () => {
    // A captured controlled-candidate (D5) or C5 question stays on its own choice route.
    // Captures are attached to the already bound presentation, as the controller does.
    const captured = (capture: Partial<NonNullable<PlanningIntakeState['lastQuestionContext']>>): PlanningIntakeState => {
      const base = questionState();
      return { ...base, lastQuestionContext: { ...base.lastQuestionContext!, ...capture } };
    };
    const controlled = captured({ controlledCandidate: { version: 1 } as never });
    expect(controlled.lastQuestionContext?.controlledCandidate).toBeDefined();
    expect(controlled.lastQuestionContext?.presentation).toBeDefined();
    expect(resolve(controlled)).toBeNull();
    expect(buildMachineBoundEffortAnswerOptions(planningState(controlled), true)).toEqual([]);
    const c5 = captured({ c5: { version: 1 } as never });
    expect(resolve(c5)).toBeNull();
    expect(buildMachineBoundEffortAnswerOptions(planningState(c5), true)).toEqual([]);
    // Control: the same question without a capture does offer chips.
    expect(buildMachineBoundEffortAnswerOptions(planningState(questionState()), true)).toHaveLength(7);
    expect(verifyWeeklyPlanningMachineBoundEffortAnswerV5({ answer, userText: '1つあたり約5分', question: resolve(controlled) })).toBeNull();
  });

  it('verifies every bound identity and exact label equality', () => {
    const question = resolve(questionState());
    const verify = (value: unknown, userText = '1つあたり約5分') =>
      verifyWeeklyPlanningMachineBoundEffortAnswerV5({ answer: value, userText, question });
    expect(verify(answer)).toEqual(answer);
    expect(verify(answer, '1問5分')).toBeNull();
    expect(verify(answer, '1つあたり約5分 ')).toBeNull();
    expect(verify({ ...answer, questionActionId: 'action' })).toBeNull();
    expect(verify({ ...answer, targetFactId: 'other' })).toBeNull();
    expect(verify({ ...answer, graphRevision: 2 })).toBeNull();
    expect(verify({ ...answer, assistantMessageId: 'old' })).toBeNull();
    expect(verify({ ...answer, effortMeasurement: 'total_duration', minutes: 30 }, '全体で約30分')).toBeNull();
    expect(verifyWeeklyPlanningMachineBoundEffortAnswerV5({ answer, userText: '1つあたり約5分', question: null })).toBeNull();
  });
});

describe('#735 semantic turn routing with a typed answer', () => {
  function graph() {
    const value = createEmptyWeeklyPlanningFactGraphV5(); value.revision = 1;
    const source = { conversationId: 'c', turnId: 'c:request:1', semanticLocalId: 'local', sourceText: '数学20問', origin: 'user' as const };
    value.tasks.push({ id: 'task', title: '数学', category: 'study', source, createdRevision: 1 });
    value.workloads.push({ id: 'work', taskId: 'task', componentId: null, amount: 20, quantityRole: 'target', unitCode: 'problem',
      unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source, createdRevision: 1 });
    value.factLifecycles = ['task', 'work'].map(factId => ({ factId, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
    return value;
  }

  async function observe(userText: string, machineBoundAnswer?: unknown) {
    let observed: WeeklyPlanningSemanticNormalizerInputV5 | undefined;
    const stop = new Error('normalizer boundary observed');
    const resolveReplyReferenceHint = vi.fn(async () => null);
    await expect(executeWeeklyPlanningStableV5SemanticTurnCore({ userId: 'owner', conversationId: 'c', traceRequestId: 'typed-routing',
      userText, previousState: questionState(), inputStateRevision: 2, selectedDate: '2026-10-19', plans: [], scheduleTemplates: [],
      messages,
      ...(machineBoundAnswer === undefined ? {} : { machineBoundAnswer: machineBoundAnswer as WeeklyPlanningMachineBoundEffortAnswerV5 }),
      requestContext: { startedAtIso: '2026-10-17T00:00:00Z', currentDate: '2026-10-17', currentTime: '09:00',
        notBeforeDate: '2026-10-17', notBeforeTime: '09:00', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
    }, { session: { ownerId: 'owner', conversationId: 'c', weekStartDate: '2026-10-19', graph: graph(), updatedAt: 0 },
      selectContext: () => [], recordFailure: () => undefined,
      normalizer: { normalize: async value => { observed = value; throw stop; } },
      resolveReplyReferenceHint,
    })).rejects.toBe(stop);
    return { observed: observed!, resolveReplyReferenceHint };
  }

  it('a bound typed answer skips the Jev reply-reference hint and reaches the normalizer verified', async () => {
    const { observed, resolveReplyReferenceHint } = await observe('1つあたり約5分', answer);
    expect(resolveReplyReferenceHint).not.toHaveBeenCalled();
    expect(observed.machineBoundAnswer).toEqual(answer);
  });

  it('free text keeps the existing reply-reference routing', async () => {
    const { observed, resolveReplyReferenceHint } = await observe('5分くらい');
    expect(resolveReplyReferenceHint).toHaveBeenCalledTimes(1);
    expect(observed.machineBoundAnswer).toBeUndefined();
  });

  it('an unbound typed answer is dropped and the turn keeps every existing AI route', async () => {
    const { observed, resolveReplyReferenceHint } = await observe('1つあたり約5分', { ...answer, assistantMessageId: 'old' });
    expect(resolveReplyReferenceHint).toHaveBeenCalledTimes(1);
    expect(observed.machineBoundAnswer).toBeUndefined();
    expect(observed.userText).toBe('1つあたり約5分');
  });
});
