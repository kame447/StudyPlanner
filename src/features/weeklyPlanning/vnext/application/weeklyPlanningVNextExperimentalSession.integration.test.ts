// Offline end-to-end for the experimental VNext session: interpretation (scripted
// here; the real provider runs in the real-API profile) → transaction →
// projection → question → answer → preview → approval with a partial save and
// its resume → reload → rollback to the untouched V5 checkpoint.
import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import {
  parseWeeklyPlanningStableV5PersistedSession,
  prepareWeeklyPlanningStableV5Checkpoint,
  serializeWeeklyPlanningStableV5CheckpointWithMessageCount,
} from '../../application/weeklyPlanningStableV5SessionCodec';
import { parseWeeklyApprovalLedger } from '../../planning/weeklyPlanningApproval';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type { Plan } from '../../../../types/domain';
import { WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL } from '../../dialogue/weeklyPlanningStableV5DialogueContext';
import type { WeeklyPlanningStableV5DialogueRenderInput } from '../../dialogue/weeklyPlanningStableV5DialogueContracts';
import { RENDERER_PREVIEW_CONTINGENCY, RENDERER_TECHNICAL_STOP } from '../../dialogue/weeklyPlanningStableV5TurnDialogueCore';
import type { WeeklyPlanDraftBlock } from '../../types';
import { createInitialPlanningIntakeState } from '../../intake/weeklyPlanningIntakeReducer';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import type {
  WeeklyPlanningVNextInterpretation,
  WeeklyPlanningVNextInterpretationInput,
} from '../weeklyPlanningVNextInterpretationContract';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import {
  approveWeeklyPlanningVNextExperimentalPreview,
  readWeeklyPlanningVNextExperimentalSession,
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'owner-1', weekStartDate: '2026-11-02', conversationId: 'conversation-e2e',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo',
    weekStartsOn: 'monday' },
  notBeforeTime: '09:00',
};
const metrics = { calls: 1, repairs: 0, latencyMs: 1 };
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const interpreted = (delta: Partial<VNextTurnDelta>, answer: Extract<WeeklyPlanningVNextInterpretation, { status: 'interpreted' }>['answer'] = null):
  WeeklyPlanningVNextInterpretation => ({ status: 'interpreted', planningIntent: 'create_plan' as const, delta: { ...EMPTY, ...delta }, answer, metrics });
const pages = (localId: string, role: 'scope_total' | 'completed', amount: number): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 'slides' }, componentRef: null, quantityRole: role, amount,
  unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});

function harness(script: Array<WeeklyPlanningVNextInterpretation | ((input: WeeklyPlanningVNextInterpretationInput) => WeeklyPlanningVNextInterpretation)>, options: {
  legacyV5?: string; failSaveOnce?: number;
} = {}) {
  const slots = new Map<string, string>();
  if (options.legacyV5) slots.set('v5', options.legacyV5);
  const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => void slots.set(key, raw) });
  const saved = new Map<string, WeeklyPlanDraftBlock>();
  const inputs: WeeklyPlanningVNextInterpretationInput[] = [];
  const rendered: WeeklyPlanningStableV5DialogueRenderInput[] = [];
  let saveCalls = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client: {} as OpenAiCompatibleClient,
    async interpret(input) {
      inputs.push(input);
      const next = script.shift();
      if (!next) throw new Error('script exhausted');
      return typeof next === 'function' ? next(input) : next;
    },
    checkpoint: slot('vnext'),
    legacyV5Checkpoint: { read: slot('v5').read },
    approvalLedger: slot('ledger'),
    plans: {
      async findExistingPlanId(sourceDraftBlockId) {
        return saved.has(sourceDraftBlockId) ? `plan:${sourceDraftBlockId}` : undefined;
      },
      async saveBlock(block) {
        saveCalls += 1;
        if (saveCalls === options.failSaveOnce) throw new Error('network-down');
        saved.set(block.id, block);
        return { planId: `plan:${block.id}` };
      },
    },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    createRenderer: () => ({ async render(input) {
      rendered.push(input);
      return { status: 'rendered', text: `（説明 ${input.actionKind}）`, rawResponse: '' };
    } }),
    now: () => '2026-11-02T09:00:00.000Z',
  };
  return { ports, slots, saved, inputs, rendered, saveCalls: () => saveCalls };
}

/** One user in one tab: each turn answers the reply the previous turn showed. */
const shownRevisions = new WeakMap<WeeklyPlanningVNextExperimentalPorts, number>();
const turn = async (ports: WeeklyPlanningVNextExperimentalPorts, turnId: string, userText: string) => {
  const result = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId, userText, shownRevision: shownRevisions.get(ports) ?? null });
  if (result.graphRevision !== null) shownRevisions.set(ports, result.graphRevision);
  return result;
};

