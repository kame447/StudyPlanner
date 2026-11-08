// The session routes a learning consultation to advice and leaves every other turn on the planning path (#246).
// The consultation port is scripted here; its provider calls are covered by weeklyPlanningVNextConsultation.test.ts.
import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanningStableV5DialogueRenderInput } from '../../dialogue/weeklyPlanningStableV5DialogueContracts';
import type { WeeklyPlanningVNextInterpretation, WeeklyPlanningVNextInterpretationInput } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import type { WeeklyPlanningVNextConsultationInput, WeeklyPlanningVNextConsultationPort } from './weeklyPlanningVNextConsultation';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'owner-1', weekStartDate: '2026-11-02', conversationId: 'conversation-246',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
  notBeforeTime: '09:00',
};
const metrics = { calls: 1, repairs: 0, latencyMs: 1 };
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = (planningIntent: 'discuss' | 'unknown' | 'create_plan', delta: Partial<VNextTurnDelta> = {}): WeeklyPlanningVNextInterpretation =>
  ({ status: 'interpreted', planningIntent, delta: { ...EMPTY, ...delta }, answer: null, metrics });
const withExtra = (extra: object) => ({ ...reading('discuss'), ...extra }) as WeeklyPlanningVNextInterpretation;
const task: VNextAddFact = { kind: 'task', localId: 'eng', category: 'study', title: '英語' };
const pages: VNextAddFact = { kind: 'workload', localId: 'pages', taskRef: { localId: 'eng' }, componentRef: null, quantityRole: 'scope_total', amount: 20,
  unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null };
const ADVICE = 'まず文法の基礎問題集を1周しましょう。\n\n※これは助言です。';

function harness(script: Array<WeeklyPlanningVNextInterpretation>, consultation?: Partial<WeeklyPlanningVNextConsultationPort>) {
  const slots = new Map<string, string>();
  const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => void slots.set(key, raw) });
  const rendered: WeeklyPlanningStableV5DialogueRenderInput[] = [];
  const inputs: WeeklyPlanningVNextInterpretationInput[] = [];
  const saveBlock = vi.fn(async () => { throw new Error('a consultation never saves'); });
  const port: WeeklyPlanningVNextConsultationPort | undefined = consultation && {
    classify: consultation.classify ?? (async () => 'learning_consultation'),
    answer: consultation.answer ?? (async () => ({ kind: 'proposal', text: ADVICE })) };
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client: {} as OpenAiCompatibleClient,
    async interpret(input) { inputs.push(input); const next = script.shift(); if (!next) throw new Error('script exhausted'); return next; },
    checkpoint: slot('vnext'), legacyV5Checkpoint: { read: () => null }, approvalLedger: slot('ledger'),
    plans: { async findExistingPlanId() { return undefined; }, saveBlock },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    createRenderer: () => ({ async render(input) { rendered.push(input); return { status: 'rendered', text: `（${input.actionKind}）`, rawResponse: '' }; } }),
    ...(port ? { consultation: port } : {}), now: () => '2026-11-02T09:00:00.000Z',
  };
  const turn = (turnId: string, userText: string, extra: { confirmedUserContext?: Parameters<typeof submitWeeklyPlanningVNextExperimentalTurn>[0]['confirmedUserContext'] } = {}) =>
    submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId, userText, shownRevision: null, ...extra });
  const checkpoint = () => parseWeeklyPlanningVNextSessionCheckpoint({ raw: slots.get('vnext')!, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate })!;
  return { ports, slots, rendered, inputs, saveBlock, turn, checkpoint };
}

