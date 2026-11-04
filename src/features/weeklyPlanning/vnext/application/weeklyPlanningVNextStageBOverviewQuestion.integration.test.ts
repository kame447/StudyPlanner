import { expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from '../../dialogue/weeklyPlanningStableV5DialogueContracts';
import { RENDERER_TECHNICAL_STOP } from '../../dialogue/weeklyPlanningStableV5TurnDialogueCore';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import type { WeeklyPlanningVNextInterpretationInput } from '../weeklyPlanningVNextInterpretationContract';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const WEEK = '2026-11-02';
const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: 'overview-owner', conversationId: 'overview-conversation',
  weekStartDate: WEEK, notBeforeTime: '09:00', clock: { currentDate: WEEK, planningStartDate: WEEK,
    planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' } };
const empty = { add: [], patch: [], remove: [], relate: [], defer: [] };
const initialText = '今週は英語60分と数学プリント10枚を進めたい。予定案を作ってください。';
const firstReply = '英語60分と数学プリント10枚ですね。数学プリントの全体に何分かかりますか？';
const answer = { kind: 'estimate_minutes', optionId: null, minutes: 40, per: 'whole_work' };
const reading = (delta: unknown = empty, resultAnswer: unknown = null, planningIntent = 'unknown') =>
  ({ planningIntent, conversationActs: [], answer: resultAnswer, delta });
const task = (localId: string, title: string) => ({ kind: 'task', localId, category: 'study', title });
const work = (localId: string, taskId: string, amount: number, unitCode: string, unitLabel: string) => ({ kind: 'workload', localId,
  taskRef: { localId: taskId }, componentRef: null, quantityRole: 'target', amount, unitCode, unitLabel,
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const seed = reading({ ...empty, add: [task('english', '英語'), work('english-work', 'english', 60, 'minute', '分'),
  task('math', '数学プリント'), work('math-work', 'math', 10, 'page', '枚')] }, null, 'create_plan');
type Context = { activeFacts: { workloads: { id: string; amount: number }[] } };
type Script = unknown | ((context: Context) => unknown);

function harness(scripts: Script[], failFirstRender = false) {
  const storage = createMemoryStorageHarness().storage;
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: scope.ownerId, weekStartDate: WEEK, storage });
  const inputs: Pick<WeeklyPlanningVNextInterpretationInput, 'presentedQuestion' | 'presentedText'>[] = [];
  const rendered: WeeklyPlanningStableV5DialogueRenderInput[] = [];
  const rendererPrompts: Record<string, unknown>[] = [];
  let rendererCalls = 0;
  let planWrites = 0;
  let approvalWrites = 0;
  const actualInterpreter = createWeeklyPlanningVNextProviderInterpreter();
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
    interpret: input => {
      inputs.push(structuredClone({ presentedQuestion: input.presentedQuestion, presentedText: input.presentedText }));
      return actualInterpreter(input);
    },
    client: { async createChatCompletion(request) {
      const script = scripts.shift();
      if (!script) throw new Error('synthetic reading script exhausted');
      const context = JSON.parse(request.messages[1].content) as Context;
      return JSON.stringify(typeof script === 'function' ? script(context) : script);
    } },
    approvalLedger: { read: () => null, write: () => { approvalWrites++; } },
    plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { planWrites++; return { planId: 'unexpected' }; } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => `${WEEK}T00:00:00.000Z`,
    createRenderer: options => {
      // The renderer core and validator are real, but the wording below is scripted: it cannot establish model quality.
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ async createChatCompletion(request) {
        rendererCalls++;
        if (failFirstRender && rendererCalls === 1) throw new Error('synthetic renderer unavailable');
        const prompt = JSON.parse(request.messages[1].content) as { actionId: string; applicationDecision: {
          actionKind: string; questionCode: string | null; relevantLabels: string[]; previewPromotionControlLabel?: string | null } };
        rendererPrompts.push(prompt);
        const text = rendererCalls === 1 ? firstReply : `条件を受け取りました。${prompt.applicationDecision.relevantLabels.join('、')}を確認します。${prompt.applicationDecision.previewPromotionControlLabel ?? ''}`;
        return JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
          questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null, text });
      } }, options);
      return { render: input => { rendered.push(structuredClone(input)); return renderer.render(input); } };
    },
  };
  let turnId = 0;
  const turn = (userText: string, shownRevision: number | null) => submitWeeklyPlanningVNextExperimentalTurn({
    scope, ports, userText, shownRevision, turnId: `turn-${++turnId}` });
  return { local, inputs, rendered, rendererPrompts, turn, writes: () => [approvalWrites, planWrites] };
}