describe('VNext experimental session end to end (offline)', () => {
  it('asks, binds the answer to the asked work, previews, saves partially, resumes, and never saves twice', async () => {
    const h = harness([
      interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' }, pages('total', 'scope_total', 20), pages('done', 'completed', 12)] }),
      interpreted({}, { kind: 'estimate_minutes', minutes: 120, per: 'whole_work' }),
    ]);

    const first = await turn(h.ports, 't1', 'ゼミ資料は20枚で12枚できた');
    expect(first).toMatchObject({ outcome: 'applied', readiness: 'needs_resolution', preview: null,
      question: { code: 'missing_effort_estimate', forWork: { amount: 8 } } });

    // Reload is the normal path: the second turn reads the presented question back from the checkpoint.
    const second = await turn(h.ports, 't2', '2時間くらい');
    expect(h.inputs[1].presentedQuestion?.key).toBe(first.question!.key);
    expect(second).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null });
    expect(second.preview!.blocks.length).toBeGreaterThan(1);
    const revisions = second.preview!.blocks.map((block) => block.behaviorMetadata!.previewMetadata!.stateRevision);
    expect(new Set(revisions)).toEqual(new Set([second.graphRevision]));

    const read = readWeeklyPlanningVNextExperimentalSession(scope, h.ports);
    expect(read).toMatchObject({ status: 'ready', source: 'vnext', checkpoint: { preview: second.preview, presentedQuestion: null } });

    // A save fails mid-way: the ledger keeps a partial receipt.
    const failing = harness([], { failSaveOnce: 2 });
    failing.slots.set('vnext', h.slots.get('vnext')!);
    const partial = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: failing.ports });
    expect(partial).toMatchObject({ status: 'executed', operation: { status: 'partially_saved' } });
    const receipt = parseWeeklyApprovalLedger(failing.slots.get('ledger')!)!.operations[0];
    expect(receipt.items.map((item) => item.status)).toContain('failed');

    // Resume: the same operation continues, saved blocks are not saved again, and it completes.
    const resumed = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: failing.ports });
    expect(resumed).toMatchObject({ status: 'executed', operation: { status: 'completed', approvalOperationId: receipt.approvalOperationId } });
    expect(failing.saved.size).toBe(second.preview!.blocks.length);
    const callsAfterCompletion = failing.saveCalls();
    expect(callsAfterCompletion).toBe(second.preview!.blocks.length + 1);
    const again = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: failing.ports });
    expect(again).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
    expect(failing.saveCalls()).toBe(callsAfterCompletion);
  });

  it('binds a per-unit answer as a rate in the asked work\'s unit, and a whole-work answer as its total (run 41006879822)', async () => {
    const stated = interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' }, pages('total', 'scope_total', 20), pages('done', 'completed', 12)] });
    const perUnit = harness([stated, interpreted({}, { kind: 'estimate_minutes', minutes: 8, per: 'unit' })]);
    await turn(perUnit.ports, 't1', 'ゼミ資料は20枚で12枚できた');
    const rated = await turn(perUnit.ports, 't2', '1枚あたり8分くらい');
    expect(rated).toMatchObject({ outcome: 'applied', question: null });
    expect(rated.appliedDelta!.add[0]).toMatchObject({ effortKind: 'duration_per_unit', minutes: 8, unitCode: 'page', unitLabel: '枚' });
    const read = readWeeklyPlanningVNextExperimentalSession(scope, perUnit.ports);
    const work = read.status === 'ready' ? projectWeeklyPlanningVNext(read.checkpoint.state).owners.flatMap((owner) => owner.work) : [];
    expect(work).toEqual([expect.objectContaining({ amount: 8, minutes: 64, estimateBasis: 'rate' })]);

    const whole = harness([stated, interpreted({}, { kind: 'estimate_minutes', minutes: 120, per: 'whole_work' })]);
    await turn(whole.ports, 't1', 'ゼミ資料は20枚で12枚できた');
    expect((await turn(whole.ports, 't2', '残りは2時間')).appliedDelta!.add[0]).toMatchObject({ effortKind: 'total_duration', minutes: 120 });
  });

  it('an estimate answer restated as a fact in the same reading is one statement, never two commits (Astra F02)', async () => {
    const cards = (amount: number, unitLabel: string): VNextAddFact => ({ kind: 'workload', localId: 'w', taskRef: { localId: 'slides' }, componentRef: null,
      quantityRole: 'remaining', amount, unitCode: 'custom', unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
    const rate: VNextAddFact = { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'slides' }, targetRef: { localId: 'w' },
      effortKind: 'duration_per_unit', minutes: 8, unitCode: 'custom', unitLabel: '枚', precision: 'exact' };
    const relabel = (input: WeeklyPlanningVNextInterpretationInput) => ({ kind: 'workload' as const, localId: 'unit', targetFactId: input.state.graph.workloads[0].id,
      amountDelta: null, changes: { amount: 2, unitCode: null, unitLabel: 'セット', quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } });
    const setup = [interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: 'カード' }, cards(10, '枚'), rate] }),
      (input: WeeklyPlanningVNextInterpretationInput) => interpreted({ patch: [relabel(input)] })];
    // Run 41016120596 rep 2: the answer per unit plus a patch turning the old rate into 20 min/セット.
    const both = harness([...setup, (input) => interpreted({ patch: [{ kind: 'effort_estimate', localId: 'again', targetFactId: input.state.graph.effortEstimates[0].id,
      changes: { minutes: 20, effortKind: null, unitCode: null, unitLabel: 'セット', precision: null } }] }, { kind: 'estimate_minutes', minutes: 20, per: 'unit' })]);
    await turn(both.ports, 't1', 'カードは残り10枚で、1枚8分です。');
    const asked = await turn(both.ports, 't2', '単位はセットでした。残り2セットです。');
    expect(asked.question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 2, unitLabel: 'セット' } });
    const before = both.slots.get('vnext');
    expect(await turn(both.ports, 't3', '1セットあたり20分です。')).toMatchObject({ outcome: 'rejected', errors: [expect.objectContaining({ path: 'patch[0]', localId: 'again' })] });
    expect(JSON.parse(both.slots.get('vnext')!).vnext.state).toEqual(JSON.parse(before!).vnext.state);
    // Control: the answer alone commits one rate in the asked work's unit.
    const once = harness([...setup, interpreted({}, { kind: 'estimate_minutes', minutes: 20, per: 'unit' })]);
    await turn(once.ports, 't1', 'カードは残り10枚で、1枚8分です。');
    await turn(once.ports, 't2', '単位はセットでした。残り2セットです。');
    expect(await turn(once.ports, 't3', '1セットあたり20分です。')).toMatchObject({ outcome: 'applied', question: null });
    const read = readWeeklyPlanningVNextExperimentalSession(scope, once.ports);
    const work = read.status === 'ready' ? projectWeeklyPlanningVNext(read.checkpoint.state).owners.flatMap((owner) => owner.work) : [];
    expect(work).toEqual([expect.objectContaining({ amount: 2, minutes: 40, estimateBasis: 'rate' })]);
  });

  it('an option answer restated in the same reading is one statement, never two commits', async () => {
    const task = { kind: 'task' as const, localId: 'slides', category: 'study' as const, title: 'ゼミ資料' };
    const work = (localId: string, quantityRole: 'scope_total' | 'completed' | 'remaining', amount: number, unitCode: 'page' | 'minute' = 'page'): VNextAddFact => ({
      kind: 'workload', localId, taskRef: { localId: 'slides' }, componentRef: null, quantityRole, amount, unitCode,
      unitLabel: unitCode === 'page' ? '枚' : '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
    // Jev comparison holdout, Luna-only arm: the option plus the same change again as a patch (hold-remaining-completed r1)
    // or as a removal (hold-two-keep-pages r2/r3). Each would change one fact twice.
    const replays = [
      { seed: [task, work('total', 'scope_total', 20), work('done', 'completed', 12), work('left', 'remaining', 7)],
        optionId: () => 'completed_follows_remaining', path: 'patch[0]',
        restate: (input: WeeklyPlanningVNextInterpretationInput): Partial<VNextTurnDelta> => ({ patch: [{ kind: 'workload', localId: 'completed_follows_remaining',
          targetFactId: input.state.graph.workloads.find((w) => w.quantityRole === 'completed')!.id, amountDelta: null,
          changes: { amount: 13, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] }) },
      { seed: [task, work('p', 'remaining', 10), work('m', 'remaining', 45, 'minute')],
        optionId: (input: WeeklyPlanningVNextInterpretationInput) => input.presentedQuestion!.options.find((o) => o.optionId.startsWith('keep:') && o.value === 10)!.optionId,
        path: 'remove[0]',
        restate: (input: WeeklyPlanningVNextInterpretationInput): Partial<VNextTurnDelta> => ({ remove: [{ targetFactId: input.state.graph.workloads.find((w) => w.unitCode === 'minute')!.id }] }) },
    ];
    for (const replay of replays) {
      const both = harness([interpreted({ add: replay.seed }),
        (input) => interpreted(replay.restate(input), { kind: 'option', optionId: replay.optionId(input) })]);
      await turn(both.ports, 't1', 'seed');
      const before = both.slots.get('vnext');
      expect(await turn(both.ports, 't2', 'answer')).toMatchObject({ outcome: 'rejected', errors: [expect.objectContaining({ path: replay.path })] });
      expect(JSON.parse(both.slots.get('vnext')!).vnext.state).toEqual(JSON.parse(before!).vnext.state);
      // Control: the option alone commits its change once.
      const once = harness([interpreted({ add: replay.seed }), (input) => interpreted({}, { kind: 'option', optionId: replay.optionId(input) })]);
      await turn(once.ports, 't1', 'seed');
      expect(await turn(once.ports, 't2', 'answer')).toMatchObject({ outcome: 'applied', errors: [] });
    }
  });

  it('places work after an existing plan, with the same oracle as the Stable V5 scheduler test', async () => {
    // semantic/weeklyPlanningStableV5PreviewScheduler.test.ts: a 09:00–10:00 plan → 60 minutes of work from 10:20.
    const existing: Plan = { id: 'plan-1', seriesId: 'series-1', userId: 'owner-1', title: '既存予定', subject: '', date: '2026-11-02',
      startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'other',
      memo: '', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' };
    const minutes: VNextAddFact = { kind: 'workload', localId: 'w', taskRef: { localId: 'slides' }, componentRef: null, quantityRole: 'remaining',
      amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null };
    const free = harness([interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: '部屋の掃除' }, minutes] })]);
    expect((await turn(free.ports, 't1', '部屋の掃除を60分')).preview!.blocks[0]).toMatchObject({ date: '2026-11-02', startTime: '09:00' });
    const busy = harness([interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: '部屋の掃除' }, minutes] })]);
    busy.ports.calendar = () => ({ plans: [existing], actuals: [], monthEvents: [], scheduleTemplates: [] });
    expect((await turn(busy.ports, 't1', '部屋の掃除を60分')).preview!.blocks[0]).toMatchObject({ date: '2026-11-02', startTime: '10:20', endTime: '11:20' });
  });

  it('explains each result through the Stable V5 renderer with what VNext decided, and treats a failed render as V5 does', async () => {
    const task = { kind: 'task' as const, localId: 'slides', category: 'study' as const, title: 'ゼミ資料' };
    const remaining7 = { ...pages('total', 'scope_total', 20), localId: 'left', quantityRole: 'remaining' as const, amount: 7 } as VNextAddFact;
    // Estimate question about derived work: the renderer is told 8 pages (20 − 12), not the stated total.
    const asked = harness([interpreted({ add: [task, pages('total', 'scope_total', 20), pages('done', 'completed', 12)] })]);
    await turn(asked.ports, 't1', 'ゼミ資料は20枚で12枚できた');
    expect(asked.rendered[0]).toMatchObject({ actionKind: 'question', questionCode: 'missing_effort_estimate', currentUserMessage: 'ゼミ資料は20枚で12枚できた',
      questionIntent: { kind: 'effort_measurement', amount: 8, unitLabel: '枚', quantityRole: 'remaining' } });
    expect(asked.rendered[0].requiredLabels).toContain('ゼミ資料');
    // A VNext-only option question: clarification, with every option label required in the text.
    const options = harness([interpreted({ add: [task, pages('total', 'scope_total', 20), pages('done', 'completed', 12), remaining7] })]);
    await turn(options.ports, 't1', '20枚で12枚できて残り7枚');
    expect(options.rendered[0]).toMatchObject({ questionCode: 'remaining_inconsistent',
      questionIntent: { kind: 'resolution_question', resolutionKind: 'semantic_clarification', ambiguityField: 'remaining_inconsistent' } });
    expect(options.rendered[0].requiredLabels).toEqual(expect.arrayContaining(['残りを8枚にする', '終わった量を13枚にする']));
    // After the task with that work is renamed, the asked work still reaches its (current) task (Astra VP03).
    const renamed = harness([interpreted({ add: [{ ...task, title: '数学' }, pages('total', 'scope_total', 20), pages('done', 'completed', 12)] }),
      (input) => interpreted({ patch: [{ kind: 'task', localId: 'rename', targetFactId: input.state.graph.tasks[0].id,
        changes: { category: null, title: '英語' } }] })]);
    await turn(renamed.ports, 't1', '数学は20枚で12枚できた');
    expect((await turn(renamed.ports, 't2', '数学じゃなくて英語でした')).question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 8 } });
    expect(renamed.rendered[1].questionIntent).toMatchObject({ kind: 'effort_measurement', amount: 8 });
    expect(renamed.rendered[1].requiredLabels).toContain('英語');
    // A failed render: V5's notice, and the question counts as not shown, so the next words are not bound to it.
    const failed = harness([interpreted({ add: [task, pages('total', 'scope_total', 20), pages('done', 'completed', 12)] }),
      (input) => { expect(input.presentedQuestion).toBeNull(); return interpreted({}, { kind: 'estimate_minutes', minutes: 120, per: 'whole_work' }); }]);
    failed.ports.createRenderer = () => ({ render: async () => ({ status: 'fallback', reason: 'provider_error', rawResponse: null }) });
    const unseen = await turn(failed.ports, 't1', 'ゼミ資料は20枚で12枚できた');
    expect(unseen).toMatchObject({ reply: RENDERER_TECHNICAL_STOP, replySource: 'renderer_fallback', question: { code: 'missing_effort_estimate' } });
    expect(JSON.parse(failed.slots.get('vnext')!).vnext.presentedQuestion).toBeNull();
    expect(await turn(failed.ports, 't2', '2時間')).toMatchObject({ outcome: 'answer_represented', appliedDelta: null });
    // A preview: the save control is required; if rendering fails the preview stays and the reply says it is unsaved.
    const minutes: VNextAddFact = { kind: 'workload', localId: 'w', taskRef: { localId: 'slides' }, componentRef: null, quantityRole: 'remaining',
      amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null };
    const previewed = harness([interpreted({ add: [task, minutes] }), interpreted({})]);
    await turn(previewed.ports, 't1', 'ゼミ資料を60分');
    expect(previewed.rendered[0]).toMatchObject({ actionKind: 'preview_ready', previewCount: 1, previewPromotionControlLabel: WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL });
    previewed.ports.createRenderer = () => ({ render: async (input) => { previewed.rendered.push(input); return { status: 'fallback', reason: 'invalid_json', rawResponse: '' }; } });
    const kept = await turn(previewed.ports, 't2', 'うーん');
    expect(kept).toMatchObject({ reply: RENDERER_PREVIEW_CONTINGENCY, replySource: 'renderer_fallback' });
    expect(JSON.parse(previewed.slots.get('vnext')!).vnext.preview.previewId).toBe(kept.preview!.previewId);
    // The renderer reads the recent conversation the checkpoint keeps.
    expect(previewed.rendered[1].recentConversation).toEqual([{ role: 'user', content: 'ゼミ資料を60分' }, { role: 'assistant', content: '（説明 preview_ready）' }]);
  });

  it('a failure notice never becomes the presented question; the question shown before stays bound (user audit S01)', async () => {
    const seed = interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' }, pages('total', 'scope_total', 20), pages('done', 'completed', 12)] });
    const failedReading: WeeklyPlanningVNextInterpretation = { status: 'failed', reason: 'provider_error', errors: [], metrics };
    const negative = (input: WeeklyPlanningVNextInterpretationInput) => interpreted({ patch: [{ kind: 'workload', localId: 'edit',
      targetFactId: input.state.graph.workloads[0].id, amountDelta: null, changes: { amount: -1, quantityRole: null, unitCode: null,
        unitLabel: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] });
    for (const failure of [failedReading, negative]) {
      const h = harness([seed, failure, (input) => {
        expect(input.presentedText).toBe('（説明 question）');
        return interpreted({}, { kind: 'estimate_minutes', minutes: 120, per: 'whole_work' });
      }]);
      const asked = await turn(h.ports, 't1', 'ゼミ資料は20枚で12枚できた');
      const shown = JSON.parse(h.slots.get('vnext')!).vnext.presentedQuestion;
      expect(shown).toMatchObject({ shownText: '（説明 question）' });
      const notice = await turn(h.ports, 't2', '…');
      expect(notice).toMatchObject({ replySource: 'system', graphRevision: asked.graphRevision });
      expect(JSON.parse(h.slots.get('vnext')!).vnext.presentedQuestion).toEqual(shown);
      expect(await turn(h.ports, 't3', '2時間')).toMatchObject({ outcome: 'applied' });
    }
  });

  it('a failed turn is recovered as Stable V5 does: a verified reply re-asks the question still shown, otherwise a notice', async () => {
    const seed = interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' }, pages('total', 'scope_total', 20), pages('done', 'completed', 12)] });
    const failedReading: WeeklyPlanningVNextInterpretation = { status: 'failed', reason: 'provider_error', errors: [], metrics };
    const recovering = (verified: boolean) => (h: ReturnType<typeof harness>) => {
      h.ports.createRenderer = ({ canDispatchRecovery }) => ({ async render(input) {
        h.rendered.push(input);
        if (!input.recovery) return { status: 'rendered', text: `（説明 ${input.actionKind}）`, rawResponse: '' };
        expect(canDispatchRecovery()).toBe(true);
        return verified ? { status: 'rendered', text: '（回復して問い直す）', rawResponse: '', recoveryVerified: true }
          : { status: 'fallback', reason: 'recovery_verification_failed', rawResponse: '' };
      } });
    };
    // Verified: the reply says nothing was applied and asks the shown question again; that reply is now what binds.
    const ok = harness([seed, failedReading, interpreted({}, { kind: 'estimate_minutes', minutes: 120, per: 'whole_work' })]);
    recovering(true)(ok);
    const asked = await turn(ok.ports, 't1', 'ゼミ資料は20枚で12枚できた');
    const before = JSON.parse(ok.slots.get('vnext')!).vnext;
    const recovered = await turn(ok.ports, 't2', '…');
    expect(ok.rendered[1]).toMatchObject({ actionKind: 'question', questionCode: 'missing_effort_estimate', fallbackText: '', previewCount: 0,
      currentTurnGrounding: { mode: 'none', acceptedFacts: [] },
      recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true, retainedPreviewUnchanged: false },
      recoveryQuestionEvidence: expect.objectContaining({ labels: expect.arrayContaining(['ゼミ資料']) }) });
    expect(recovered).toMatchObject({ outcome: 'interpretation_failed', replySource: 'renderer_recovery', reply: '（回復して問い直す）',
      graphRevision: asked.graphRevision });
    const after = JSON.parse(ok.slots.get('vnext')!).vnext;
    expect(after.state).toEqual(before.state);
    expect(after.presentedQuestion).toEqual({ ...before.presentedQuestion, shownText: '（回復して問い直す）' });
    expect(await turn(ok.ports, 't3', '2時間')).toMatchObject({ outcome: 'applied' });
    // Unverified: the fixed notice, and the earlier shown question stays bound.
    const notVerified = harness([seed, failedReading]);
    recovering(false)(notVerified);
    await turn(notVerified.ports, 't1', 'ゼミ資料は20枚で12枚できた');
    const shown = JSON.parse(notVerified.slots.get('vnext')!).vnext.presentedQuestion;
    expect(await turn(notVerified.ports, 't2', '…')).toMatchObject({ replySource: 'system' });
    expect(JSON.parse(notVerified.slots.get('vnext')!).vnext.presentedQuestion).toEqual(shown);
    // Another tab saves while the recovery reply is being made: nothing of this turn is written.
    const raced = harness([seed, failedReading]);
    await turn(raced.ports, 't1', 'ゼミ資料は20枚で12枚できた');
    raced.ports.createRenderer = ({ canDispatchRecovery }) => ({ async render() {
      raced.slots.set('vnext', 'bytes another tab saved');
      expect(canDispatchRecovery()).toBe(false);
      return { status: 'rendered', text: 'x', rawResponse: '', recoveryVerified: true };
    } });
    expect(await turn(raced.ports, 't2', '…')).toMatchObject({ outcome: 'stale' });
    expect(raced.slots.get('vnext')).toBe('bytes another tab saved');
  });

  it('a correction before approval replaces the shown preview, so the old preview cannot be saved', async () => {
    const h = harness([
      interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' }, pages('total', 'scope_total', 20), pages('done', 'completed', 12)] }),
      interpreted({}, { kind: 'estimate_minutes', minutes: 120, per: 'whole_work' }),
      (input) => interpreted({ patch: [{
        kind: 'workload', localId: 'fix', targetFactId: input.state.graph.workloads.find((w) => w.quantityRole === 'completed')!.id, amountDelta: null,
        changes: { amount: 14, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null },
      }] }),
    ]);
    await turn(h.ports, 't1', 'ゼミ資料は20枚で12枚できた');
    const ready = await turn(h.ports, 't2', '2時間');
    expect(ready.preview).not.toBeNull();
    const corrected = await turn(h.ports, 't3', 'あ、14枚できてた');
    // The old total was for 8 pages; 6 pages are asked again instead of reusing it.
    expect(corrected).toMatchObject({ outcome: 'applied', preview: null, question: { code: 'missing_effort_estimate', forWork: { amount: 6 } } });
    expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports })).toEqual({ status: 'rejected', reason: 'no-shown-preview' });
    expect(h.saved.size).toBe(0);
  });

  it('an answer to a question that is no longer shown is not applied; failures leave the checkpoint unchanged', async () => {
    const h = harness([
      interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' }, pages('total', 'scope_total', 20)] }),
      interpreted({}, { kind: 'option', optionId: 'not-an-option' }),
      { status: 'failed', reason: 'rejected_after_repair', errors: [], metrics: { calls: 2, repairs: 1, latencyMs: 2 } },
    ]);
    const first = await turn(h.ports, 't1', 'ゼミ資料20枚');
    const before = h.slots.get('vnext');
    const represented = await turn(h.ports, 't2', 'それで');
    expect(represented).toMatchObject({ outcome: 'answer_represented', graphRevision: first.graphRevision });
    const failed = await turn(h.ports, 't3', '？？？');
    expect(failed).toMatchObject({ outcome: 'interpretation_failed', graphRevision: first.graphRevision });
    expect(readWeeklyPlanningVNextExperimentalSession(scope, h.ports)).toMatchObject({ checkpoint: { state: JSON.parse(before!).vnext.state } });
  });

  it('keeps the shown preview while its revision is current, so approval saves exactly what was shown', async () => {
    const minutes: VNextAddFact = { kind: 'workload', localId: 'w', taskRef: { localId: 'slides' }, componentRef: null, quantityRole: 'remaining',
      amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null };
    const h = harness([interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' }, minutes] }), interpreted({})]);
    const shown = await turn(h.ports, 't1', 'ゼミ資料を60分');
    // Later, on the same revision, nothing changes: the time of day moved, but the shown preview is not made again.
    const later = await submitWeeklyPlanningVNextExperimentalTurn({ scope: { ...scope, notBeforeTime: '14:00' }, ports: h.ports, turnId: 't2', userText: 'うーん', shownRevision: shown.graphRevision });
    expect(later).toMatchObject({ outcome: 'noop', graphRevision: shown.graphRevision });
    expect(later.preview).toEqual(shown.preview);
    await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports });
    expect([...h.saved.values()].map((block) => block.startTime)).toEqual(shown.preview!.blocks.map((block) => block.startTime));
  });

  it('writes nothing when another turn saved while the model was reading', async () => {
    const h = harness([]);
    const releases: Array<() => void> = [];
    h.ports.interpret = (input) => new Promise((resolve) => releases.push(() => resolve(interpreted({ add: [
      { kind: 'task', localId: 'x', category: 'study', title: input.userText },
    ] }))));
    const first = turn(h.ports, 't1', '英語');
    const second = turn(h.ports, 't2', '数学');
    releases[0]();
    expect(await first).toMatchObject({ outcome: 'applied', graphRevision: 1 });
    const savedAfterFirst = h.slots.get('vnext');
    releases[1]();
    expect(await second).toMatchObject({ outcome: 'stale', appliedDelta: null });
    expect(h.slots.get('vnext')).toBe(savedAfterFirst);
    const read = readWeeklyPlanningVNextExperimentalSession(scope, h.ports);
    expect(read.status === 'ready' && read.checkpoint.state.graph.tasks.map((task) => task.title)).toEqual(['英語']);
  });

  it('keeps the range V5 accepted for a relative planning window when the conversation is resumed on a later day (Astra VP04)', async () => {
    const source = (id: string) => ({ conversationId: scope.conversationId, turnId: 'v5', semanticLocalId: id, sourceText: '来週', origin: 'user' as const });
    const active = (factId: string) => ({ factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    const graph: WeeklyPlanningFactGraphV5 = {
      ...createEmptyWeeklyPlanningFactGraphV5(), revision: 3,
      planningWindows: [{ id: 'pw', kind: 'relative_week', value: 'next_week', start: null, end: null, createdRevision: 1, source: source('pw') }],
      tasks: [{ id: 'task-1', category: 'study', title: '英単語', createdRevision: 1, source: source('task-1') }],
      workloads: [{ id: 'w', taskId: 'task-1', componentId: null, quantityRole: 'remaining', amount: 60, unitCode: 'minute', unitLabel: '分',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, createdRevision: 1, source: source('w') }],
      factLifecycles: [active('pw'), active('task-1'), active('w')],
    };
    const prepared = prepareWeeklyPlanningStableV5Checkpoint({ ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId,
      graph, planningState: { ...createInitialPlanningState(scope.weekStartDate), intakeState: createInitialPlanningIntakeState() } });
    if (prepared.status !== 'ready' || !prepared.planningState.intakeState) throw new Error(prepared.status);
    // On Nov 2, V5 accepted "next week" as Nov 9–15.
    prepared.planningState.intakeState.groundingRecords = [{ id: 'g', targetFactId: 'pw', interpretationKind: 'relative_date_resolution',
      status: 'continuation_accepted', sourceExpression: 'next_week', startDate: '2026-11-09', endDate: '2026-11-15', proposedAtTurnId: 't0', acceptedAtTurnId: 't1' }];
    const v5Raw = serializeWeeklyPlanningStableV5CheckpointWithMessageCount({ ownerId: scope.ownerId, weekStartDate: scope.weekStartDate,
      conversationId: scope.conversationId, graph, planningState: prepared.planningState, savedAt: '2026-11-02T08:00:00.000Z', messageCount: 0 })!;
    const h = harness([interpreted({})], { legacyV5: v5Raw });
    const resumedScope = { ...scope, clock: { ...scope.clock, currentDate: '2026-11-09' } };
    const migrated = readWeeklyPlanningVNextExperimentalSession(resumedScope, h.ports);
    if (migrated.status !== 'ready') throw new Error(migrated.status);
    const before = structuredClone(migrated.checkpoint.state.graph);
    const resumed = await submitWeeklyPlanningVNextExperimentalTurn({ scope: resumedScope,
      ports: h.ports, turnId: 't1', userText: 'お願いします', shownRevision: null });
    expect(resumed).toMatchObject({ outcome: 'applied', graphRevision: before.revision + 1 });
    const after = readWeeklyPlanningVNextExperimentalSession(resumedScope, h.ports);
    if (after.status !== 'ready') throw new Error(after.status);
    // Only the newly approvable preview is versioned; all migrated facts/dates stay exactly as accepted.
    expect(after.checkpoint.state.graph).toEqual({ ...before, revision: before.revision + 1,
      appliedTurnKeys: [...before.appliedTurnKeys, `${scope.conversationId}:t1`] });
    expect(resumed.preview!.blocks[0].date).toBe('2026-11-09');
    expect(h.slots.get('v5')).toBe(v5Raw);
  });

  it('migrates a saved V5 checkpoint without writing it, and refuses unreadable bytes without overwriting them', async () => {
    const graph: WeeklyPlanningFactGraphV5 = {
      ...createEmptyWeeklyPlanningFactGraphV5(), revision: 3,
      tasks: [{ id: 'task-1', category: 'study', title: '英単語', createdRevision: 1,
        source: { conversationId: scope.conversationId, turnId: 'v5', semanticLocalId: 'task-1', sourceText: '英単語', origin: 'user' } }],
      factLifecycles: [{ factId: 'task-1', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }],
    };
    const prepared = prepareWeeklyPlanningStableV5Checkpoint({
      ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId, graph,
      planningState: { ...createInitialPlanningState(scope.weekStartDate),
        intakeState: { ...createInitialPlanningIntakeState(), draftGenerationIntent: 'user_authorized' } },
    });
    if (prepared.status !== 'ready') throw new Error(prepared.status);
    const v5Raw = serializeWeeklyPlanningStableV5CheckpointWithMessageCount({
      ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId, graph,
      planningState: prepared.planningState, savedAt: '2026-11-02T08:00:00.000Z', messageCount: 0,
    })!;
    const h = harness([(input) => interpreted({ add: [{
      kind: 'workload', localId: 'w', taskRef: { factId: input.state.graph.tasks[0].id }, componentRef: null, quantityRole: 'remaining',
      amount: 30, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
    }] })], { legacyV5: v5Raw });

    expect(readWeeklyPlanningVNextExperimentalSession(scope, h.ports)).toMatchObject({ source: 'migrated_v5',
      checkpoint: { state: { draftGenerationIntent: 'user_authorized', graph: { revision: 4 } } } });
    const migrated = await turn(h.ports, 't1', '英単語を30分');
    expect(migrated).toMatchObject({ outcome: 'applied', readiness: 'ready' });
    expect(migrated.preview).not.toBeNull();
    // Rollback: the V5 slot is byte-identical and still reads as the same V5 graph.
    expect(h.slots.get('v5')).toBe(v5Raw);
    expect(parseWeeklyPlanningStableV5PersistedSession({ raw: h.slots.get('v5')!, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate })?.graph).toEqual(graph);

    const broken = harness([interpreted({})]);
    broken.slots.set('vnext', '{"version":"other"}');
    expect(await turn(broken.ports, 't1', 'こんにちは')).toMatchObject({ outcome: 'checkpoint_unreadable' });
    expect(broken.inputs).toHaveLength(0);
    expect(broken.slots.get('vnext')).toBe('{"version":"other"}');
  });
});
