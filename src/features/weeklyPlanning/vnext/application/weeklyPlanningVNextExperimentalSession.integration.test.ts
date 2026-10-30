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
import type { WeeklyPlanDraftBlock } from '../../types';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import type {
  WeeklyPlanningVNextInterpretation,
  WeeklyPlanningVNextInterpretationInput,
} from '../weeklyPlanningVNextInterpretationContract';
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
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' },
  notBeforeTime: '09:00',
};
const metrics = { calls: 1, repairs: 0, latencyMs: 1 };
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const interpreted = (delta: Partial<VNextTurnDelta>, answer: Extract<WeeklyPlanningVNextInterpretation, { status: 'interpreted' }>['answer'] = null):
  WeeklyPlanningVNextInterpretation => ({ status: 'interpreted', delta: { ...EMPTY, ...delta }, answer, metrics });
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
    now: () => '2026-11-02T09:00:00.000Z',
  };
  return { ports, slots, saved, inputs, saveCalls: () => saveCalls };
}

const turn = (ports: WeeklyPlanningVNextExperimentalPorts, turnId: string, userText: string) =>
  submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId, userText });

describe('VNext experimental session end to end (offline)', () => {
  it('asks, binds the answer to the asked work, previews, saves partially, resumes, and never saves twice', async () => {
    const h = harness([
      interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' }, pages('total', 'scope_total', 20), pages('done', 'completed', 12)] }),
      interpreted({}, { kind: 'estimate_minutes', minutes: 120 }),
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

  it('a correction before approval replaces the shown preview, so the old preview cannot be saved', async () => {
    const h = harness([
      interpreted({ add: [{ kind: 'task', localId: 'slides', category: 'study', title: 'ゼミ資料' }, pages('total', 'scope_total', 20), pages('done', 'completed', 12)] }),
      interpreted({}, { kind: 'estimate_minutes', minutes: 120 }),
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

  it('migrates a saved V5 checkpoint without writing it, and refuses unreadable bytes without overwriting them', async () => {
    const graph: WeeklyPlanningFactGraphV5 = {
      ...createEmptyWeeklyPlanningFactGraphV5(), revision: 3,
      tasks: [{ id: 'task-1', category: 'study', title: '英単語', createdRevision: 1,
        source: { conversationId: scope.conversationId, turnId: 'v5', semanticLocalId: 'task-1', sourceText: '英単語', origin: 'user' } }],
      factLifecycles: [{ factId: 'task-1', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }],
    };
    const prepared = prepareWeeklyPlanningStableV5Checkpoint({
      ownerId: scope.ownerId, weekStartDate: scope.weekStartDate, conversationId: scope.conversationId, graph,
      planningState: createInitialPlanningState(scope.weekStartDate),
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

    expect(readWeeklyPlanningVNextExperimentalSession(scope, h.ports)).toMatchObject({ source: 'migrated_v5', checkpoint: { state: { graph: { revision: 4 } } } });
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
