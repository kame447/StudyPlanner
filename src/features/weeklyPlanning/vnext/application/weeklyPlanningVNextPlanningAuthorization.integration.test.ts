import { describe, expect, it } from 'vitest';
import { isWeeklyPlanningStableV5PreviewAuthorized } from '../../application/weeklyPlanningStableV5PlanningEvaluation';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { successfulWeeklyPlanningRendererCompletion } from '../../testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import { createInitialPlanningState, weeklyPlanningReducer } from '../../weeklyPlanningReducer';
import { createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn } from './weeklyPlanningVNextExperimentalSession';
import { resolveVNextPlanningAuthorization } from './weeklyPlanningVNextPlanningAuthorization';

const OWNER = 'authorization-owner'; const WEEK = '2026-11-02'; const CONVERSATION = 'authorization-conversation';
const NOW = `${WEEK}T00:00:00.000Z`;
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const task: VNextAddFact = { kind: 'task', localId: 'task', category: 'study', title: '数学' };
const workload = (unitCode: 'minute' | 'page' = 'minute'): VNextAddFact => ({ kind: 'workload', localId: 'work',
  taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'remaining', amount: unitCode === 'minute' ? 60 : 8,
  unitCode, unitLabel: unitCode === 'minute' ? '分' : '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const wire = (planningIntent: VNextPlanningIntent, delta: Partial<VNextTurnDelta> = {}, answer: unknown = null) => ({
  planningIntent, conversationActs: [], delta: { ...EMPTY, ...delta }, answer,
});
type ProviderContext = { activeFacts: { workloads: { id: string }[] }; openQuestions: { key: string }[];
  recentConversation: { role: string; content: string }[]; userText: string };

function harness(responses: Array<unknown | ((context: ProviderContext) => unknown)>) {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
  const inputs: ProviderContext[] = []; const rendered: Record<string, unknown>[] = [];
  let sequence = 0;
  async function turn(userText: string) {
    return submitWeeklyPlanningVNextExperimentalTurn({ userText, turnId: `turn-${++sequence}`,
      shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null,
      scope: { ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION, notBeforeTime: '09:00',
        clock: { currentDate: WEEK, weekStartsOn: 'monday', planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } },
      ports: { checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
        interpret: createWeeklyPlanningVNextProviderInterpreter(),
        client: { async createChatCompletion(request) {
          const input = JSON.parse(request.messages[1].content) as ProviderContext; inputs.push(input);
          if (!responses.length) throw new Error('synthetic response script exhausted');
          const response = responses.shift(); return JSON.stringify(typeof response === 'function' ? response(input) : response);
        } },
        approvalLedger: { read: () => null, write: () => { throw new Error('no approval in this test'); } },
        plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('no save in this test'); } },
        calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => NOW,
        createRenderer: () => createWeeklyPlanningStableV5DialogueRendererCore({ async createChatCompletion(request) {
          const prompt = JSON.parse(request.messages[1].content); rendered.push(prompt);
          if (!prompt.applicationDecision) return '{}'; // Synthetic unavailable recovery verifier.
          const result = JSON.parse(await successfulWeeklyPlanningRendererCompletion(request));
          if (prompt.applicationDecision.communication?.previewAuthorization?.status === 'authorization_required') {
            result.text += '条件は受け取りました。この条件で予定を作って、と依頼してください。';
          }
          return JSON.stringify(result);
        } }),
      },
    });
  }
  return { turn, local, memory, inputs, rendered };
}

