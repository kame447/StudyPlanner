// #926 real-API end-to-end for the experimental VNext session with the native
// provider: question → answer → correction → preview → approval with a failed
// save and its resume → reload → rollback to the untouched V5 checkpoint.
// Synthetic conversation only; runs only in the `vnext` real-API profile.
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAiConfig } from '../../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClient';
import {
  parseWeeklyPlanningStableV5PersistedSession,
  prepareWeeklyPlanningStableV5Checkpoint,
  serializeWeeklyPlanningStableV5CheckpointWithMessageCount,
} from '../../application/weeklyPlanningStableV5SessionCodec';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanDraftBlock } from '../../types';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import {
  approveWeeklyPlanningVNextExperimentalPreview,
  readWeeklyPlanningVNextExperimentalSession,
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
  type WeeklyPlanningVNextExperimentalTurn,
} from './weeklyPlanningVNextExperimentalSession';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = `${process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR ?? 'artifacts/issue156-real-api'}/vnext-session-e2e`;
const run = shouldRun ? describe : describe.skip;

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'vnext-e2e-owner', weekStartDate: '2026-11-02', conversationId: 'vnext-e2e',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' },
  notBeforeTime: '09:00',
};

function createPorts(options: { legacyV5?: string; failSaveAttempt?: number } = {}) {
  const slots = new Map<string, string>();
  if (options.legacyV5) slots.set('v5', options.legacyV5);
  const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => void slots.set(key, raw) });
  const saved = new Map<string, WeeklyPlanDraftBlock>();
  let saveAttempts = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client: createOpenAiCompatibleClient(getAiConfig()),
    interpret: createWeeklyPlanningVNextProviderInterpreter(),
    checkpoint: slot('vnext'),
    legacyV5Checkpoint: { read: slot('v5').read },
    approvalLedger: slot('ledger'),
    plans: {
      async findExistingPlanId(id) { return saved.has(id) ? `plan:${id}` : undefined; },
      async saveBlock(block) {
        saveAttempts += 1;
        if (saveAttempts === options.failSaveAttempt) throw new Error('injected-save-failure');
        saved.set(block.id, block);
        return { planId: `plan:${block.id}` };
      },
    },
    now: () => new Date().toISOString(),
  };
  return { ports, slots, saved, saveAttempts: () => saveAttempts };
}

/** Typed snapshot after a turn: what the oracle compares, never the reply prose. */
function snapshot(turn: WeeklyPlanningVNextExperimentalTurn) {
  return {
    outcome: turn.outcome,
    graphRevision: turn.graphRevision,
    readiness: turn.readiness,
    question: turn.question && { code: turn.question.code, forWork: turn.question.forWork, options: turn.question.options.map((option) => option.value) },
    previewMinutes: turn.preview?.blocks.map((block) => block.startTime + '-' + block.endTime) ?? null,
    metrics: turn.interpretation?.metrics ?? null,
    interpretationStatus: turn.interpretation?.status ?? null,
    answer: turn.interpretation?.status === 'interpreted' ? turn.interpretation.answer : null,
    appliedDelta: turn.appliedDelta,
    errors: turn.errors,
    reply: turn.reply,
  };
}

function scheduledWork(ports: WeeklyPlanningVNextExperimentalPorts) {
  const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
  if (read.status !== 'ready') return null;
  return projectWeeklyPlanningVNext(read.checkpoint.state).owners.flatMap((owner) =>
    owner.work.map((work) => ({ amount: work.amount, unitCode: work.unitCode, minutes: work.minutes, basis: work.estimateBasis })));
}

run('#926 VNext native session real API end to end', () => {
  it('asks, binds the answer, re-asks after a correction, saves with a resumed partial save, reloads, and leaves V5 data intact', async () => {
    const record: Record<string, unknown> = { scope, steps: [] };
    const steps = record.steps as unknown[];
    const { ports, slots, saved, saveAttempts } = createPorts({ failSaveAttempt: 2 });
    const say = async (turnId: string, text: string) => {
      const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId, userText: text });
      steps.push({ turnId, user: text, ...snapshot(turn), work: scheduledWork(ports) });
      return turn;
    };
    try {
      const t1 = await say('t1', '今週はゼミ発表のスライドを仕上げたいです。全部で20枚で、もう12枚できています。');
      expect(t1.outcome).toBe('applied');
      expect(t1.question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 8 } });

      const t2 = await say('t2', '残りは2時間くらいだと思います');
      expect(t2.outcome).toBe('applied');
      expect(t2.question).toBeNull();
      expect(scheduledWork(ports)).toEqual([expect.objectContaining({ amount: 8, unitCode: 'page', minutes: 120 })]);
      expect(t2.preview).not.toBeNull();

      const t3 = await say('t3', 'すみません、できているのは14枚でした');
      expect(t3.outcome).toBe('applied');
      // The 2 hours were for 8 pages; 6 pages are asked again, the old total is not reused.
      expect(t3.question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 6 } });
      expect(t3.preview).toBeNull();

      const t4 = await say('t4', 'じゃあ90分で');
      expect(t4.question).toBeNull();
      expect(scheduledWork(ports)).toEqual([expect.objectContaining({ amount: 6, unitCode: 'page', minutes: 90 })]);
      const blocks = t4.preview!.blocks.length;

      const partial = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports });
      const resumed = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports });
      const again = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports });
      record.approval = { blocks, partial, resumed, again, saveAttempts: saveAttempts(), saved: [...saved.keys()] };
      if (blocks > 1) expect(partial).toMatchObject({ status: 'executed', operation: { status: 'partially_saved' } });
      expect(resumed).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
      expect(again).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
      expect(saved.size).toBe(blocks);
      expect(saveAttempts()).toBe(blocks + (blocks > 1 ? 1 : 0));

      // Reload from the stored bytes alone reproduces the session.
      const reread = readWeeklyPlanningVNextExperimentalSession(scope, { checkpoint: { read: () => slots.get('vnext') ?? null, write: () => undefined }, legacyV5Checkpoint: { read: () => null } });
      expect(reread).toMatchObject({ status: 'ready', source: 'vnext', checkpoint: { preview: t4.preview } });
    } finally {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(`${outputDir}/conversation.json`, `${JSON.stringify(record, null, 2)}\n`);
    }
  }, 600_000);

  it('continues a saved V5 conversation in VNext without writing the V5 checkpoint', async () => {
    const graph: WeeklyPlanningFactGraphV5 = {
      ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2,
      tasks: [{ id: 'task-vocab', category: 'study', title: '英単語', createdRevision: 1,
        source: { conversationId: scope.conversationId, turnId: 'v5-turn', semanticLocalId: 'task', sourceText: '英単語をやりたい', origin: 'user' } }],
      factLifecycles: [{ factId: 'task-vocab', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }],
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
    const { ports, slots } = createPorts({ legacyV5: v5Raw });
    const record: Record<string, unknown> = {};
    try {
      const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'm1', userText: '英単語は毎日じゃなくていいので、今週合計で90分やります' });
      record.turn = { ...snapshot(turn), work: scheduledWork(ports) };
      expect(turn.outcome).toBe('applied');
      expect(scheduledWork(ports)).toEqual([expect.objectContaining({ minutes: 90 })]);
      expect(slots.get('v5')).toBe(v5Raw);
      expect(parseWeeklyPlanningStableV5PersistedSession({ raw: slots.get('v5')!, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate })?.graph)
        .toEqual(graph);
    } finally {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(`${outputDir}/migrated-v5.json`, `${JSON.stringify(record, null, 2)}\n`);
    }
  }, 300_000);
});
