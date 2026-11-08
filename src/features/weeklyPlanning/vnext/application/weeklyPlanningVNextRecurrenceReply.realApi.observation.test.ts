// #958 item 2 (a reply that does not mention a repetition the application accepted), observed through the real session: the real
// provider AND the real renderer. Synthetic conversations only, no user data. Observation, not a gate: each turn and its reply
// are recorded; nothing about the model's wording is asserted, so the same cases run on a build without the prompt line (the
// baseline) and on one with it, and the two can be compared. Runs only in the real-API profile that names it (`-t 'rec-'`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { getAiConfig } from '../../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningStableV5DialogueRendererCore, type WeeklyPlanningStableV5DialogueRenderInput } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = `${process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR ?? 'artifacts/issue156-real-api'}/vnext-recurrence-reply`;
const run = shouldRun ? describe : describe.skip;

// One turn each. rec-monday is the wording already measured in the comparison harness (14 of 15 replies left the repetition out).
const CASES = [
  { id: 'rec-monday', text: '来週から毎週月曜日に英語を勉強する予定にしてください。' },
  { id: 'rec-daily', text: '毎日30分、英単語を勉強する予定にしてください。' },
  { id: 'rec-weekdays', text: '平日の朝は毎日、英語のリスニングを勉強したいです。' },
  { id: 'rec-three-per-week', text: '今週は週3回、数学の問題集を進めたいです。' },
  { id: 'rec-tue-thu', text: '毎週火曜日と木曜日に数学を勉強する予定にしてください。' },
];

function scopeFor(id: string): WeeklyPlanningVNextExperimentalScope {
  return { ownerId: 'rec-owner', weekStartDate: '2026-11-02', conversationId: `rec-${id}`, notBeforeTime: '09:00',
    clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' } };
}

/** Real provider and real renderer behind the session's ports; every renderer call is recorded (the accepted recurrence facts it saw, status, reply). */
function createPorts() {
  const slots = new Map<string, string>();
  const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => void slots.set(key, raw) });
  const client = createOpenAiCompatibleClient(getAiConfig());
  const renders: Array<{ actionKind: string; questionCode: string | null; recurrenceFacts: unknown; status: string; text: string | null }> = [];
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client, interpret: createWeeklyPlanningVNextProviderInterpreter(),
    checkpoint: slot('vnext'), legacyV5Checkpoint: { read: () => null }, approvalLedger: slot('ledger'),
    plans: { async findExistingPlanId() { return undefined; }, async saveBlock() { throw new Error('unexpected Plan save'); } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    createRenderer: options => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore(client, options);
      return { async render(input: WeeklyPlanningStableV5DialogueRenderInput) {
        const result = await renderer.render(input);
        renders.push({ actionKind: input.actionKind, questionCode: input.questionCode,
          recurrenceFacts: (input.currentTurnGrounding?.acceptedFacts ?? []).filter(fact => fact.kind === 'recurrence').map(fact => fact.data),
          status: result.status, text: result.status === 'rendered' ? result.text : null });
        return result;
      } };
    },
    now: () => new Date().toISOString(),
  };
  return { ports, renders };
}

/** Typed flags about one reply (analysis only). */
function replyFlags(reply: string) {
  return {
    mentionsRepetition: /(毎週|毎日|毎朝|毎回|週\s*[0-9０-９一二三四五六七]\s*回|週に|繰り返|平日|定期)/u.test(reply),
    mentionsAWeekday: /[月火水木金土日]曜/u.test(reply),
    // Internal identifiers must not reach the user (the fact's days are `weekday:monday`, its kind `times_per_week`).
    leaksIdentifier: /weekday:|times_per_week|[a-z]+_[a-z]+/u.test(reply),
    claimsSaved: /(保存|登録|承認)(しました|済み|されました|完了)/u.test(reply),
  };
}

const records: Record<string, unknown>[] = [];
afterAll(() => { if (records.length) { mkdirSync(outputDir, { recursive: true }); writeFileSync(`${outputDir}/summary.json`, `${JSON.stringify(records, null, 2)}\n`); } });

run('#958 item 2: the accepted repetition in the reply (real provider and real renderer)', () => {
  it.each(CASES)('$id', async scenario => {
    const scope = scopeFor(scenario.id);
    const { ports, renders } = createPorts();
    const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: `${scenario.id}-1`, userText: scenario.text, shownRevision: null });
    const record = { id: scenario.id, user: scenario.text, outcome: turn.outcome, readiness: turn.readiness, question: turn.question?.code ?? null,
      preview: turn.preview ? { blocks: turn.preview.blocks.length } : null, replySource: turn.replySource, reply: turn.reply, flags: replyFlags(turn.reply), renders: [...renders] };
    records.push(record);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}/${scenario.id}.json`, `${JSON.stringify(record, null, 2)}\n`);
    // Only that the turn ran: what the renderer wrote is observed, not asserted.
    expect(turn.reply.length).toBeGreaterThan(0);
  }, 600_000);
});