describe('V5 authorization policy through the VNext native/session boundary', () => {
  it.each([
    { intent: 'discuss' as const, expected: false, text: '数学の作業量は60分です。' },
    { intent: 'create_plan' as const, expected: true, text: '数学を60分、この条件で予定を作ってください。' },
  ])('accepts the same facts and follows V5 for $intent', async ({ intent, expected, text }) => {
    expect(isWeeklyPlanningStableV5PreviewAuthorized({ previousStatus: null, previousDraftGenerationIntent: null,
      planningIntent: intent, semanticChanged: true, hadMachinePendingQuestion: false })).toBe(expected);
    const h = harness([wire(intent, { add: [task, workload()] })]);
    const result = await h.turn(text);
    expect(result.outcome).toBe('applied');
    expect(result.preview !== null).toBe(expected);
    const state = h.local.readCheckpoint()!.vnext.state;
    expect(state.graph.workloads).toHaveLength(1);
    expect(state.graph.workloads[0].amount).toBe(60);
    expect(state.draftGenerationIntent).toBe(expected ? 'user_authorized' : 'not_requested');
    expect(result.authorizationRequired).toBe(!expected);
    if (!expected) {
      expect(result.question).toBeNull(); // This is a permission request, not another machine data question.
      expect(result.reply).toContain('この条件で予定を作って');
      expect(h.rendered[0]).toMatchObject({ applicationDecision: { actionKind: 'status', previewCount: 0,
        communication: { previewAuthorization: { status: 'authorization_required', requestedPlanningIntent: 'create_plan' } } } });
    }
  });

  it('passes the actual bounded reply to the native reader, then creates without adding facts', async () => {
    const h = harness([wire('discuss', { add: [task, workload()] }), (context: ProviderContext) => {
      expect(context.userText).toBe('お願いします');
      expect(context.recentConversation).toEqual([{ role: 'user', content: '数学の作業量は60分です。' },
        { role: 'assistant', content: h.local.readCheckpoint()!.vnext.messages[1].content }]);
      return wire('create_plan');
    }]);
    const first = await h.turn('数学の作業量は60分です。');
    expect(first.preview).toBeNull();
    const graph = structuredClone(h.local.readCheckpoint()!.vnext.state.graph);
    expect((await h.turn('お願いします')).preview).not.toBeNull();
    expect(h.local.readCheckpoint()!.vnext.state.graph).toEqual(graph);
    expect(h.local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe('user_authorized');
  });

  it.each([true, false])('does not turn a machine answer into new consent (prior consent=%s)', async prior => {
    const h = harness([wire(prior ? 'create_plan' : 'discuss', { add: [task, workload('page')] }),
      wire('create_plan', {}, { kind: 'estimate_minutes', optionId: null, minutes: 40, per: 'whole_work' })]);
    expect((await h.turn(prior ? '残り8枚で予定を作って' : '数学は残り8枚です')).question?.code).toBe('missing_effort_estimate');
    const result = await h.turn('全部で40分');
    expect(result.preview !== null).toBe(prior);
    expect(h.local.readCheckpoint()!.vnext.state.graph.effortEstimates[0].minutes).toBe(40);
    expect(h.local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe(prior ? 'user_authorized' : 'not_requested');
  });

  it('persists consent through a draft-ready correction, using the accepted diff', async () => {
    const h = harness([wire('create_plan', { add: [task, workload()] }), (context: ProviderContext) => wire('update_plan', {
      patch: [{ kind: 'workload', localId: 'correction', targetFactId: context.activeFacts.workloads[0].id, amountDelta: null,
        changes: { amount: 90, quantityRole: null, unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null,
          perOccurrence: null, periodExpression: null } }],
    })]);
    const before = await h.turn('数学を60分、この条件で予定を作って');
    const after = await h.turn('90分に訂正して');
    expect(before.preview).not.toBeNull(); expect(after.preview).not.toBeNull();
    expect(after.graphRevision).toBeGreaterThan(before.graphRevision!);
    expect(h.local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe('user_authorized');
  });

  it('keeps V5 provisional-timebox authorization separate from an estimated effort', async () => {
    const h = harness([wire('discuss', { add: [task, workload('page')] }), (context: ProviderContext) => wire('unknown', {
      defer: [{ questionKey: context.openQuestions[0].key, allocation: 'provisional_timebox' }],
    })]);
    expect((await h.turn('数学は残り8枚')).preview).toBeNull();
    const result = await h.turn('時間は分からないので、暫定で置いて進めて');
    expect(result.preview).not.toBeNull();
    expect(h.local.readCheckpoint()!.vnext.state.graph.effortEstimates).toEqual([]);
    expect(h.local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe('user_authorized');
  });

  it('keeps the already-authorized shown preview on a non-creating, unchanged turn', async () => {
    const h = harness([wire('create_plan', { add: [task, workload()] }), wire('discuss')]);
    const before = await h.turn('数学を60分、この条件で予定を作って');
    const after = await h.turn('内容を確認しました');
    expect(after.outcome).toBe('noop');
    expect(after.preview).toEqual(before.preview);
    expect(after.authorizationRequired).toBe(false);
    expect(after.draftCandidates).toEqual([]);
    expect(h.local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe('user_authorized');
  });

  it('does not accept a permission escalation hidden in a field-local repair', async () => {
    const first = wire('discuss', { add: [task, { ...workload(), unitLabel: null } as unknown as VNextAddFact] });
    const repair = wire('create_plan', { add: [task, workload()] });
    const h = harness([first, repair]);
    const result = await h.turn('数学の作業量は60分です。');
    expect(result.interpretation).toMatchObject({ status: 'interpreted', planningIntent: 'discuss', metrics: { calls: 2, repairs: 1 } });
    expect(result.preview).toBeNull();
    expect(result.authorizationRequired).toBe(true);
    expect(h.local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe('not_requested');
  });

  it('does not persist a creation intent from a rejected reading', async () => {
    const invalid = wire('create_plan', { patch: [{ kind: 'workload', localId: 'bad', targetFactId: 'F999', amountDelta: null,
      changes: { amount: 30, quantityRole: null, unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null,
        perOccurrence: null, periodExpression: null } }] });
    const h = harness([wire('discuss', { add: [task, workload()] }), invalid, invalid]);
    await h.turn('数学の作業量は60分です。');
    const before = structuredClone(h.local.readCheckpoint()!.vnext.state);
    const result = await h.turn('予定を作って。訂正先は不明です。');
    expect(result.outcome).toBe('interpretation_failed');
    expect(result.preview).toBeNull();
    expect(h.local.readCheckpoint()!.vnext.state).toEqual(before);
  });

  it.each(['missing', 'invalid'] as const)('requires the closed native intent field: %s', async kind => {
    const value: Record<string, unknown> = wire('create_plan', { add: [task, workload()] });
    if (kind === 'missing') delete value.planningIntent; else value.planningIntent = 'automatically_schedule';
    const h = harness([value, value]);
    const result = await h.turn('数学を60分');
    expect(result.outcome).toBe('interpretation_failed');
    expect(result.interpretation?.metrics).toMatchObject({ calls: 2, repairs: 1 });
    expect(result.preview).toBeNull();
    expect(h.local.readCheckpoint()!.vnext.state.graph.tasks).toEqual([]);
    expect(h.local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe('not_requested');
  });

  it('invalidates legacy automatic preview without losing facts, edited draft blocks or original bytes', async () => {
    const h = harness([wire('create_plan', { add: [task, workload()] })]);
    const result = await h.turn('数学を60分、この条件で予定を作って');
    const state = weeklyPlanningReducer({ ...createInitialPlanningState(WEEK), previewCandidates: result.draftCandidates!,
      draftBlocks: result.preview!.blocks }, { type: 'mark_draft_block_user_edited', blockId: result.preview!.blocks[0].id });
    h.local.save(CONVERSATION, state);
    const raw = JSON.parse(h.local.checkpoint.read()!); delete raw.vnext.state.draftGenerationIntent;
    const legacy = JSON.stringify(raw); h.local.checkpoint.write(legacy);
    const beforeBytes = new Map(h.memory.values);
    expect(h.local.readCheckpoint()!.vnext.preview).toBeNull();
    expect(h.local.readCheckpoint()!.vnext.state.graph).toEqual(raw.vnext.state.graph);
    const loaded = h.local.load();
    expect(loaded.state.previewCandidates).toEqual([]);
    expect(loaded.state.draftBlocks).toEqual(state.draftBlocks);
    expect(h.memory.values).toEqual(beforeBytes);
  });

  it.each([
    { previousStatus: 'draft_ready' as const, permission: 'not_requested' as const, intent: 'update_plan' as const, expected: false },
    { previousStatus: 'draft_ready' as const, permission: 'user_authorized' as const, intent: 'update_plan' as const, expected: true },
    { previousStatus: 'draft_ready' as const, permission: 'user_authorized' as const, intent: 'discuss' as const, expected: false },
  ])('retains V5 draft-ready rule: $permission / $intent', ({ previousStatus, permission, intent, expected }) => {
    const state = { ...createEmptyWeeklyPlanningVNextState(), draftGenerationIntent: permission };
    const actual = resolveVNextPlanningAuthorization({ state, accepted: true, previousStatus, planningIntent: intent, semanticChanged: true });
    expect(isWeeklyPlanningStableV5PreviewAuthorized({ previousStatus, previousDraftGenerationIntent: permission,
      planningIntent: intent, semanticChanged: true })).toBe(expected);
    expect(actual.authorized).toBe(expected);
  });
});
