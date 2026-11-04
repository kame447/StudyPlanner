import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanningStableV5DialogueRenderInput } from '../../dialogue/weeklyPlanningStableV5DialogueContracts';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddWorkload, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import {
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'whole-picture-owner', weekStartDate: '2026-11-02',
  conversationId: 'whole-picture-conversation', notBeforeTime: '09:00',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02',
    planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
};
const workload = (task: string, amount: number, unitCode: VNextAddWorkload['unitCode'], unitLabel: string): VNextAddWorkload => ({
  kind: 'workload', localId: `${task}-work`, taskRef: { localId: task }, componentRef: null,
  quantityRole: 'target', amount, unitCode, unitLabel, rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null,
});

describe('Stage B candidate: whole-picture renderer input (scripted, offline)', () => {
  it('supplies both accepted works and asks only for the missing math duration without saving', async () => {
    const delta: VNextTurnDelta = { add: [
      { kind: 'task', localId: 'english', category: 'study', title: '英語' },
      workload('english', 60, 'minute', '分'),
      { kind: 'task', localId: 'math', category: 'study', title: '数学プリント' },
      workload('math', 10, 'page', '枚'),
    ], patch: [], remove: [], relate: [], defer: [] };
    const reading: WeeklyPlanningVNextInterpretation = { status: 'interpreted', planningIntent: 'create_plan',
      delta, answer: null, metrics: { calls: 1, repairs: 0, latencyMs: 1 } };
    const interpret = vi.fn(async () => reading);
    const createChatCompletion = vi.fn(async () => { throw new Error('unexpected real provider call'); });
    const saveBlock = vi.fn(async () => { throw new Error('unexpected plan save'); });
    const approvalWrite = vi.fn(() => { throw new Error('unexpected approval write'); });
    const rendered: WeeklyPlanningStableV5DialogueRenderInput[] = [];
    let raw: string | null = null;
    const ports: WeeklyPlanningVNextExperimentalPorts = {
      client: { createChatCompletion } as OpenAiCompatibleClient,
      interpret,
      checkpoint: { read: () => raw, write: value => { raw = value; } },
      legacyV5Checkpoint: { read: () => null },
      approvalLedger: { read: () => null, write: approvalWrite },
      plans: { findExistingPlanId: async () => undefined, saveBlock },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      now: () => '2026-11-02T09:00:00.000Z',
      createRenderer: () => ({ render: async input => {
        rendered.push(input);
        // Observe the actual typed presentation; never recover missing facts from raw text or history.
        return { status: 'rendered', rawResponse: '', text: JSON.stringify({
          communication: input.communication, planningInformation: input.planningInformation,
          currentTurnGrounding: input.currentTurnGrounding, questionIntent: input.questionIntent,
          actionKind: input.actionKind, questionCode: input.questionCode, previewCount: input.previewCount,
        }) };
      } }),
    };
    const result = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'first-turn',
      userText: '今週は英語60分、数学プリント10枚を進めたい。予定案を作って', shownRevision: null });

    expect(result).toMatchObject({ outcome: 'applied', replySource: 'renderer', preview: null });
    expect(rendered).toHaveLength(1);
    const input = rendered[0];
    const accepted = input.currentTurnGrounding!.acceptedFacts;
    const english = accepted.find(fact => fact.kind === 'task' && fact.data.title === '英語')!;
    const math = accepted.find(fact => fact.kind === 'task' && fact.data.title === '数学プリント')!;
    expect(english).toBeDefined();
    expect(math).toBeDefined();
    const mathWork = accepted.find(fact => fact.kind === 'workload' && fact.data.taskId === math.factId)!;
    expect(mathWork).toBeDefined();
    expect(input.currentTurnGrounding!.mode).not.toBe('none');
    expect(accepted).toHaveLength(4);
    expect(accepted).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workload', data: expect.objectContaining({
        taskId: english.factId, quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分' }) }),
      expect.objectContaining({ kind: 'workload', data: expect.objectContaining({
        taskId: math.factId, quantityRole: 'target', amount: 10, unitCode: 'page', unitLabel: '枚' }) }),
    ]));
    expect(input.planningInformation).toMatchObject({
      tasks: [{ id: english.factId, title: '英語' }, { id: math.factId, title: '数学プリント' }],
      workloads: [
        { taskId: english.factId, quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分' },
        { taskId: math.factId, quantityRole: 'target', amount: 10, unitCode: 'page', unitLabel: '枚' },
      ],
      effortEstimates: [], temporalConstraints: [],
    });
    expect(input).toMatchObject({ actionKind: 'question', communication: { goal: 'ask_question', askQuestion: true },
      questionCode: 'missing_effort_estimate', questionTarget: { fact: { id: mathWork.factId, taskId: math.factId } },
      questionIntent: { kind: 'effort_measurement', targetFactId: mathWork.factId, measurement: 'total_duration',
        quantityRole: 'target', amount: 10, unitLabel: '枚' }, previewCount: 0 });
    expect(result.question).toMatchObject({ code: 'missing_effort_estimate', taskId: math.factId,
      forWork: { definingFactId: mathWork.factId, amount: 10, unitLabel: '枚' } });
    const checkpoint = JSON.parse(raw!).vnext;
    expect(checkpoint.presentedQuestion).toMatchObject({ questionKey: result.question!.key,
      graphRevision: result.graphRevision, shownText: result.reply });
    expect(checkpoint.state.graph.tasks).toHaveLength(2);
    expect(checkpoint.state.graph.workloads).toHaveLength(2);
    expect(checkpoint.state.graph.effortEstimates).toEqual([]);
    expect(checkpoint.state.graph.temporalConstraints).toEqual([]);
    expect(checkpoint.preview).toBeNull();
    expect(result.draftCandidates ?? []).toEqual([]);
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(createChatCompletion).not.toHaveBeenCalled();
    expect(approvalWrite).not.toHaveBeenCalled();
    expect(saveBlock).not.toHaveBeenCalled();
  });
});