function checkInitial(h: ReturnType<typeof harness>) {
  const checkpoint = h.local.readCheckpoint()!.vnext;
  const graph = checkpoint.state.graph;
  expect(graph.tasks).toHaveLength(2);
  expect(graph.workloads).toHaveLength(2);
  const english = graph.tasks.find(item => item.title === '英語')!;
  const math = graph.tasks.find(item => item.title === '数学プリント')!;
  const englishWork = graph.workloads.find(item => item.taskId === english.id)!;
  const mathWork = graph.workloads.find(item => item.taskId === math.id)!;
  expect(englishWork).toMatchObject({ amount: 60, unitCode: 'minute' });
  expect(mathWork).toMatchObject({ amount: 10, unitCode: 'page' });
  expect(graph.effortEstimates).toEqual([]);
  expect(checkpoint.preview).toBeNull();
  expect(checkpoint.actualRecords ?? []).toEqual([]);
  expect(h.writes()).toEqual([0, 0]);
  return { checkpoint, graph: structuredClone(graph), english, math, englishWork, mathWork };
}

it('passes both known works to the real renderer, records its shown question and binds the next answer', async () => {
  const h = harness([seed, reading(empty, answer)]);
  const first = await h.turn(initialText, null);
  expect(first).toMatchObject({ outcome: 'applied', replySource: 'renderer', reply: firstReply, preview: null });
  const { checkpoint, graph, english, math, englishWork, mathWork } = checkInitial(h);
  expect(first.question).toMatchObject({ code: 'missing_effort_estimate', taskId: math.id,
    forWork: { definingFactId: mathWork.id, amount: 10 } });
  expect(h.rendered).toHaveLength(1);
  expect(h.rendered[0]).toMatchObject({ actionKind: 'question', communication: { goal: 'ask_question', askQuestion: true },
    questionCode: 'missing_effort_estimate', questionTarget: { fact: { id: mathWork.id, taskId: math.id } },
    questionIntent: { kind: 'effort_measurement', targetFactId: mathWork.id, measurement: 'total_duration', amount: 10 },
    planningInformation: { tasks: expect.arrayContaining([expect.objectContaining({ id: english.id, title: '英語' }),
        expect.objectContaining({ id: math.id, title: '数学プリント' })]),
      workloads: expect.arrayContaining([expect.objectContaining({ id: englishWork.id, taskId: english.id, amount: 60 }),
        expect.objectContaining({ id: mathWork.id, taskId: math.id, amount: 10 })]) } });
  expect(h.rendered[0].currentTurnGrounding?.acceptedFacts.map(item => item.factId))
    .toEqual(expect.arrayContaining([english.id, englishWork.id, math.id, mathWork.id]));
  expect(h.rendererPrompts).toHaveLength(1);
  expect(h.rendererPrompts[0]).toMatchObject({ currentTurnGrounding: { acceptedFacts: expect.arrayContaining([
    expect.objectContaining({ factId: english.id }), expect.objectContaining({ factId: englishWork.id }),
    expect.objectContaining({ factId: math.id }), expect.objectContaining({ factId: mathWork.id }),
  ]) }, applicationDecision: { questionCode: 'missing_effort_estimate',
    questionIntent: { targetFactId: mathWork.id, measurement: 'total_duration', amount: 10 } } });
  // Verify the serialized request itself retains values and task bindings in both context channels.
  expect(h.rendererPrompts[0]).toMatchObject({
    currentTurnGrounding: { acceptedFacts: expect.arrayContaining([
      expect.objectContaining({ factId: english.id, kind: 'task', data: expect.objectContaining({ title: '英語' }) }),
      expect.objectContaining({ factId: englishWork.id, kind: 'workload', data: expect.objectContaining({
        taskId: english.id, amount: 60, unitCode: 'minute', unitLabel: '分' }) }),
      expect.objectContaining({ factId: math.id, kind: 'task', data: expect.objectContaining({ title: '数学プリント' }) }),
      expect.objectContaining({ factId: mathWork.id, kind: 'workload', data: expect.objectContaining({
        taskId: math.id, amount: 10, unitCode: 'page', unitLabel: '枚' }) }),
    ]) },
    planningStateSummary: { acceptedFacts: {
      tasks: expect.arrayContaining([expect.objectContaining({ id: english.id, title: '英語' }),
        expect.objectContaining({ id: math.id, title: '数学プリント' })]),
      workloads: expect.arrayContaining([expect.objectContaining({ id: englishWork.id, taskId: english.id,
        amount: 60, unitCode: 'minute', unitLabel: '分' }), expect.objectContaining({ id: mathWork.id, taskId: math.id,
        amount: 10, unitCode: 'page', unitLabel: '枚' })]),
    } },
  });
  expect(checkpoint.presentedQuestion).toMatchObject({ questionKey: first.question!.key, graphRevision: first.graphRevision, shownText: firstReply });
  const second = await h.turn('数学プリント全体で40分です。', first.graphRevision);
  expect(h.inputs[1]).toMatchObject({ presentedQuestion: { key: first.question!.key }, presentedText: firstReply });
  expect(second.outcome).toBe('applied');
  const after = h.local.readCheckpoint()!.vnext;
  expect(after.state.graph.tasks).toEqual(graph.tasks);
  expect(after.state.graph.workloads).toEqual(graph.workloads);
  expect(after.state.graph.effortEstimates).toHaveLength(1);
  expect(after.state.graph.effortEstimates[0]).toMatchObject({ taskId: math.id, targetFactId: mathWork.id, kind: 'total_duration', minutes: 40 });
  expect(h.writes()).toEqual([0, 0]);
});

