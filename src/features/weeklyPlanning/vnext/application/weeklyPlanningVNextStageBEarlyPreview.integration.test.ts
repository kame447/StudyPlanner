import { describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { submitWeeklyPlanningVNextExperimentalTurn } from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';

const OWNER = 'stage-b-preview-owner';
const WEEK = '2026-11-02';
const CONVERSATION = 'stage-b-preview-conversation';
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, title, category: 'study' });
const workload = (id: string, amount: number, unitCode: 'minute' | 'page', unitLabel: string): VNextAddFact => ({
  kind: 'workload', localId: `${id}-work`, taskRef: { localId: id }, componentRef: null,
  quantityRole: 'remaining', amount, unitCode, unitLabel, rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null,
});
const MATH = [task('math', '数学プリント'), workload('math', 8, 'page', '枚')];
const ENGLISH = [task('english', '英語'), workload('english', 60, 'minute', '分')];
const wire = (planningIntent: VNextPlanningIntent, delta: Partial<VNextTurnDelta> = {}, answer: unknown = null) => ({
  planningIntent, conversationActs: [], delta: { ...EMPTY, ...delta }, answer,
});
type Context = { userText: string; openQuestions: { key: string }[] };

function harness(responses: Array<unknown | ((context: Context) => unknown)>) {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
  const saveBlock = vi.fn(async () => { throw new Error('no save before explicit preview approval'); });
  const approvalWrite = vi.fn(() => { throw new Error('no preview approval in this characterization'); });
  let sequence = 0;
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({
    userText, turnId: `turn-${++sequence}`,
    shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null,
    scope: { ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION, notBeforeTime: '09:00',
      clock: { currentDate: WEEK, weekStartsOn: 'monday', planningStartDate: WEEK,
        planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } },
    ports: {
      checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
      interpret: createWeeklyPlanningVNextProviderInterpreter(),
      client: { async createChatCompletion(request) {
        const context = JSON.parse(request.messages[1].content) as Context;
        if (!responses.length) throw new Error('synthetic response script exhausted');
        const response = responses.shift();
        return JSON.stringify(typeof response === 'function' ? response(context) : response);
      } },
      approvalLedger: { read: () => null, write: approvalWrite },
      plans: { findExistingPlanId: async () => undefined, saveBlock },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      now: () => `${WEEK}T00:00:00.000Z`,
      createRenderer: () => ({ render: async input => ({ status: 'rendered', rawResponse: '',
        text: JSON.stringify({ actionKind: input.actionKind, questionCode: input.questionCode,
          communication: input.communication, previewCount: input.previewCount }) }) }),
    },
  });
  const assertUnsaved = () => {
    expect(saveBlock).not.toHaveBeenCalled();
    expect(approvalWrite).not.toHaveBeenCalled();
  };
  return { turn, local, assertUnsaved };
}

describe('Stage B: early preview after an independent explicit request (synthetic provider)', () => {
  it('control: an explicit request with complete work produces an unsaved preview', async () => {
    const h = harness([wire('create_plan', { add: ENGLISH })]);
    const result = await h.turn('英語を60分、この条件で今週の予定案を作って');
    expect(result.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 1, repairs: 0 } });
    expect(result.question).toBeNull();
    expect(result.preview).not.toBeNull();
    h.assertUnsaved();
  });

  it('control: merely answering an effort question does not authorize a preview', async () => {
    const h = harness([wire('discuss', { add: MATH }),
      wire('unknown', {}, { kind: 'estimate_minutes', optionId: null, minutes: 40, per: 'whole_work' })]);
    expect((await h.turn('数学プリントは残り8枚です')).question?.code).toBe('missing_effort_estimate');
    const result = await h.turn('全部で40分です');
    expect(result.question).toBeNull();
    expect(result.preview).toBeNull();
    expect(h.local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe('not_requested');
    h.assertUnsaved();
  });

  it('does not authorize a preview from deferral and complete facts without an explicit request', async () => {
    const h = harness([wire('discuss', { add: MATH }), (context: Context) => wire('discuss', {
      add: ENGLISH, defer: [{ questionKey: context.openQuestions[0].key, allocation: 'none' }],
    })]);
    await h.turn('数学プリントは残り8枚です');
    const result = await h.turn('数学は後で決めます。英語は60分あります');
    expect(result).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null, preview: null });
    expect(h.local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe('not_requested');
    h.assertUnsaved();
  });

  it('retains the authorization guard while another required question remains unresolved', async () => {
    const physics = [task('physics', '物理プリント'), workload('physics', 6, 'page', '枚')];
    const h = harness([wire('discuss', { add: [...MATH, ...physics] }), (context: Context) => wire('create_plan', {
      add: ENGLISH, defer: [{ questionKey: context.openQuestions[0].key, allocation: 'none' }],
    })]);
    await h.turn('数学は残り8枚、物理は残り6枚です');
    const result = await h.turn('数学は後で決めます。先に英語60分の予定案を作って');
    expect(result).toMatchObject({ outcome: 'applied', readiness: 'needs_resolution', preview: null });
    const state = h.local.readCheckpoint()!.vnext.state;
    expect(result.question?.taskId).toBe(state.graph.tasks.find(item => item.title === '物理プリント')!.id);
    expect(state.draftGenerationIntent).toBe('not_requested');
    h.assertUnsaved();
  });

  it.each([false, true])('deferring the old work keeps an explicit request (English already known=%s)', async englishAlreadyKnown => {
    const h = harness([wire('discuss', { add: englishAlreadyKnown ? [...MATH, ...ENGLISH] : MATH }), (context: Context) => {
      expect(context.userText).toBe('数学は後で決めます。先に英語60分の今週の予定案を作って');
      // This is not a bare machine answer: the native contract separately carries
      // a new explicit creation request and independently stated, complete work.
      return wire('create_plan', { add: englishAlreadyKnown ? [] : ENGLISH,
        defer: [{ questionKey: context.openQuestions[0].key, allocation: 'none' }] });
    }, wire('create_plan')]);
    const first = await h.turn(englishAlreadyKnown ? '数学プリントは残り8枚、英語は60分です' : '数学プリントは残り8枚です');
    expect(first.question?.code).toBe('missing_effort_estimate');
    const result = await h.turn('数学は後で決めます。先に英語60分の今週の予定案を作って');
    expect(result.interpretation).toMatchObject({ status: 'interpreted', planningIntent: 'create_plan',
      metrics: { calls: 1, repairs: 0 } });
    expect(result).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null, previewBlockedBy: [] });
    const checkpoint = h.local.readCheckpoint()!.vnext;
    expect(checkpoint.state.graph.tasks.map(item => item.title)).toEqual(['数学プリント', '英語']);
    expect(checkpoint.state.graph.effortEstimates).toEqual([]);
    expect(checkpoint.state.deferrals).toContainEqual(expect.objectContaining({ questionKey: first.question!.key, allocation: 'none' }));
    h.assertUnsaved();
    // A second creation request succeeds against these same accepted facts. This
    // excludes a missing estimate or placement failure for the English work.
    const repeatedRequest = await h.turn('この条件で今週の予定案を作って');
    expect(repeatedRequest.preview).not.toBeNull();
    expect(repeatedRequest.preview!.blocks.every(block => block.title.includes('英語'))).toBe(true);
    expect(h.local.readCheckpoint()!.vnext.state.graph.effortEstimates).toEqual([]);
    h.assertUnsaved();
    // Stage B desired behavior: show the English preview now, leave math deferred,
    // and retain the ordinary explicit approval boundary for saving.
    expect(result.preview, 'the user explicitly requested this complete English preview in this turn').not.toBeNull();
  });
});
