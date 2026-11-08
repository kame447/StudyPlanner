import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { createOpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClient';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import { createWeeklyPlanningVNextProviderInterpreter } from './weeklyPlanningVNextProvider';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts } from '../application/weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextFocusedInterpreter } from '../application/weeklyPlanningVNextFocusedInterpreter';

// Observation only (SB3, Stage B): which `quantityRole` the real provider gives a first utterance that states ONE quantity,
// and whether the turn then asks `quantity_role_unresolved`. Nothing about the provider's answer is asserted: the artifact is
// the result. Synthetic utterances only; no save, no approval. Runs only through the workflow-only real-API switch.
const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const run = shouldRun ? describe : describe.skip;
const outputDir = join(process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR ?? 'artifacts/weekly-planning-real-api', 'vnext-quantity-role');
const defaultClock = { defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, weekStartsOn: 'monday' as const,
  currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' };

// One stated quantity each, except the last two (a stated total with progress), which are the controls.
const CASES = [
  { id: 'pages-plain', text: '数学の問題集を30ページ' },
  { id: 'words-this-week', text: '英単語を今週200語' },
  { id: 'pages-remaining', text: '数学の問題集はあと40ページ' },
  { id: 'pages-do', text: '物理のワークを20ページやる' },
  { id: 'pages-read', text: '世界史の教科書を50ページ読む' },
  { id: 'problems', text: '化学の問題を15問解く' },
  { id: 'years', text: '国語の過去問を3年分' },
  { id: 'minutes-daily', text: '英語のリスニングを毎日30分' },
  { id: 'passages', text: '英語長文を5題' },
  { id: 'words-memorize', text: '古文単語帳を100語覚える' },
  { id: 'control-total', text: '数学プリントは全部で12枚' },
  { id: 'control-total-done', text: '数学プリントは12枚のうち5枚終わった' },
] as const;
const REPETITIONS = Math.max(1, Number(process.env.WEEKLY_PLANNING_QUANTITY_ROLE_REPS ?? 1));
const results: unknown[] = [];

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the workflow-only native provider observation`);
  return value;
}

run('SB3 quantityRole the real provider gives a first single-quantity utterance', () => {
  afterAll(() => {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'summary.json'), JSON.stringify({ syntheticOnly: true, repetitions: REPETITIONS, results }, null, 2), 'utf8');
  });
  it.each(CASES.flatMap(item => Array.from({ length: REPETITIONS }, (_, repetition) => ({ ...item, repetition }))))('$id #$repetition', async ({ id, text, repetition }) => {
    const entry: Record<string, unknown> = { id, repetition, text, completed: false };
    results.push(entry);
    let raw: string | null = null;
    let saves = 0;
    let approvals = 0;
    if (requiredEnv('VITE_AI_PROVIDER') !== 'openai') throw new Error('Authorized provider required');
    const actual = createOpenAiCompatibleClient({ provider: 'openai', baseUrl: requiredEnv('VITE_AI_BASE_URL'),
      model: requiredEnv('VITE_AI_MODEL'), apiKey: requiredEnv('VITE_AI_API_KEY'), requestTimeoutMs: 90_000 });
    const client: OpenAiCompatibleClient = { async createChatCompletion(request) { return actual.createChatCompletion(request); } };
    const ports: WeeklyPlanningVNextExperimentalPorts = { client,
      interpret: createWeeklyPlanningVNextFocusedInterpreter({ fullReading: createWeeklyPlanningVNextProviderInterpreter(),
        requestId: () => `synthetic-sb3:${id}:${repetition}` }),
      checkpoint: { read: () => raw, write: value => { raw = value; } }, legacyV5Checkpoint: { read: () => null },
      approvalLedger: { read: () => null, write: () => { approvals++; throw new Error('No approval in observation'); } },
      plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { saves++; throw new Error('No save in observation'); } },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      now: () => '2026-11-02T00:00:00.000Z',
      // Fixed presentation isolates semantic interpretation, without buying renderer calls.
      createRenderer: () => ({ render: async () => ({ status: 'rendered', rawResponse: '', text: '合成の確認文です。' }) }),
    };
    const scope = { ownerId: 'synthetic-sb3', conversationId: `${id}-${repetition}`, weekStartDate: '2026-11-02', notBeforeTime: '09:00', clock: defaultClock };
    try {
      const first = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'first', userText: text, shownRevision: null });
      const checkpoint = raw ? JSON.parse(raw) : null;
      const workloads = (checkpoint?.vnext?.state?.graph?.workloads ?? []) as Array<{ quantityRole: string; unitCode: string | null; unitLabel: string | null; amount: number }>;
      Object.assign(entry, { questionCode: first.question?.code ?? null, interpretationStatus: first.interpretation?.status ?? null,
        workloads: workloads.map(({ quantityRole, unitCode, unitLabel, amount }) => ({ quantityRole, unitCode, unitLabel, amount })),
        completed: true });
    } finally {
      Object.assign(entry, { saves, approvals });
    }
  }, Number(process.env.WEEKLY_PLANNING_ISSUE156_TIMEOUT_MS ?? 420_000));
});