describe('learning consultation routing in the VNext session (#246)', () => {
  it('answers a consultation with advice: nothing planned, asked, previewed, saved or remembered as a fact', async () => {
    const classify = vi.fn(async () => 'learning_consultation' as const);
    const h = harness([reading('discuss')], { classify });
    const result = await h.turn('t1', '英語が苦手なんだけど何から始めればいい？');
    expect(result).toMatchObject({ outcome: 'noop', replySource: 'advice', reply: ADVICE, question: null, preview: null, draftCandidates: [],
      previewBlockedBy: [], appliedDelta: null, errors: [] });
    expect(h.rendered).toEqual([]);
    expect(h.saveBlock).not.toHaveBeenCalled();
    const stored = h.checkpoint().vnext;
    expect(stored.state.graph.tasks).toEqual([]);
    expect(stored.state.graph.workloads).toEqual([]);
    expect(stored.presentedQuestion).toBeNull();
    expect(stored.preview).toBeNull();
    // Only the conversation text is kept, as language context for the next turn.
    expect(stored.messages).toEqual([{ role: 'user', content: '英語が苦手なんだけど何から始めればいい？' }, { role: 'assistant', content: ADVICE }]);
  });

  it('keeps the planning conversation working after the advice: the next turn reads the earlier text as context only', async () => {
    const h = harness([reading('unknown'), reading('discuss', { add: [task, pages] })], {});
    await h.turn('t1', '数学の参考書は何がいい？');
    const second = await h.turn('t2', '英語を始めたい');
    expect(second.replySource).toBe('renderer');
    expect(second.outcome).toBe('applied');
    expect(h.inputs[1].recentConversation?.slice(-1)[0]).toEqual({ role: 'assistant', content: ADVICE });
    expect(h.inputs[1].presentedQuestion).toBeNull();
  });

  it.each([
    ['planning_operation', async () => 'planning_operation' as const],
    ['unresolved', async () => 'unresolved' as const],
    ['a failed classification', async () => null],
  ])('leaves the turn on the planning path when the purpose is %s', async (_name, classify) => {
    const answer = vi.fn();
    const h = harness([reading('discuss')], { classify, answer });
    const result = await h.turn('t1', '英語が苦手なんだけど何から始めればいい？');
    expect(answer).not.toHaveBeenCalled();
    expect(result).toMatchObject({ replySource: 'renderer', outcome: 'noop', question: { code: 'missing_schedulable_work' } });
    expect(h.rendered).toHaveLength(1);
  });

  it('leaves the turn on the planning path when the advice could not be produced', async () => {
    const h = harness([reading('discuss')], { answer: async () => null });
    const result = await h.turn('t1', '英語が苦手なんだけど何から始めればいい？');
    expect(result).toMatchObject({ replySource: 'renderer', question: { code: 'missing_schedulable_work' } });
  });

  it('is off without a consultation port', async () => {
    const h = harness([reading('discuss')]);
    expect(await h.turn('t1', '英語が苦手なんだけど何から始めればいい？')).toMatchObject({ replySource: 'renderer' });
  });

  describe('is never asked while the words may belong to something else', () => {
    const consult = () => ({ classify: vi.fn(async () => 'learning_consultation' as const), answer: vi.fn(async () => ({ kind: 'proposal' as const, text: ADVICE })) });

    it.each([
      ['a quantity was read with the task', () => reading('discuss', { add: [task, pages] })],
      ['a plan was requested', () => reading('create_plan')],
      ['the model answered a question', () => withExtra({ answer: { kind: 'estimate_minutes', minutes: 30, per: 'whole_work' } })],
      ['study records were read', () => withExtra({ studyRecords: [{ dateExpression: '今日', subject: '英語', minutes: 30 }] })],
    ])('when %s', async (_name, make) => {
      const port = consult();
      const h = harness([make()], port);
      const result = await h.turn('t1', '英語を30分やった');
      expect(port.classify).not.toHaveBeenCalled();
      expect(result.replySource).not.toBe('advice');
    });

    it('while a planning question is open (a short reply is its answer)', async () => {
      const port = consult();
      const h = harness([reading('discuss', { add: [task, pages] }), reading('unknown')], port);
      const first = await h.turn('t1', '英語をやりたい');
      expect(first.question).not.toBeNull();
      const second = await h.turn('t2', 'そうだね');
      expect(port.classify).not.toHaveBeenCalled();
      expect(second.replySource).not.toBe('advice');
    });

    it('while a preview is shown', async () => {
      const port = consult();
      const workload: VNextAddFact = { kind: 'workload', localId: 'w', taskRef: { localId: 'eng' }, componentRef: null, quantityRole: 'declared', amount: 60,
        unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null };
      const h = harness([reading('discuss', { add: [task, workload] }), reading('create_plan'), reading('unknown')], port);
      await h.turn('t1', '英語に合計60分');
      const planned = await h.turn('t2', 'この条件で予定を作ってください');
      expect(planned.preview).not.toBeNull();
      const third = await h.turn('t3', '何から始めればいい？');
      expect(port.classify).not.toHaveBeenCalled();
      expect(third.replySource).not.toBe('advice');
      expect(h.checkpoint().vnext.preview).not.toBeNull();
    });
  });

  it('gives the advice the stated tasks and the confirmed memory as typed context, never as this turn\'s facts', async () => {
    const seen: WeeklyPlanningVNextConsultationInput[] = [];
    const workload: VNextAddFact = { kind: 'workload', localId: 'w', taskRef: { localId: 'eng' }, componentRef: null, quantityRole: 'declared', amount: 60,
      unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null };
    const h = harness([reading('discuss', { add: [task, workload] }), reading('discuss')], {
      classify: async input => { seen.push(input); return 'learning_consultation'; }, answer: async input => { seen.push(input); return { kind: 'proposal', text: ADVICE }; } });
    const first = await h.turn('t1', '英語に合計60分');
    expect(first.question).toBeNull();
    expect(seen).toEqual([]);
    const memory = { records: [{ id: 'm1', ownerId: 'owner-1', kind: 'concern' as const, label: '英語', value: '長文が遅い', dateExpression: null,
      scope: { type: 'global', key: null } as never, origin: 'user_confirmed' as const, observedDate: '2026-11-01', recordedAt: '2026-11-01T09:00:00.000Z',
      sourceConversationId: 'c', sourceTurnId: 't' }] };
    const second = await h.turn('t2', 'どう勉強すればいい？', { confirmedUserContext: memory });
    expect(second.replySource).toBe('advice');
    expect(seen).toHaveLength(2);
    for (const input of seen) {
      expect(input).toMatchObject({ userText: 'どう勉強すればいい？', activeTaskTitles: ['英語'], currentDate: '2026-11-02',
        rememberedBackground: [{ kind: 'concern', label: '英語', value: '長文が遅い' }] });
      expect(input.rememberedBackground[0]).not.toHaveProperty('ownerId');
      expect(input.rememberedBackground[0]).not.toHaveProperty('sourceTurnId');
    }
    // The stated work is untouched by the advice.
    expect(h.checkpoint().vnext.state.graph.workloads.map(item => item.amount)).toEqual([60]);
  });

  describe('a reading that only named a task (#246 slice 2)', () => {
    const consult = (kind: 'learning_consultation' | 'planning_operation' | 'unresolved' | null) => ({
      classify: vi.fn(async () => kind), answer: vi.fn(async () => ({ kind: 'proposal' as const, text: ADVICE })) });

    it('is answered with advice when it is a consultation, and the task name is dropped with the rest of the turn', async () => {
      const port = consult('learning_consultation');
      const h = harness([reading('discuss', { add: [task] })], port);
      const result = await h.turn('t1', '数学の点数を上げたいけど、どの参考書をいつまでに仕上げればいい？');
      expect(result).toMatchObject({ outcome: 'noop', replySource: 'advice', question: null, preview: null, appliedDelta: null });
      expect(h.rendered).toEqual([]);
      const stored = h.checkpoint().vnext;
      expect(stored.state.graph.tasks).toEqual([]);
      expect(stored.state.graph.revision).toBe(0);
      expect(stored.messages.slice(-1)[0]).toEqual({ role: 'assistant', content: ADVICE });
    });

    it.each([
      ['planning_operation', 'planning_operation' as const], ['unresolved', 'unresolved' as const], ['a failed classification', null],
    ])('keeps the task and the planning question when the purpose is %s (a first word of a plan is not lost)', async (_name, kind) => {
      const port = consult(kind);
      const h = harness([reading('discuss', { add: [task] })], port);
      const result = await h.turn('t1', '英語をやりたい');
      expect(port.classify).toHaveBeenCalledOnce();
      expect(port.answer).not.toHaveBeenCalled();
      expect(result).toMatchObject({ outcome: 'applied', replySource: 'renderer', question: { code: 'missing_schedulable_work' } });
      expect(h.checkpoint().vnext.state.graph.tasks.map(item => item.title)).toEqual(['英語']);
    });

    it('keeps the task when the advice is refused, so nothing the user said is lost to a failed consultation', async () => {
      const port = { classify: vi.fn(async () => 'learning_consultation' as const), answer: vi.fn(async () => null) };
      const h = harness([reading('discuss', { add: [task] })], port);
      const result = await h.turn('t1', '英語の参考書はどれがいい？');
      expect(result).toMatchObject({ outcome: 'applied', replySource: 'renderer' });
      expect(h.checkpoint().vnext.state.graph.tasks.map(item => item.title)).toEqual(['英語']);
    });

    const studyContext = (): VNextAddFact => ({ kind: 'study_context', localId: 'c', taskRef: { localId: 'eng' }, purpose: 'exam', activityKind: 'problem_solving', contextLabel: '共通テスト' });

    it('is answered with advice when the task came with its study context (the real model often adds it), and both are dropped', async () => {
      const port = consult('learning_consultation');
      const h = harness([reading('discuss', { add: [task, studyContext()] })], port);
      const result = await h.turn('t1', '共通テストの英語を伸ばしたい。どう勉強すればいい？');
      expect(result).toMatchObject({ replySource: 'advice', appliedDelta: null });
      expect(h.checkpoint().vnext.state.graph.tasks).toEqual([]);
    });

    it('keeps the task and its study context when the purpose is planning', async () => {
      const h = harness([reading('discuss', { add: [task, studyContext()] })], consult('planning_operation'));
      const result = await h.turn('t1', '共通テストの英語をやりたい');
      expect(result).toMatchObject({ replySource: 'renderer', outcome: 'applied' });
      expect(h.checkpoint().vnext.state.graph.tasks.map(item => item.title)).toEqual(['英語']);
    });

    it.each([
      ['a temporal constraint', (): VNextAddFact => ({ kind: 'temporal_constraint', localId: 'c', taskRef: { localId: 'eng' }, targetRef: { localId: 'eng' },
        constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: 'this_week', namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact' })],
      ['a quantity', () => pages],
    ])('is not consulted when the reading also read %s', async (_name, extra) => {
      const port = consult('learning_consultation');
      const h = harness([reading('discuss', { add: [task, extra()] })], port);
      await h.turn('t1', '英語の共通テスト対策を今週中に');
      expect(port.classify).not.toHaveBeenCalled();
    });
  });

  it('writes nothing when another turn saved while the advice was being produced', async () => {
    let h!: ReturnType<typeof harness>;
    h = harness([reading('discuss')], { answer: async () => { h.slots.set('vnext', 'another tab saved'); return { kind: 'proposal', text: ADVICE }; } });
    const result = await h.turn('t1', '何から始めればいい？');
    expect(result).toMatchObject({ outcome: 'stale', replySource: 'system' });
    expect(h.slots.get('vnext')).toBe('another tab saved');
  });
});
