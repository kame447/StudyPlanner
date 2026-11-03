import { describe, expect, it } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import type { VNextAddFact } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const OWNER = 'stage-a-provider-owner';
const WEEK = '2026-11-02';
const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: OWNER, weekStartDate: WEEK, conversationId: 'stage-a-provider-conversation', notBeforeTime: '09:00',
  clock: { currentDate: WEEK, weekStartsOn: 'monday', timeZone: 'Asia/Tokyo',
    planningStartDate: WEEK, planningEndDate: '2026-11-08' },
};
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const planFacts: VNextAddFact[] = [
  { kind: 'task', localId: 'math', category: 'study', title: '数学' },
  { kind: 'workload', localId: 'math-minutes', taskRef: { localId: 'math' }, componentRef: null,
    quantityRole: 'remaining', amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null },
];
const reading = (intent: 'create_plan' | 'discuss', add: VNextAddFact[] = []) => ({
  planningIntent: intent, conversationActs: [], delta: { ...EMPTY, add }, answer: null,
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

function harness(script: Array<unknown | Error>) {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
  const savedPlans: unknown[] = [];
  let sequence = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    checkpoint: local.checkpoint, legacyV5Checkpoint: { read: () => null },
    interpret: createWeeklyPlanningVNextProviderInterpreter(),
    client: { async createChatCompletion() {
      const next = script.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('synthetic script exhausted');
      return JSON.stringify(next);
    } },
    approvalLedger: { read: () => null, write: () => { throw new Error('unexpected approval write'); } },
    plans: { findExistingPlanId: async () => undefined, async saveBlock(block) {
      savedPlans.push(block); return { planId: `plan:${block.id}` };
    } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    now: () => '2026-11-02T00:00:00.000Z',
    createRenderer: () => ({ async render() {
      return { status: 'rendered', text: '仮の予定案を確認してください。まだ保存していません。', rawResponse: '' };
    } }),
  };
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({
    scope, ports, userText, turnId: `turn-${++sequence}`,
    shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null,
  });
  const stored = () => local.readCheckpoint()!.vnext;
  return { turn, stored, rawCheckpoint: () => local.checkpoint.read(), savedPlans };
}

async function prepared(rest: Array<unknown | Error>) {
  const h = harness([reading('create_plan', planFacts), ...rest]);
  const first = await h.turn('今週の数学を60分、この条件で予定を作ってください。');
  expect(first.outcome).toBe('applied');
  expect(first.preview).not.toBeNull();
  expect(h.stored().state.graph.workloads).toHaveLength(1);
  return h;
}

describe('Stage A P1: provider failure after an unsaved VNext plan', () => {
  it('lets the next utterance reach an old Worker after a provider failure', async () => {
    const h = await prepared([new Error('synthetic provider unavailable'), reading('discuss')]);
    const failed = await h.turn('数学を90分に変えてください。');
    expect(failed.outcome).toBe('interpretation_failed');
    expect(h.stored().failureRecovery).toMatchObject({ reason: 'provider_error', consecutiveCount: 1 });
    const raw = h.rawCheckpoint();
    expect(raw).not.toBeNull();
    // The durable gateway sends these exact bytes to the Worker on the next utterance.
    expect(oldWorkerAcceptsCheckpoint(raw!)).toBe(true);
    const next = await h.turn('今の仮案を見せてください。');
    expect(next.outcome).toBe('noop');
  });

  it('keeps accepted facts and the unsaved preview, and accepts the next utterance', async () => {
    const h = await prepared([new Error('synthetic provider unavailable'), reading('discuss')]);
    const before = structuredClone(h.stored());
    const failed = await h.turn('数学を90分に変えてください。');
    expect(failed.outcome).toBe('interpretation_failed');
    expect(failed.interpretation).toMatchObject({ status: 'failed', reason: 'provider_error' });
    expect(h.stored().state.graph).toEqual(before.state.graph);
    expect(h.stored().preview).toEqual(before.preview);
    expect(h.stored().state.draftGenerationIntent).toBe('user_authorized');
    expect(failed.reply).not.toMatch(/保存しました|更新しました/u);
    expect(h.savedPlans).toEqual([]);
    const next = await h.turn('今の仮案を見せてください。');
    expect(next.outcome).toBe('noop');
    expect(next.preview).toEqual(before.preview);
    expect(h.stored().failureRecovery).toBeUndefined();
    expect(h.savedPlans).toEqual([]);
  });

  it('classifies a provider outage and does not blame the user wording', async () => {
    const h = await prepared([new Error('synthetic provider unavailable')]);
    const failed = await h.turn('数学を90分に変えてください。');
    expect(failed.interpretation).toMatchObject({ status: 'failed', reason: 'provider_error' });
    expect(failed.reply).not.toMatch(/言い方を変えて|説明し直して/u);
  });

  it('explicitly says that the failed input was not applied', async () => {
    const h = await prepared([new Error('synthetic provider unavailable')]);
    const failed = await h.turn('数学を90分に変えてください。');
    expect(failed.reply).toMatch(/今回.*(?:反映|適用).*ません/u);
  });

  it('records repeated technical failures and offers a route from retained state', async () => {
    const h = await prepared([new Error('synthetic provider unavailable'), new Error('synthetic provider unavailable')]);
    const first = await h.turn('数学を90分に変えてください。');
    const second = await h.turn('数学を90分に変えてください。');
    expect(second.outcome).toBe('interpretation_failed');
    expect(h.stored()).toMatchObject({ failureRecovery: { reason: 'provider_error', consecutiveCount: 2 } });
    expect(second.reply).not.toBe(first.reply);
    expect(second.reply).toMatch(/(?:仮|予定案|プレビュー).*確認/u);
    expect(h.stored().preview).not.toBeNull();
    expect(h.savedPlans).toEqual([]);
  });
});