it('does not bind an answer to a question that the renderer failed to show', async () => {
  const h = harness([seed, reading(empty, answer)], true);
  const first = await h.turn(initialText, null);
  expect(first).toMatchObject({ outcome: 'applied', replySource: 'renderer_fallback', reply: RENDERER_TECHNICAL_STOP,
    question: { code: 'missing_effort_estimate' }, preview: null });
  const { checkpoint, graph } = checkInitial(h);
  expect(checkpoint.presentedQuestion).toBeNull();
  const second = await h.turn('全体で40分です。', first.graphRevision);
  expect(h.inputs[1]).toEqual({ presentedQuestion: null, presentedText: null });
  expect(second).toMatchObject({ outcome: 'answer_represented', appliedDelta: null });
  expect(h.local.readCheckpoint()!.vnext.state.graph).toEqual(graph);
  expect(h.writes()).toEqual([0, 0]);
});

it('does not bind an answer to the old shown revision after a separate correction', async () => {
  const changeEnglish = (context: Context) => reading({ ...empty, patch: [{ kind: 'workload', localId: 'correct-english',
    targetFactId: context.activeFacts.workloads.find(item => item.amount === 60)!.id, amountDelta: null,
    changes: { amount: 75, quantityRole: null, unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null,
      perOccurrence: null, periodExpression: null } }] }, null, 'update_plan');
  const h = harness([seed, changeEnglish, reading(empty, answer)]);
  const first = await h.turn(initialText, null);
  expect(first.replySource).toBe('renderer');
  const { checkpoint } = checkInitial(h);
  expect(checkpoint.presentedQuestion).toMatchObject({ questionKey: first.question!.key, graphRevision: first.graphRevision, shownText: firstReply });
  const changed = await h.turn('英語は75分に訂正します。', first.graphRevision);
  expect(changed.outcome).toBe('applied');
  expect(changed.graphRevision!).toBeGreaterThan(first.graphRevision!);
  const afterChange = structuredClone(h.local.readCheckpoint()!.vnext);
  expect(afterChange.presentedQuestion).toMatchObject({ graphRevision: changed.graphRevision });
  expect(afterChange.state.graph.effortEstimates).toEqual([]);
  const stale = await h.turn('全体で40分です。', first.graphRevision);
  expect(h.inputs[2]).toEqual({ presentedQuestion: null, presentedText: null });
  expect(stale).toMatchObject({ outcome: 'answer_represented', appliedDelta: null });
  expect(h.local.readCheckpoint()!.vnext.state.graph).toEqual(afterChange.state.graph);
  expect(h.writes()).toEqual([0, 0]);
});
