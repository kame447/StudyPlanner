// Stage B SB9 option 1 (provisional work as a typed fact for the renderer), observed through the real session: the real
// provider AND the real renderer, which the provider-only observation harness does not run. Synthetic conversations only,
// no user data. Observation, not a gate: the test records each turn and the reply, and asserts nothing about the model's
// wording (the cases run the same on a build without the fact, so the two can be compared). Runs only in the real-API
// profiles that name it (`-t 'sb9-'`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { getAiConfig } from '../../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningStableV5DialogueRendererCore, type WeeklyPlanningStableV5DialogueRenderInput } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = `${process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR ?? 'artifacts/issue156-real-api'}/vnext-provisional-reply`;
const run = shouldRun ? describe : describe.skip;
const CONTROL_LABEL = 'この内容で仮予定にする';

const CASES = [
  // The work has no estimate; the user asks to place it provisionally.
  { id: 'sb9-provisional-reply', turns: ['数学プリントを残り8枚、今週やりたいです。この内容で今週の計画を作ってください。', '時間は分からないので、仮で置いてください。'] },
  // One work provisional, the other has a stated rate: only the first is provisional.
  { id: 'sb9-mixed', turns: ['数学プリントは残り8枚、英語の単語帳は残り5ページで1ページ3分です。この内容で今週の計画を作ってください。', '数学は時間が分からないので、仮で置いてください。'] },
  // A stated estimate replaces the provisional block: the later preview must not call the work provisional.
  { id: 'sb9-replace', turns: ['数学プリントを残り8枚、今週やりたいです。この内容で今週の計画を作ってください。', '時間は分からないので、仮で置いてください。', '数学プリントは全部で40分くらいです。'] },
];

function scopeFor(id: string): WeeklyPlanningVNextExperimentalScope {
  return { ownerId: 'sb9-owner', weekStartDate: '2026-11-02', conversationId: `sb9-${id}`, notBeforeTime: '09:00',
    clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' } };
}

/** Real provider and real renderer behind the session's ports; every renderer call is recorded (typed input, status, reply). */
function createPorts() {
  const slots = new Map<string, string>();
  const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => void slots.set(key, raw) });
  const client = createOpenAiCompatibleClient(getAiConfig());
  const renders: Array<{ actionKind: string; questionCode: string | null; previewCount: number; provisionalWork: unknown; status: string; text: string | null }> = [];
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client, interpret: createWeeklyPlanningVNextProviderInterpreter(),
    checkpoint: slot('vnext'), legacyV5Checkpoint: { read: () => null }, approvalLedger: slot('ledger'),
    plans: { async findExistingPlanId() { return undefined; }, async saveBlock() { throw new Error('unexpected Plan save'); } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    createRenderer: options => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore(client, options);
      return { async render(input: WeeklyPlanningStableV5DialogueRenderInput) {
        const result = await renderer.render(input);
        renders.push({ actionKind: input.actionKind, questionCode: input.questionCode, previewCount: input.previewCount,
          // Read through a cast so the same file compiles on a build without the fact (the baseline run).
          provisionalWork: (input.communication as { provisionalWork?: unknown } | undefined)?.provisionalWork ?? null, status: result.status, text: result.status === 'rendered' ? result.text : null });
        return result;
      } };
    },
    now: () => new Date().toISOString(),
  };
  return { ports, renders };
}

/** Typed flags about one reply; the reply itself is kept for reading. The control label is removed first (it says 仮予定). */
function replyFlags(reply: string) {
  const body = reply.split(CONTROL_LABEL).join('');
  return {
    mentionsProvisional: /仮(に|置|の時間|の枠|で)/u.test(body),
    mentionsSixtyMinutes: /60分|1時間(?!半)/u.test(body),
    statesAsEstimate: /(60分|1時間)(かかる|かかります|です|になります|の見込み|と見積)/u.test(body),
    claimsSaved: /(保存|登録|承認)(しました|済み|されました|完了)/u.test(body),
  };
}

const records: Record<string, unknown>[] = [];
afterAll(() => { if (records.length) { mkdirSync(outputDir, { recursive: true }); writeFileSync(`${outputDir}/summary.json`, `${JSON.stringify(records, null, 2)}\n`); } });

run('SB9 provisional work in the reply (real provider and real renderer)', () => {
  it.each(CASES)('$id', async scenario => {
    const scope = scopeFor(scenario.id);
    const { ports, renders } = createPorts();
    const steps: unknown[] = [];
    let shownRevision: number | null = null;
    for (const [index, userText] of scenario.turns.entries()) {
      renders.length = 0;
      const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: `${scenario.id}-${index + 1}`, userText, shownRevision });
      shownRevision = turn.graphRevision;
      steps.push({ user: userText, outcome: turn.outcome, readiness: turn.readiness, question: turn.question?.code ?? null,
        preview: turn.preview ? { blocks: turn.preview.blocks.length } : null, replySource: turn.replySource,
        reply: turn.reply, flags: replyFlags(turn.reply), renders: [...renders] });
    }
    const record = { id: scenario.id, steps };
    records.push(record);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}/${scenario.id}.json`, `${JSON.stringify(record, null, 2)}\n`);
    // Only that the conversation ran: what the renderer wrote is observed, not asserted.
    expect(steps).toHaveLength(scenario.turns.length);
  }, 600_000);
});
