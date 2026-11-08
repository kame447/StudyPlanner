// #1116 x #1125 (xfeature.md, 1f), observed through the real session: the real provider AND the real renderer. "Provisional for all of
// them" is said while the presented question is a duplicate_quantity question, which cannot take a timebox. Deterministically the
// provider's dry run rejects the reading (`defer[0].allocation`) and one repair follows. This records what the real model does
// (repairs, the repaired defer, the final outcome and the reply). Synthetic conversations only, no user data. Observation, not a
// gate: nothing about the model's behavior is asserted. Runs only in the real-API profile that names it (`-t 'xf1f-'`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { getAiConfig } from '../../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningStableV5DialogueRendererCore, type WeeklyPlanningStableV5DialogueRenderInput } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import type { WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact } from '../weeklyPlanningVNextTypes';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = `${process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR ?? 'artifacts/issue156-real-api'}/vnext-xf1f`;
const run = shouldRun ? describe : describe.skip;

const DEFER_ALL = 'どれも時間は分からないから、仮でいいから全部入れて';
// The same works; only xf1f-defer-all-dup-first states the English total twice, so a duplicate_quantity question is presented first.
const CASES = [
  { id: 'xf1f-defer-all-dup-first', duplicate: true },
  { id: 'xf1f-control', duplicate: false },
];

const page = (localId: string, task: string, role: 'scope_total' | 'target', amount: number): VNextAddFact => ({ kind: 'workload', localId, taskRef: { localId: task },
  componentRef: null, quantityRole: role, amount, unitCode: 'custom', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });

function seedFor(duplicate: boolean): WeeklyPlanningVNextInterpretation {
  return { status: 'interpreted', planningIntent: 'discuss', answer: null, metrics: { calls: 1, repairs: 0, latencyMs: 0 },
    delta: { add: [task('english', '英語'), page('english-total', 'english', 'scope_total', 20),
      ...(duplicate ? [page('english-total-again', 'english', 'scope_total', 20)] : []),
      task('math', '数学'), page('math-work', 'math', 'target', 15), task('physics', '物理'), page('physics-work', 'physics', 'target', 10)],
    patch: [], remove: [], relate: [], defer: [] } };
}

function scopeFor(id: string): WeeklyPlanningVNextExperimentalScope {
  return { ownerId: 'xf1f-owner', weekStartDate: '2026-11-02', conversationId: id, notBeforeTime: '09:00',
    clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' } };
}

/** Turn 1 is a fixed (scripted) reading that sets the state up; turn 2 is the real provider. The renderer is real for both. */
function createPorts(seed: WeeklyPlanningVNextInterpretation) {
  const slots = new Map<string, string>();
  const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => void slots.set(key, raw) });
  const client = createOpenAiCompatibleClient(getAiConfig());
  const real = createWeeklyPlanningVNextProviderInterpreter();
  let seeded = false;
  const renders: Array<{ actionKind: string; questionCode: string | null; status: string; text: string | null }> = [];
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client,
    interpret: async input => { if (!seeded) { seeded = true; return seed; } return real(input); },
    checkpoint: slot('vnext'), legacyV5Checkpoint: { read: () => null }, approvalLedger: slot('ledger'),
    plans: { async findExistingPlanId() { return undefined; }, async saveBlock() { throw new Error('unexpected Plan save'); } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    createRenderer: options => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore(client, options);
      return { async render(input: WeeklyPlanningStableV5DialogueRenderInput) {
        const result = await renderer.render(input);
        renders.push({ actionKind: input.actionKind, questionCode: input.questionCode, status: result.status, text: result.status === 'rendered' ? result.text : null });
        return result;
      } };
    },
    now: () => new Date().toISOString(),
  };
  return { ports, renders };
}

const records: Record<string, unknown>[] = [];
afterAll(() => { if (records.length) { mkdirSync(outputDir, { recursive: true }); writeFileSync(`${outputDir}/summary.json`, `${JSON.stringify(records, null, 2)}\n`); } });

run('#1116 x #1125 (1f): "provisional for all of them" while a duplicate_quantity question is presented (real provider and real renderer)', () => {
  it.each(CASES)('$id', async scenario => {
    const scope = scopeFor(scenario.id);
    const { ports, renders } = createPorts(seedFor(scenario.duplicate));
    const first = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: `${scenario.id}-1`, userText: '英語、数学、物理を勉強したいです。', shownRevision: null });
    const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: `${scenario.id}-2`, userText: DEFER_ALL, shownRevision: first.graphRevision });
    const interpretation = turn.interpretation;
    const failed = interpretation?.status === 'failed' ? interpretation : null;
    const record = { id: scenario.id, user: DEFER_ALL, presentedBefore: first.question?.code ?? null, outcome: turn.outcome, readiness: turn.readiness,
      questionAfter: turn.question?.code ?? null, preview: turn.preview ? { blocks: turn.preview.blocks.length } : null, replySource: turn.replySource, reply: turn.reply,
      interpretation: { status: interpretation?.status ?? null, reason: failed?.reason ?? null, errors: failed?.errors ?? [], metrics: interpretation?.metrics ?? null },
      appliedDefer: turn.appliedDelta?.defer ?? null, errors: turn.errors, renders: [...renders] };
    records.push(record);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}/${scenario.id}.json`, `${JSON.stringify(record, null, 2)}\n`);
    // Only that the turn ran and the setup is as intended: what the model did is observed, not asserted.
    expect(first.question?.code).toBe(scenario.duplicate ? 'duplicate_quantity' : 'missing_effort_estimate');
    expect(turn.reply.length).toBeGreaterThan(0);
  }, 600_000);
});
