import { describe, expect, it } from 'vitest';
// @ts-expect-error The e2e support module is plain ESM without declarations.
import { scriptedReading } from '../../../../../tests/e2e/support/vnext-scripted-readings.mjs';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanDraftBlock } from '../../types';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { buildWeeklyPlanningPlanSourceId } from '../../planning/weeklyPlanningPlanProvenance';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const OWNER = 'synthetic-smoke-owner'; const WEEK = '2026-08-17'; const TARGET = '2026-08-20'
const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: OWNER, weekStartDate: WEEK,
  conversationId: 'registration-conversation', notBeforeTime: '09:00', clock: { currentDate: '2026-08-19',
    weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-08-23' } };
type Context = { activeFacts: { tasks: { id: string; title: string }[]; temporalConstraints: { id: string }[];
  workloads: { id: string }[] }; presentedQuestion: unknown };

function harness(responses: Array<unknown | ((context: Context) => unknown)>, failAt?: number, options: { savedAsPlans?: boolean } = {}) {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
  const slots = new Map<string, string>();
  const saved = new Map<string, WeeklyPlanDraftBlock>();
  const rendererInputs: unknown[] = [];
  let calls = 0; let saves = 0; let sequence = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = { checkpoint: local.checkpoint, legacyV5Checkpoint: { read: () => slots.get('v5') ?? null },
    interpret: createWeeklyPlanningVNextProviderInterpreter(), client: { async createChatCompletion(input) {
      calls++; if (!responses.length) throw new Error('synthetic script exhausted');
      const next = responses.shift(); return JSON.stringify(typeof next === 'function' ? next(JSON.parse(input.messages[1].content)) : next);
    } }, approvalLedger: { read: () => slots.get('ledger') ?? null, write: raw => { slots.set('ledger', raw); } },
    plans: { findExistingPlanId: async id => saved.has(id) ? `plan:${id}` : undefined,
      async saveBlock(block) { if (++saves === failAt) throw new Error('synthetic save failure'); saved.set(block.id, block); return { planId: `plan:${block.id}` }; } },
    // With savedAsPlans the calendar holds the plans approval saved, each carrying the draft block id it came from.
    calendar: () => ({ plans: options.savedAsPlans ? [...saved.values()].map(block => ({ id: `plan:${block.id}`, seriesId: `plan:${block.id}`,
      userId: OWNER, title: block.title, subject: block.subject, type: 'study' as const, date: block.date, startTime: block.startTime, endTime: block.endTime,
      memo: '', recurrence: null, recurrenceRules: [], excludedDates: [], createdAt: block.createdAt, updatedAt: block.updatedAt, sourceType: 'weekly-planning' as const,
      sourceId: buildWeeklyPlanningPlanSourceId({ approvalOperationId: 'op-1', sourceDraftBlockId: block.id }) })) as never : [],
      actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => `${WEEK}T00:00:00.000Z`,
    createRenderer: () => ({ async render(input) { rendererInputs.push(input);
      return { status: 'rendered', text: '合成の候補説明', rawResponse: '' }; } }),
  };
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText,
    turnId: `turn-${++sequence}`, shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null });
  const state = () => local.readCheckpoint()!.vnext.state;
  return { turn, local, memory, ports, slots, saved, state, rendererInputs, calls: () => calls, saves: () => saves };
}


// The emulator's synthetic provider (tests/e2e/emulator/vnext-production.emulator.mjs) answers the production flows'
// turns from these readings. Each must do through the real VNext session what its flow asserts in the browser, and make
// exactly the one reading plus one renderer call the hook waits for.
describe('scripted readings of the VNext production flows', () => {
  const script = (turns: Array<{ kind: string; title: string }>) => harness(turns.map(({ kind, title }) =>
    (context: Context) => scriptedReading(kind, { title, date: TARGET }, context)));

  it('consultation: stored, no plan, no preview', async () => {
    const h = script([{ kind: 'consultation', title: 'x' }]);
    const result = await h.turn('英語の勉強法を相談したい');
    expect(result.preview ?? null).toBeNull(); expect(h.rendererInputs).toHaveLength(1); expect(h.calls()).toBe(1);
    expect(h.local.readCheckpoint()).not.toBeNull();
  });

  it('registration: a fixed-event registration preview on the target day, nothing saved', async () => {
    const h = script([{ kind: 'registration', title: '部活' }]);
    const result = await h.turn('8月20日の10:30から12:00まで部活があります。その予定を登録したいです。');
    expect(result.preview?.blocks.map(block => [block.date, block.startTime, block.endTime])).toEqual([[TARGET, '10:30', '12:00']]);
    expect(result.draftCandidates?.map(candidate => candidate.source)).toEqual(['fixed_event_registration']);
    expect(h.rendererInputs).toHaveLength(1); expect(h.calls()).toBe(1); expect(h.saves()).toBe(0);
  });

  it('registration outside the planner week yields no preview (the production observation that needed this contract)', async () => {
    const h = harness([(context: Context) => scriptedReading('registration', { title: '部活', date: '2026-10-14' }, context)]);
    const result = await h.turn('10月14日の10:30から12:00まで部活があります。その予定を登録したいです。');
    expect(result.preview ?? null).toBeNull(); expect(result.draftCandidates ?? []).toEqual([]);
  });

  it('plan then correction: 90 minutes on the target day, corrected to 60, one renderer call per turn', async () => {
    const h = script([{ kind: 'plan', title: 'E2E-読書' }, { kind: 'correction', title: 'E2E-読書' }]);
    const first = await h.turn('8月20日の夜に「E2E-読書」を合計90分したいです。計画案を作ってください。');
    expect(first.preview?.blocks.map(block => [block.title, block.date])).toEqual([['E2E-読書 90分', TARGET]]);
    const second = await h.turn('訂正です。「E2E-読書」は合計60分にしてください。');
    const minutes = (second.preview?.blocks ?? []).reduce((sum, block) => sum
      + (Number(block.endTime.slice(0, 2)) * 60 + Number(block.endTime.slice(3))) - (Number(block.startTime.slice(0, 2)) * 60 + Number(block.startTime.slice(3))), 0);
    expect(minutes).toBe(60); expect(second.preview?.blocks.every(block => block.date === TARGET)).toBe(true);
    expect(h.rendererInputs).toHaveLength(2); expect(h.calls()).toBe(2);
  });
});
